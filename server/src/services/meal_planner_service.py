from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.models.meal_plan import DailyMealPlanEntry, MonthlyMealPlan
from src.models.models import User, UserOnboarding
from src.services.planner_common import (
    day_flags,
    days_in_month,
    get_month_weeks,
    month_abbr,
    parse_local_date,
    safe_json_loads,
)
from src.services.planner_swap_limits import (
    SWAP_LIMIT_PER_DAY,
    DayRegenLimitExceeded,
    SwapLimitExceeded,
    check_swap_allowed,
    get_swap_count,
    increment_swap,
)
from src.services.plan_snapshot import build_meal_snapshot, encode_snapshot, stale_meal_fields
from src.services.planner_test_users import (
    is_meal_planner_test_user,
    is_planner_days_unlocked_user,
    meal_planner_limits_exempt_flag,
    meal_planner_unlimited_regen_stats,
    planner_days_unlocked_flag,
)

MONTHLY_DAY_REGEN_LIMIT = 3

# Human-readable labels for body type IDs stored in onboarding_json.body_type
# Keys match current_body_id and goal_body_id values from the mobile app
BODY_TYPE_LABELS: dict[str, str] = {
    # Current body types (male + female share sk, sf, av, ow, ob)
    "sk": "Skinny",
    "sf": "Skinny fat",
    "av": "Average",
    "ow": "Overweight",
    "ob": "Obese",
    "mu": "Muscular",        # male current
    "cv": "Curvy",           # female current only
    # Goal body types (male)
    "ln": "Lean & cut",
    "at": "Athletic",
    "bk": "Bulk & strong",
    # Goal body types (female)
    "to": "Toned",
    "sc": "Strong & curvy",
    # "at" and "ln" shared between male/female goals — already covered above
}


def _body_label(body_id: str | None) -> str:
    """Convert a short body type ID to a human-readable label."""
    if not body_id:
        return "not specified"
    return BODY_TYPE_LABELS.get(str(body_id).lower().strip(), str(body_id))


MEAL_SLOTS_BY_COUNT: dict[int, list[str]] = {
    2: ["Lunch", "Dinner"],
    3: ["Breakfast", "Lunch", "Dinner"],
    4: ["Breakfast", "Lunch", "Snack", "Dinner"],
    5: ["Breakfast", "Mid-Morning Snack", "Lunch", "Evening Snack", "Dinner"],
    6: ["Breakfast", "Mid-Morning Snack", "Lunch", "Post_Workout", "Evening Snack", "Dinner"],
    7: [
        "Breakfast",
        "Mid-Morning Snack",
        "Lunch",
        "Post_Workout",
        "Afternoon Snack",
        "Evening Snack",
        "Dinner",
    ],
}


def _onboarding_context(db: Session, user_id: int) -> tuple[dict, dict]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}
    targets = row.targets_json if row and isinstance(row.targets_json, dict) else {}
    return onboarding, targets


def _meal_pref_key(diet_type: str | None) -> str:
    """Meal preference identity is the diet type only."""
    return (diet_type or "").strip().lower()


def _stored_meal_pref_key(plan: MonthlyMealPlan) -> str:
    return _meal_pref_key(getattr(plan, "diet_type", None))


def _ctx_meal_pref_key(ctx: dict[str, Any]) -> str:
    return _meal_pref_key(str(ctx.get("diet_type") or ""))


def _store_meal_pref(plan: MonthlyMealPlan, ctx: dict[str, Any]) -> None:
    plan.diet_type = str(ctx.get("diet_type") or "standard")


