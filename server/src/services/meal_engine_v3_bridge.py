"""Bridge meal engine v3 into the existing weekly meal-planner API shapes."""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from src.models.meal_plan import DailyMealPlanEntry, MonthlyMealPlan
from src.models.models import User
from src.models.recipes import UserMealPlan
from src.services import meal_engine_v3 as v3
from src.services.plan_snapshot import build_meal_snapshot, encode_snapshot
from src.services.planner_common import safe_json_dumps


def _calorie_log_daily_from_ctx(ctx: dict[str, Any]) -> v3.MacroTarget:
    return v3.calorie_log_daily_target(
        target_kcal=float(ctx["target_kcal"]),
        protein_g=float(ctx["protein_target"]),
        carbs_g=float(ctx["carbs_target"]),
        fat_g=float(ctx["fat_target"]),
    )


def _daily_target_for_user(db: Session, user: User) -> tuple[v3.DietFilter, v3.GoalType, v3.MacroTarget, int, dict[str, Any]]:
    from src.services.meal_planner_service import _build_meal_ctx

    ctx = _build_meal_ctx(db, user)
    diet = v3.normalize_diet(str(ctx.get("diet_type") or ""))
    goal = v3.normalize_goal(str(ctx.get("goal") or "maintain"))
    meals_per_day = v3.clamp_meals_per_day(int(ctx.get("meals_per_day") or 3))
    daily = _calorie_log_daily_from_ctx(ctx)
    return diet, goal, daily, meals_per_day, ctx


def _v3_ctx(db: Session, user: User) -> tuple[v3.DietFilter, v3.GoalType, float, int]:
    from src.services.meal_planner_service import _build_meal_ctx

    ctx = _build_meal_ctx(db, user)
    diet = v3.normalize_diet(str(ctx.get("diet_type") or ""))
    goal = v3.normalize_goal(str(ctx.get("goal") or "maintain"))
    # Onboarding calorie target — engine applies goal kcal_mult + macro splits.
    daily_kcal = float(ctx["target_kcal"])
    meals_per_day = v3.clamp_meals_per_day(int(ctx.get("meals_per_day") or 3))
    return diet, goal, daily_kcal, meals_per_day


def _calendar_date(year: int, month: int, day: int) -> date:
    return date(year, month, day)


def sync_day_entry(
    db: Session,
    plan: MonthlyMealPlan,
    *,
    day: int,
    user: User,
    force: bool = False,
    diet: v3.DietFilter | None = None,
    goal: v3.GoalType | None = None,
    daily_kcal: float | None = None,
    meals_per_day: int | None = None,
) -> DailyMealPlanEntry:
    # Prefer caller-supplied ctx so we do not re-resolve targets after the week
    # plan row has been flushed (resolve_user_targets used to db.rollback()).
    if diet is None or goal is None or daily_kcal is None or meals_per_day is None:
        diet, goal, daily, meals_per_day, _ctx = _daily_target_for_user(db, user)
    else:
        from src.services.meal_planner_service import _build_meal_ctx

        daily = _calorie_log_daily_from_ctx(_build_meal_ctx(db, user))
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))

    rows = v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
        meals_per_day=meals_per_day,
        force=force,
        daily_override=daily,
    )
    payload = v3.day_payload_from_assignments(plan_date, rows, daily)
    return _write_day_entry(db, plan, day=day, payload=payload)


def _write_day_entry(
    db: Session,
    plan: MonthlyMealPlan,
    *,
    day: int,
    payload: dict[str, Any],
) -> DailyMealPlanEntry:
    entry = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day == day)
        .one_or_none()
    )
    if entry is None:
        entry = DailyMealPlanEntry(
            plan_id=plan.id,
            day=day,
            is_cheat_day=False,
            total_calories=int(payload["total_calories"]),
            total_protein_g=int(payload["total_protein_g"]),
            total_carbs_g=int(payload["total_carbs_g"]),
            total_fat_g=int(payload["total_fat_g"]),
            total_fiber_g=0,
            meals_json=safe_json_dumps(payload["meals"]),
        )
        db.add(entry)
        if "entries" in plan.__dict__:
            plan.entries.append(entry)
    else:
        entry.is_cheat_day = False
        entry.total_calories = int(payload["total_calories"])
        entry.total_protein_g = int(payload["total_protein_g"])
        entry.total_carbs_g = int(payload["total_carbs_g"])
        entry.total_fat_g = int(payload["total_fat_g"])
        entry.total_fiber_g = 0
        entry.meals_json = safe_json_dumps(payload["meals"])
    db.flush()
    return entry


