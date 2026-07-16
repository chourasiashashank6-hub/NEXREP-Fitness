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
from src.services.planner_common import safe_json_dumps


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
) -> DailyMealPlanEntry:
    diet, goal, daily_kcal, meals_per_day = _v3_ctx(db, user)
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))
    daily = v3.daily_targets(daily_kcal, goal)

    rows = v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
        force=force,
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
        _build_meal_ctx,
        _store_meal_pref,
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

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = budget_level
    diet, goal, daily_kcal, _meals_per_day = _v3_ctx(db, user)
    daily = v3.daily_targets(daily_kcal, goal)

    existing = get_weekly_plan_by_start_day(db, user.id, month, year, week_start_day)
    if existing and existing.source == "recipe_v3" and not force:
        for d in target_week["days"]:
            sync_day_entry(db, existing, day=d, user=user, force=False)
        existing.target_kcal = int(round(daily.kcal))
        existing.target_protein_g = int(round(daily.protein))
        existing.target_carbs_g = int(round(daily.carbs))
        existing.target_fat_g = int(round(daily.fat))
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

    plan.target_kcal = int(round(daily.kcal))
    plan.target_protein_g = int(round(daily.protein))
    plan.target_carbs_g = int(round(daily.carbs))
    plan.target_fat_g = int(round(daily.fat))
    plan.target_fiber_g = 0
    _store_meal_pref(plan, ctx)
    db.flush()

    # Upsert each day in place — avoids delete-orphan fights on plan.entries.
    keep_days = set(target_week["days"])
    for d in target_week["days"]:
        sync_day_entry(db, plan, day=d, user=user, force=True)

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
    diet, goal, daily_kcal, meals_per_day = _v3_ctx(db, user)
    slot = v3.parse_slot_from_meal_type(meal_type)
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))
    daily = v3.daily_targets(daily_kcal, goal)

    rows = v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
        force=False,
    )
    swapped = v3.swap_slot(
        db,
        user_id=user.id,
        plan_date=plan_date,
        slot=slot,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
    )
    rows = [swapped if row.slot == slot else row for row in rows]
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
    diet, goal, daily_kcal, meals_per_day = _v3_ctx(db, user)
    plan_date = _calendar_date(int(plan.year), int(plan.month), int(day))
    daily = v3.daily_targets(daily_kcal, goal)
    schedule = v3.slot_schedule(meals_per_day)

    # Force-rebuild to the current schedule (drops obsolete slots / adds new ones).
    v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
        force=True,
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
            daily_kcal=daily_kcal,
            meals_per_day=meals_per_day,
            slot_order=spec.order,
            exclude_recipe_ids=exclude,
            match_current_macros=False,
        )
        same_day_picked.add(int(row.recipe_id))
        regenerated_rows.append(row)

    payload = v3.day_payload_from_assignments(plan_date, regenerated_rows, daily)
    entry = _write_day_entry(db, plan, day=day, payload=payload)
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
    diet, goal, daily_kcal, meals_per_day = _v3_ctx(db, user)
    plan_date = _calendar_date(year, month, day)
    v3.ensure_day_plan(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
        force=False,
    )
    result = v3.protein_gap_suggestions(
        db,
        user_id=user.id,
        plan_date=plan_date,
        diet=diet,
        goal=goal,
        daily_kcal=daily_kcal,
    )
    db.commit()
    return result


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]