def get_user_nutrition_targets(db: Session, user: User) -> dict[str, int | float]:
    """
    Same targets Calorie Log displays (Mifflin kcal + resolve macros/fibre/water).
    """
    from src.services.calorie_log_targets import get_calorie_log_targets

    resolved = get_calorie_log_targets(db, user)
    target_kcal = int(resolved.get("target_calories") or 0)
    protein_g = int(float(resolved.get("target_protein_g") or 0))
    carbs_g = int(float(resolved.get("target_carbs_g") or 0))
    fat_g = int(float(resolved.get("target_fat_g") or 0))
    fiber_g = int(float(resolved.get("target_fiber_g") or 30))
    water_l = float(resolved.get("target_water_l") or 2.5)
    if target_kcal < 1 or protein_g < 1:
        raise HTTPException(
            status_code=404,
            detail="User nutrition targets not found. Complete onboarding first.",
        )
    out = {
        "target_kcal": target_kcal,
        "protein_target": protein_g,
        "carbs_target": carbs_g,
        "fat_target": fat_g,
        "fiber_target": fiber_g,
        "water_target_l": water_l,
    }
    logger.info(
        "[MealPlanner] calorie_log_targets for user %s: kcal=%s, P=%sg, C=%sg, F=%sg, Fi=%sg",
        user.id,
        target_kcal,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
    )
    return out


def _monthly_day_regen_stats(
    db: Session,
    user_id: int,
    month: int,
    year: int,
    *,
    user: User | None = None,
) -> dict[str, int | bool]:
    if user and is_meal_planner_test_user(user):
        return meal_planner_unlimited_regen_stats()

    plans = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
        )
        .all()
    )
    used = sum(int(p.day_regens_used or 0) for p in plans)
    limit = int(plans[0].day_regens_limit or MONTHLY_DAY_REGEN_LIMIT) if plans else MONTHLY_DAY_REGEN_LIMIT
    remaining = max(0, limit - used)
    return {
        "day_regens_used": used,
        "day_regens_limit": limit,
        "day_regens_remaining": remaining,
        **meal_planner_limits_exempt_flag(user),
    }


def _attach_day_regen_stats(payload: dict[str, Any], stats: dict[str, int]) -> dict[str, Any]:
    payload.update(stats)
    return payload


def _plan_targets_dict(plan: MonthlyMealPlan, db: Session, user: User) -> dict[str, int]:
    """Display targets — always live from calorie_log_targets, never v3-stored plan columns."""
    nutrition = get_user_nutrition_targets(db, user)
    return {
        "kcal": int(nutrition["target_kcal"]),
        "protein_g": int(nutrition["protein_target"]),
        "carbs_g": int(nutrition["carbs_target"]),
        "fat_g": int(nutrition["fat_target"]),
        "fiber_g": int(nutrition["fiber_target"]),
    }


def _apply_plan_display_targets(plan: MonthlyMealPlan, ctx: dict[str, Any]) -> None:
    """Persist Calorie Log display targets on the plan row (not v3 engine internals)."""
    plan.target_kcal = int(ctx["target_kcal"])
    plan.target_protein_g = int(ctx["protein_target"])
    plan.target_carbs_g = int(ctx["carbs_target"])
    plan.target_fat_g = int(ctx["fat_target"])
    plan.target_fiber_g = int(ctx.get("fiber_target") or 30)


def _meal_slots_for_count(meals_per_day: int) -> list[str]:
    count = max(2, min(7, int(meals_per_day)))
    return list(MEAL_SLOTS_BY_COUNT.get(count, MEAL_SLOTS_BY_COUNT[3]))