def generate_or_refresh_week_v3(
    db: Session,
    user: User,
    *,
    budget_level: str,
    week_start_day: int,
    local_date: str | None,
    force: bool = False,
) -> MonthlyMealPlan:
    from src.services.meal_planner_service import (
        _apply_plan_display_targets,
        _build_meal_ctx,
        _ctx_meal_pref_key,
        _onboarding_context,
        _store_meal_pref,
        _stored_meal_pref_key,
        get_month_weeks,
        get_weekly_plan_by_start_day,
        parse_local_date,
    )

    today = parse_local_date(local_date)
    month, year = today.month, today.year
    weeks = get_month_weeks(year, month)
    target_week = next((w for w in weeks if w["start_day"] == week_start_day), None)
    if not target_week:
        raise ValueError(f"No week starting on day {week_start_day} in {month}/{year}")

    # Resolve targets once before any plan flush — avoid mid-txn target probes.
    diet, goal, daily, meals_per_day, ctx = _daily_target_for_user(db, user)
    ctx = {**ctx, "budget_level": budget_level}

    existing = get_weekly_plan_by_start_day(db, user.id, month, year, week_start_day)
    # A diet preference change invalidates the stored week even without force.
    diet_changed = existing is not None and _stored_meal_pref_key(existing) != _ctx_meal_pref_key(ctx)
    if existing and existing.source == "recipe_v3" and not force and not diet_changed:
        for d in target_week["days"]:
            sync_day_entry(
                db,
                existing,
                day=d,
                user=user,
                force=False,
                diet=diet,
                goal=goal,
                daily_kcal=daily.kcal,
                meals_per_day=meals_per_day,
            )
        _apply_plan_display_targets(existing, ctx)
        # Soft refresh must not rewrite a real snapshot (would clear the banner without
        # regenerating meals). Only backfill legacy NULL so old weeks stop looking stale forever.
        if not existing.onboarding_snapshot_json:
            raw_onboarding, _ = _onboarding_context(db, user.id)
            existing.onboarding_snapshot_json = encode_snapshot(build_meal_snapshot(raw_onboarding))
        db.commit()
        db.refresh(existing)
        return existing

    if existing:
        plan = existing
        plan.budget_level = budget_level
        plan.generated_at = datetime.utcnow()
        plan.source = "recipe_v3"
        plan.week_start_day = week_start_day
        plan.week_end_day = target_week["end_day"]
        plan.generation_mode = "weekly"
    else:
        plan = MonthlyMealPlan(
            user_id=user.id,
            month=month,
            year=year,
            budget_level=budget_level,
            generated_at=datetime.utcnow(),
            source="recipe_v3",
            week_start_day=week_start_day,
            week_end_day=target_week["end_day"],
            generation_mode="weekly",
        )
        db.add(plan)
        db.flush()

    _apply_plan_display_targets(plan, ctx)
    _store_meal_pref(plan, ctx)
    # Snapshot onboarding values for staleness detection.
    raw_onboarding, _ = _onboarding_context(db, user.id)
    plan.onboarding_snapshot_json = encode_snapshot(build_meal_snapshot(raw_onboarding))
    db.flush()

    # Upsert each day in place — avoids delete-orphan fights on plan.entries.
    keep_days = set(target_week["days"])
    for d in target_week["days"]:
        sync_day_entry(
            db,
            plan,
            day=d,
            user=user,
            force=True,
            diet=diet,
            goal=goal,
            daily_kcal=daily.kcal,
            meals_per_day=meals_per_day,
        )

    # Drop leftover days outside this week (should be rare).
    extras = (
        db.query(DailyMealPlanEntry)
        .filter(
            DailyMealPlanEntry.plan_id == plan.id,
            DailyMealPlanEntry.day.notin_(list(keep_days)),
        )
        .all()
    )
    for row in extras:
        db.delete(row)

    db.commit()
    db.refresh(plan)
    return plan