def _build_meal_ctx(db: Session, user: User) -> dict[str, Any]:
    onboarding, _targets = _onboarding_context(db, user.id)
    nutrition = get_user_nutrition_targets(db, user)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    target_kcal = nutrition.get("target_kcal")
    protein_target = nutrition.get("protein_target")
    assert target_kcal is not None, "target_kcal must be resolved before generation"
    assert protein_target is not None, "protein_target must be resolved before generation"
    meals_per_day = int(dietary.get("meals_per_day") or 3)
    meals_per_day = max(2, min(6, meals_per_day))
    body_type_data = onboarding.get("body_type") or {}
    if not isinstance(body_type_data, dict):
        body_type_data = {}
    return {
        "target_kcal": int(target_kcal),
        "protein_target": int(protein_target),
        "carbs_target": int(nutrition["carbs_target"]),
        "fat_target": int(nutrition["fat_target"]),
        "fiber_target": int(nutrition["fiber_target"]),
        "meals_per_day": meals_per_day,
        "expected_meal_types": _meal_slots_for_count(meals_per_day),
        "region": str(app_setup.get("region") or "IN"),
        "diet_type": str(dietary.get("diet_type") or "standard"),
        "allergies": dietary.get("allergies") if isinstance(dietary.get("allergies"), list) else [],
        "budget_level": "budget",
        "preferred_language": user.preferred_language,
        "user_weight_kg": float(personal.get("weight_kg") or user.weight or 70),
        "goal": str(goal.get("type") or "maintain"),
        "activity_level": str(activity.get("level") or "moderately_active"),
        "workout_types": activity.get("workout_types") if isinstance(activity.get("workout_types"), list) else [],
        "water_target_l": float(nutrition["water_target_l"]),
        "current_body_type": _body_label(body_type_data.get("current_body_id")),
        "goal_body_type": _body_label(body_type_data.get("goal_body_id")),
        "problem_areas": body_type_data.get("problem_areas", []),
    }


def get_existing_meal_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyMealPlan | None:
    """Legacy monthly plan for the month (generation_mode=monthly)."""
    return get_existing_monthly_meal_plan(db, user_id, month, year)


def get_existing_monthly_meal_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyMealPlan | None:
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "monthly",
        )
        .first()
    )


def get_weekly_plan_by_start_day(
    db: Session, user_id: int, month: int, year: int, week_start_day: int
) -> MonthlyMealPlan | None:
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
            MonthlyMealPlan.week_start_day == week_start_day,
        )
        .first()
    )


def get_plan_for_day(db: Session, user_id: int, month: int, year: int, day: int) -> MonthlyMealPlan | None:
    weekly = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
            MonthlyMealPlan.week_start_day <= day,
            MonthlyMealPlan.week_end_day >= day,
        )
        .first()
    )
    if weekly:
        return weekly
    return get_existing_monthly_meal_plan(db, user_id, month, year)


def list_weekly_plans_for_month(db: Session, user_id: int, month: int, year: int) -> list[MonthlyMealPlan]:
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
        )
        .order_by(MonthlyMealPlan.week_start_day.asc())
        .all()
    )


def weeks_overview_response(db: Session, user: User, local_date: str | None) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    weeks = get_month_weeks(year, month)
    existing = list_weekly_plans_for_month(db, user.id, month, year)
    by_start = {p.week_start_day: p for p in existing if p.week_start_day is not None}

    result_weeks = []
    for w in weeks:
        start = w["start_day"]
        is_current = w["start_day"] <= today.day <= w["end_day"]
        is_past = w["end_day"] < today.day
        plan = by_start.get(start)
        is_generated = plan is not None
        result_weeks.append(
            {
                **w,
                "plan_id": plan.id if plan else None,
                "is_current": is_current,
                "is_past": is_past,
                "is_generated": is_generated,
                "can_generate": not is_generated and (is_current or not is_past),
            }
        )

    return {"month": month, "year": year, "weeks": result_weeks}


def _week_number_for_plan(plan: MonthlyMealPlan) -> int | None:
    if plan.week_start_day is None:
        return None
    for w in get_month_weeks(plan.year, plan.month):
        if w["start_day"] == plan.week_start_day:
            return w["week_number"]
    return None


def _build_week_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session,
    user: User,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    entries = sorted(plan.entries, key=lambda e: e.day)
    targets = _plan_targets_dict(plan, db, user)
    days_out: list[dict[str, Any]] = []

    unlock_all_days = is_planner_days_unlocked_user(user)
    for entry in entries:
        flags = day_flags(entry.day, today, plan.month, plan.year)
        if flags["is_future"] and not unlock_all_days:
            day_dict: dict[str, Any] = {
                "day": entry.day,
                "is_cheat_day": entry.is_cheat_day,
                "locked": True,
                "message": f"Available on {month_abbr(plan.month)} {entry.day}",
                "meals": [],
                "total_calories": 0,
                "total_protein_g": 0,
                "total_carbs_g": 0,
                "total_fat_g": 0,
                "total_fiber_g": 0,
                **flags,
            }
        else:
            day_dict = _entry_to_day_dict(entry, plan=plan, targets=targets, locked=False)
            day_dict.update(flags)
        days_out.append(day_dict)

    week_num = _week_number_for_plan(plan)
    start = plan.week_start_day or 1
    end = plan.week_end_day or start

    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "week_number": week_num,
        "week_start_day": start,
        "week_end_day": end,
        "week_label": f"Week {week_num}: {month_abbr(plan.month)} {start}–{end}" if week_num else f"{month_abbr(plan.month)} {start}–{end}",
        "budget_level": plan.budget_level,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "generation_mode": plan.generation_mode or "weekly",
        "targets": targets,
        "days": days_out,
        "month_overview": [
            {
                "day": d["day"],
                "total_calories": d.get("total_calories"),
                "is_cheat_day": d.get("is_cheat_day", False),
                "is_past": d.get("is_past", False),
                "is_today": d.get("is_today", False),
                "is_future": d.get("is_future", False),
            }
            for d in days_out
        ],
        "today": next((d for d in days_out if d.get("is_today")), None),
        **_monthly_day_regen_stats(db, user.id, plan.month, plan.year, user=user),
        **planner_days_unlocked_flag(user),
        **_meal_plan_staleness(plan, db, user),
    }


def _meal_plan_staleness(plan: MonthlyMealPlan, db: Session, user: User) -> dict[str, Any]:
    onboarding_raw, _ = _onboarding_context(db, user.id)
    stale = stale_meal_fields(plan.onboarding_snapshot_json, onboarding_raw)
    return {"stale_fields": stale, "is_stale": len(stale) > 0}


def user_has_stale_meal_plan(db: Session, user: User, local_date: str | None) -> bool:
    """True when any meal plan row for the current month is out of date vs onboarding."""
    today = parse_local_date(local_date)
    onboarding_raw, _ = _onboarding_context(db, user.id)
    weekly_plans = list_weekly_plans_for_month(db, user.id, today.month, today.year)
    if weekly_plans:
        return any(
            len(stale_meal_fields(plan.onboarding_snapshot_json, onboarding_raw)) > 0
            for plan in weekly_plans
        )
    legacy = get_existing_monthly_meal_plan(db, user.id, today.month, today.year)
    if not legacy:
        return False
    return len(stale_meal_fields(legacy.onboarding_snapshot_json, onboarding_raw)) > 0