def swap_meal_v3(
    db: Session,
    user: User,
    *,
    plan: MonthlyMealPlan,
    day: int,
    meal_type: str,
) -> DailyMealPlanEntry:
    diet, goal, daily, meals_per_day, _ctx = _daily_target_for_user(db, user)
    slot = v3.parse_slot_from_meal_type(meal_type)
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))

    rows = v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
        meals_per_day=meals_per_day,
        force=False,
        daily_override=daily,
    )
    swapped = v3.swap_slot(
        db,
        user_id=user.id,
        plan_date=plan_date,
        slot=slot,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
        meals_per_day=meals_per_day,
        daily_override=daily,
    )
    rows = [swapped if row.slot == slot else row for row in rows]
    rows, _reconcile_meta = v3.reconcile_day_kcal(
        db,
        rows=rows,
        daily=daily,
        meals_per_day=meals_per_day,
        user_id=user.id,
        plan_date=plan_date,
    )
    payload = v3.day_payload_from_assignments(plan_date, rows, daily)
    entry = _write_day_entry(db, plan, day=day, payload=payload)
    db.commit()
    db.refresh(entry)
    return entry


def regenerate_day_v3(
    db: Session,
    user: User,
    *,
    plan: MonthlyMealPlan,
    day: int,
) -> DailyMealPlanEntry:
    """Rebuild all slots for a single day via the v3 engine.

    Uses the user's *current* meals_per_day (self-heals days generated under a
    different count). Bumps each slot's swap_version so repeated regenerates vary.
    """
    diet, goal, daily, meals_per_day, _ctx = _daily_target_for_user(db, user)
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))
    schedule = v3.slot_schedule(meals_per_day)

    # Force-rebuild to the current schedule (drops obsolete slots / adds new ones).
    v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
        meals_per_day=meals_per_day,
        force=True,
        daily_override=daily,
    )

    forward_dates = [
        candidate
        for offset in range(3)
        if (candidate := plan_date + timedelta(days=offset)).month == plan_date.month
    ]
    forward_rows = (
        db.query(UserMealPlan)
        .filter(
            UserMealPlan.user_id == user.id,
            UserMealPlan.plan_date.in_(forward_dates),
        )
        .all()
    )
    excluded_by_slot: dict[str, set[int]] = {
        spec.slot: {
            int(row.recipe_id)
            for row in forward_rows
            if row.slot == spec.slot
        }
        for spec in schedule
    }

    regenerated_rows = []
    same_day_picked: set[int] = set()
    for spec in schedule:
        exclude = set(excluded_by_slot.get(spec.slot) or ()) | same_day_picked
        row = v3.swap_slot(
            db,
            user_id=user.id,
            plan_date=plan_date,
            slot=spec.slot,
            diet=diet,
            goal=goal,
            daily_kcal=daily.kcal,
            meals_per_day=meals_per_day,
            slot_order=spec.order,
            exclude_recipe_ids=exclude,
            match_current_macros=False,
            daily_override=daily,
        )
        same_day_picked.add(int(row.recipe_id))
        regenerated_rows.append(row)

    regenerated_rows, _reconcile_meta = v3.reconcile_day_kcal(
        db,
        rows=regenerated_rows,
        daily=daily,
        meals_per_day=meals_per_day,
        user_id=user.id,
        plan_date=plan_date,
    )

    payload = v3.day_payload_from_assignments(plan_date, regenerated_rows, daily)
    entry = _write_day_entry(db, plan, day=day, payload=payload)
    # Day regen uses current onboarding targets — keep snapshot in sync.
    from src.services.meal_planner_service import _onboarding_context

    raw_onboarding, _ = _onboarding_context(db, user.id)
    plan.onboarding_snapshot_json = encode_snapshot(build_meal_snapshot(raw_onboarding))
    db.commit()
    db.refresh(entry)
    return entry


def protein_gap_v3(
    db: Session,
    user: User,
    *,
    day: int,
    year: int,
    month: int,
) -> dict[str, Any]:
    diet, goal, daily, meals_per_day, _ctx = _daily_target_for_user(db, user)
    plan_date = _calendar_date(year, month, day)
    v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
        meals_per_day=meals_per_day,
        force=False,
        daily_override=daily,
    )
    result = v3.protein_gap_suggestions(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily.kcal,
    )
    db.commit()
    return result


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]