def meal_plan_current_weekly_response(
    db: Session,
    user: User,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    weekly_plans = list_weekly_plans_for_month(db, user.id, today.month, today.year)
    weeks_meta = get_month_weeks(today.year, today.month)
    current_plan = None
    for wp in weekly_plans:
        if wp.week_start_day is not None and wp.week_end_day is not None:
            if wp.week_start_day <= today.day <= wp.week_end_day:
                current_plan = wp
                break

    regen_stats = _monthly_day_regen_stats(db, user.id, today.month, today.year, user=user)
    return {
        "generation_mode": "weekly",
        "current_week": (
            _build_week_response(current_plan, local_date, db=db, user=user) if current_plan else None
        ),
        **regen_stats,
        "weeks_generated": len(weekly_plans),
        "total_weeks": len(weeks_meta),
    }


def generate_week_plan(
    db: Session,
    user: User,
    *,
    budget_level: str,
    week_start_day: int,
    local_date: str | None,
) -> dict[str, Any]:
    from src.services.meal_engine_v3_bridge import generate_or_refresh_week_v3

    plan = generate_or_refresh_week_v3(
        db,
        user,
        budget_level=budget_level,
        week_start_day=week_start_day,
        local_date=local_date,
    )
    return _build_week_response(plan, local_date, db=db, user=user)


def regenerate_week_plan(
    db: Session,
    user: User,
    *,
    week_start_day: int,
    from_day: int,
    local_date: str | None,
    exclude_foods: list[str] | None = None,
    exclude_dishes: list[dict[str, Any] | str] | None = None,
) -> dict[str, Any]:
    from src.services.meal_engine_v3_bridge import generate_or_refresh_week_v3

    today = parse_local_date(local_date)
    existing = get_weekly_plan_by_start_day(db, user.id, today.month, today.year, week_start_day)
    budget_level = str(existing.budget_level or "budget") if existing else _month_budget_level(
        db, user, today.month, today.year
    )
    plan = generate_or_refresh_week_v3(
        db,
        user,
        budget_level=budget_level,
        week_start_day=week_start_day,
        local_date=local_date,
        force=True,
    )
    return _build_week_response(plan, local_date, db=db, user=user)


def _plan_covering_day(plans: list[MonthlyMealPlan], day: int) -> MonthlyMealPlan | None:
    for plan in plans:
        start = plan.week_start_day
        end = plan.week_end_day
        if start is not None and end is not None and start <= day <= end:
            return plan
    return None


def _month_budget_level(db: Session, user: User, month: int, year: int, default: str = "budget") -> str:
    for plan in list_weekly_plans_for_month(db, user.id, month, year):
        if plan.budget_level:
            return str(plan.budget_level)
    return default


def generate_meal_plan(
    db: Session,
    user: User,
    *,
    budget_level: str,
    local_date: str | None,
) -> MonthlyMealPlan:
    """Generate every week of the current month with meal engine v3.

    Returns the weekly plan that covers today (falling back to the first week)
    so callers can render it through `meal_plan_current_response`.
    """
    from src.services.meal_engine_v3_bridge import generate_or_refresh_week_v3

    today = parse_local_date(local_date)
    month, year = today.month, today.year
    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = budget_level
    ctx_pref = _ctx_meal_pref_key(ctx)

    weeks = get_month_weeks(year, month)
    if not weeks:
        raise RuntimeError(f"No weeks resolved for {month}/{year}")

    logger.info(
        "[MealPlanner] generate_meal_plan user %s %s/%s: %s weeks, kcal=%s, P=%sg, diet=%s",
        user.id,
        month,
        year,
        len(weeks),
        ctx["target_kcal"],
        ctx["protein_target"],
        ctx["diet_type"],
    )

    plans: list[MonthlyMealPlan] = []
    for week in weeks:
        start = int(week["start_day"])
        existing = get_weekly_plan_by_start_day(db, user.id, month, year, start)
        # Diet preference change invalidates an already generated week.
        force = existing is not None and _stored_meal_pref_key(existing) != ctx_pref
        plans.append(
            generate_or_refresh_week_v3(
                db,
                user,
                budget_level=budget_level,
                week_start_day=start,
                local_date=local_date,
                force=force,
            )
        )

    return _plan_covering_day(plans, today.day) or plans[0]


def _entry_to_day_dict(
    entry: DailyMealPlanEntry,
    *,
    plan: MonthlyMealPlan | None = None,
    targets: dict[str, int] | None = None,
    locked: bool = False,
) -> dict[str, Any]:
    if locked:
        return {
            "day": entry.day,
            "is_cheat_day": entry.is_cheat_day,
            "locked": True,
            "message": f"This day's plan will be available on day {entry.day}",
        }
    out: dict[str, Any] = {
        "day": entry.day,
        "is_cheat_day": entry.is_cheat_day,
        "total_calories": entry.total_calories,
        "total_protein_g": entry.total_protein_g,
        "total_carbs_g": entry.total_carbs_g,
        "total_fat_g": entry.total_fat_g,
        "total_fiber_g": entry.total_fiber_g,
        "meals": safe_json_loads(entry.meals_json),
    }
    if targets:
        out["target_kcal"] = targets["kcal"]
        out["target_protein_g"] = targets["protein_g"]
        out["target_carbs_g"] = targets["carbs_g"]
        out["target_fat_g"] = targets["fat_g"]
        out["target_fiber_g"] = targets.get("fiber_g", 30)
    elif plan and plan.target_kcal:
        out["target_kcal"] = int(plan.target_kcal)
        out["target_protein_g"] = int(plan.target_protein_g or 0)
        out["target_carbs_g"] = int(plan.target_carbs_g or 0)
        out["target_fat_g"] = int(plan.target_fat_g or 0)
        out["target_fiber_g"] = int(plan.target_fiber_g or 30)
    return out


def meal_plan_current_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    entries = sorted(plan.entries, key=lambda e: e.day)
    today_entry = next((e for e in entries if e.day == today.day), None)
    unlock_all_days = user is not None and is_planner_days_unlocked_user(user)
    month_overview = []
    for e in entries:
        flags = day_flags(e.day, today, plan.month, plan.year)
        row = {
            "day": e.day,
            "total_calories": e.total_calories if (unlock_all_days or not flags["is_future"]) else None,
            "is_cheat_day": e.is_cheat_day,
            **flags,
        }
        month_overview.append(row)
    targets = _plan_targets_dict(plan, db, user) if db and user else None
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "budget_level": plan.budget_level,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "targets": targets,
        "today": (
            _entry_to_day_dict(today_entry, plan=plan, targets=targets, locked=False)
            if today_entry
            else None
        ),
        "month_overview": month_overview,
        **(_monthly_day_regen_stats(db, user.id, plan.month, plan.year, user=user) if db and user else {}),
        **(planner_days_unlocked_flag(user) if user else {}),
        **(_meal_plan_staleness(plan, db, user) if db and user else {}),
    }


def meal_plan_month_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    days_out = []
    for e in sorted(plan.entries, key=lambda x: x.day):
        flags = day_flags(e.day, today, plan.month, plan.year)
        row = {
            "day": e.day,
            "is_cheat_day": e.is_cheat_day,
            "total_calories": e.total_calories,
            "total_protein_g": e.total_protein_g,
            "total_carbs_g": e.total_carbs_g,
            "total_fat_g": e.total_fat_g,
            **flags,
        }
        if not flags["is_future"]:
            row["meals"] = safe_json_loads(e.meals_json)
        days_out.append(row)
    targets = _plan_targets_dict(plan, db, user) if db and user else None
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "targets": targets,
        "days": days_out,
    }


def delete_meal_plan(db: Session, plan: MonthlyMealPlan) -> None:
    db.delete(plan)
    db.commit()


def regenerate_single_day(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    local_date: str | None,
    exclude_foods: list[str] | None = None,
    exclude_dishes: list[dict[str, Any] | str] | None = None,
) -> dict[str, Any]:
    from src.services.meal_engine_v3_bridge import regenerate_day_v3

    today = parse_local_date(local_date)
    month, year = today.month, today.year

    if day < today.day and today.month == month and today.year == year:
        raise ValueError(f"Cannot regenerate past days. Day {day} has already passed.")

    test_user = is_meal_planner_test_user(user)
    if not test_user:
        regen_stats = _monthly_day_regen_stats(db, user.id, month, year, user=user)
        if regen_stats["day_regens_remaining"] <= 0:
            limit = regen_stats["day_regens_limit"]
            raise DayRegenLimitExceeded(
                f"You have used all {limit} day regenerations for this month. "
                "You can still swap individual meals."
            )

    plan = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.id == plan_id,
            MonthlyMealPlan.user_id == user.id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
        )
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")

    existing_entry = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day == day)
        .first()
    )
    if not existing_entry:
        raise LookupError("Day not found")

    try:
        new_entry = regenerate_day_v3(db, user, plan=plan, day=day)
    except Exception as gen_exc:
        db.rollback()
        logger.exception("[MealPlanner] regenerate_day_v3 failed for day %s: %s", day, gen_exc)
        raise RuntimeError(
            "Failed to regenerate this day. Your existing meals were not changed. Try again."
        ) from gen_exc

    if not test_user:
        plan.day_regens_used = int(plan.day_regens_used or 0) + 1
        db.commit()
        db.refresh(plan)

    targets = _plan_targets_dict(plan, db, user)
    result = _entry_to_day_dict(new_entry, plan=plan, targets=targets)
    return _attach_day_regen_stats(result, _monthly_day_regen_stats(db, user.id, month, year, user=user))


def regenerate_remaining_meals(
    db: Session,
    user: User,
    *,
    from_day: int,
    local_date: str | None,
    exclude_foods: list[str] | None = None,
    exclude_dishes: list[dict[str, Any] | str] | None = None,
) -> MonthlyMealPlan:
    """Force-regenerate every remaining day of the month with meal engine v3.

    Days before `from_day` inside the straddling week are preserved.
    """
    from src.services.meal_engine_v3_bridge import generate_or_refresh_week_v3, sync_day_entry

    today = parse_local_date(local_date)
    month, year = today.month, today.year
    last_day = days_in_month(month, year)

    if from_day < today.day:
        raise ValueError(
            f"Cannot regenerate past days. Earliest allowed is today (day {today.day})."
        )
    if from_day > last_day:
        raise ValueError("from_day exceeds month length")

    weeks = [w for w in get_month_weeks(year, month) if int(w["end_day"]) >= from_day]
    if not weeks:
        raise ValueError("No days left to regenerate in this month")

    budget_level = _month_budget_level(db, user, month, year)
    logger.info(
        "[MealPlanner] regenerate_remaining_meals user %s from day %s: %s week(s)",
        user.id,
        from_day,
        len(weeks),
    )

    plans: list[MonthlyMealPlan] = []
    for week in weeks:
        start = int(week["start_day"])
        partial = [int(d) for d in week["days"] if int(d) >= from_day]
        existing = get_weekly_plan_by_start_day(db, user.id, month, year, start)

        if start >= from_day or existing is None:
            plans.append(
                generate_or_refresh_week_v3(
                    db,
                    user,
                    budget_level=budget_level,
                    week_start_day=start,
                    local_date=local_date,
                    force=True,
                )
            )
            continue

        # Straddling week — keep the already-eaten days, rebuild the rest.
        plan = generate_or_refresh_week_v3(
            db,
            user,
            budget_level=budget_level,
            week_start_day=start,
            local_date=local_date,
            force=False,
        )
        for day_num in partial:
            sync_day_entry(db, plan, day=day_num, user=user, force=True)
        plan.generated_at = datetime.utcnow()
        onboarding_raw, _ = _onboarding_context(db, user.id)
        plan.onboarding_snapshot_json = encode_snapshot(build_meal_snapshot(onboarding_raw))
        db.add(plan)
        db.commit()
        db.refresh(plan)
        plans.append(plan)

    return _plan_covering_day(plans, today.day) or plans[0]


def swap_meal(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    meal_type: str,
    reason: str | None,
    local_date: str | None,
) -> dict[str, Any]:
    from src.services.meal_engine_v3_bridge import swap_meal_v3

    local = parse_local_date(local_date).isoformat()
    if not is_meal_planner_test_user(user) and not check_swap_allowed(user.id, "meal", local):
        raise SwapLimitExceeded("You've used all your swaps for today. Try again tomorrow.")

    plan = db.query(MonthlyMealPlan).filter(MonthlyMealPlan.id == plan_id, MonthlyMealPlan.user_id == user.id).first()
    if not plan:
        raise LookupError("Plan not found")

    entry = swap_meal_v3(db, user, plan=plan, day=day, meal_type=meal_type)

    if not is_meal_planner_test_user(user):
        increment_swap(user.id, "meal", local)

    targets = _plan_targets_dict(plan, db, user)
    result = _entry_to_day_dict(entry, plan=plan, targets=targets)
    if is_meal_planner_test_user(user):
        result["swaps_used_today"] = 0
        result["swaps_limit"] = 999
    else:
        result["swaps_used_today"] = get_swap_count(user.id, "meal", local)
        result["swaps_limit"] = SWAP_LIMIT_PER_DAY
    return result
