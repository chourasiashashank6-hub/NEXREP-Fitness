from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from src.db.session import release_db_connection
from src.models.meal_plan import DailyWorkoutPlanEntry, MonthlyWorkoutPlan
from src.models.models import User, UserOnboarding, Workout
from src.services import workout_engine_v3 as v3
from src.services.plan_snapshot import build_workout_snapshot, encode_snapshot, stale_workout_fields
from src.services.planner_common import (
    day_flags,
    days_in_month,
    parse_local_date,
    safe_json_dumps,
    safe_json_loads,
)
from src.services.planner_swap_limits import (
    SWAP_LIMIT_PER_DAY,
    DayRegenLimitExceeded,
    MonthPlanRegenLimitExceeded,
    SwapLimitExceeded,
    check_swap_allowed,
    get_swap_count,
    increment_swap,
)
from src.services.planner_test_users import (
    is_planner_days_unlocked_user,
    is_planner_test_user,
    planner_days_unlocked_flag,
    planner_limits_exempt_flag,
    planner_unlimited_regen_stats,
    workout_day_regen_limit_for_user,
    workout_month_plan_regen_limit_for_user,
)
from src.services.workout_engine_v3_bridge import (
    create_monthly_plan_v3,
    regenerate_days_v3,
    regenerate_single_day_v3,
    swap_exercise_v3,
)

logger = logging.getLogger(__name__)

MONTHLY_WORKOUT_DAY_REGEN_LIMIT = 20
MONTHLY_WORKOUT_MONTH_PLAN_REGEN_LIMIT = 10

BODY_TYPE_LABELS: dict[str, str] = {
    "sk": "Skinny",
    "sf": "Skinny fat",
    "av": "Average",
    "ow": "Overweight",
    "ob": "Obese",
    "mu": "Muscular",
    "cv": "Curvy",
    "ln": "Lean & cut",
    "at": "Athletic",
    "bk": "Bulk & strong",
    "to": "Toned",
    "sc": "Strong & curvy",
}


def _body_label(body_id: str | None) -> str:
    if not body_id:
        return "not specified"
    return BODY_TYPE_LABELS.get(str(body_id).lower().strip(), str(body_id))


def get_exercises_per_session(difficulty: str, activity_level: str, workouts_per_week: int = 4) -> int:
    """Returns how many exercises to include per training day."""
    level = (activity_level or "moderately_active").strip().lower()
    diff = (difficulty or "intermediate").strip().lower()

    if diff == "beginner":
        base = 4
    elif diff == "intermediate":
        base = 6 if level in ("very_active", "extremely_active") else 5
    elif diff == "advanced":
        base = 8 if level in ("very_active", "extremely_active") else 6
    else:
        base = 5

    wpw = max(1, min(7, int(workouts_per_week or 4)))
    if wpw >= 6:
        base = max(base, 6)
    elif wpw >= 5:
        base = max(base, 5)
    elif wpw <= 2:
        base = min(base, 4)

    return base


def plan_get_focus_muscles(plan: MonthlyWorkoutPlan) -> list[str]:
    raw = getattr(plan, "focus_muscles_json", None)
    if raw:
        parsed = safe_json_loads(raw)
        if isinstance(parsed, list):
            return [str(m) for m in parsed if m]
    if plan.focus_muscle:
        return [str(plan.focus_muscle)]
    return []


def plan_set_focus_muscles(plan: MonthlyWorkoutPlan, muscles: list[str] | None) -> None:
    cleaned = [m for m in (muscles or []) if m]
    if cleaned:
        plan.focus_muscles_json = safe_json_dumps(cleaned)
        plan.focus_muscle = cleaned[0]
    else:
        plan.focus_muscles_json = None
        plan.focus_muscle = None


def _focus_muscles_for_split(split_name: str) -> list[str]:
    """Fallback focus list when a day has no stored focus_muscles_json (Smart Reflow)."""
    name = split_name.lower().replace(".", "_").replace("-", "_")
    if "push" in name:
        return ["Chest", "Shoulders", "Triceps"]
    if "pull" in name:
        return ["Back", "Biceps", "Rear Delts"]
    if "leg" in name or "lower" in name:
        return ["Quads", "Hamstrings", "Glutes", "Calves"]
    if "upper" in name:
        return ["Chest", "Back", "Shoulders", "Arms"]
    if "full_body" in name or "full body" in split_name.lower():
        return ["Chest", "Back", "Legs", "Shoulders"]
    return ["Chest", "Shoulders", "Triceps"]


def _onboarding_context(db: Session, user_id: int) -> tuple[dict, dict]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}
    targets = row.targets_json if row and isinstance(row.targets_json, dict) else {}
    return onboarding, targets


def _resolve_focus_muscles(db: Session, user: User, requested: list[str] | None) -> list[str]:
    if requested is not None:
        return [str(m).strip() for m in requested if m and str(m).strip()]
    onboarding, _ = _onboarding_context(db, user.id)
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    stored_list = goal.get("focus_muscles")
    if isinstance(stored_list, list):
        return [str(m).strip() for m in stored_list if m and str(m).strip()]
    stored = goal.get("focus_muscle")
    return [str(stored).strip()] if stored else []


def _focus_key_from_list(muscles: list[str] | None) -> tuple[str, ...]:
    return tuple(sorted({m.strip().lower() for m in (muscles or []) if m and m.strip()}))


def _focus_key(plan: MonthlyWorkoutPlan) -> tuple[str, ...]:
    return _focus_key_from_list(plan_get_focus_muscles(plan))


def _has_logged_workout(db: Session, user: User, day_value: date | datetime) -> bool:
    d = day_value.date() if isinstance(day_value, datetime) else day_value
    start = datetime.combine(d, datetime.min.time())
    end = start + timedelta(days=1)
    return (
        db.query(Workout.id)
        .filter(
            Workout.user_id == user.id,
            Workout.date >= start,
            Workout.date < end,
        )
        .first()
        is not None
    )


def _regen_boundary_day(db: Session, user: User, today: date | datetime) -> int:
    if _has_logged_workout(db, user, today):
        return today.day + 1
    return today.day


def _build_daily_workout_entry(plan_id: int, day_data: dict[str, Any]) -> DailyWorkoutPlanEntry:
    return DailyWorkoutPlanEntry(
        plan_id=plan_id,
        day=int(day_data["day"]),
        is_rest_day=bool(day_data.get("is_rest_day")),
        split_name=str(day_data.get("split_name") or "Rest Day"),
        focus_muscles_json=safe_json_dumps(day_data.get("focus_muscles") or []),
        exercises_json=safe_json_dumps(day_data.get("exercises") or []),
        estimated_duration_min=int(day_data.get("estimated_duration_min") or 0),
    )


def _build_workout_ctx(
    db: Session,
    user: User,
    *,
    focus_muscles: list[str] | None = None,
) -> dict[str, Any]:
    onboarding, _ = _onboarding_context(db, user.id)
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}

    if focus_muscles is None:
        stored_list = goal.get("focus_muscles")
        if isinstance(stored_list, list):
            focus_muscles = [str(m).strip() for m in stored_list if m and str(m).strip()]
        else:
            stored = goal.get("focus_muscle")
            focus_muscles = [str(stored)] if stored else []

    difficulty = str(goal.get("difficulty") or "intermediate").strip().lower()
    activity_level = str(activity.get("level") or "moderately_active").strip().lower()
    workouts_per_week = int(activity.get("workouts_per_week") or 4)
    exercises_per_session = get_exercises_per_session(difficulty, activity_level, workouts_per_week)

    body_type_data = onboarding.get("body_type") or {}
    if not isinstance(body_type_data, dict):
        body_type_data = {}

    return {
        "workouts_per_week": workouts_per_week,
        "exercises_per_session": exercises_per_session,
        "goal_type": str(goal.get("type") or "muscle_gain"),
        "difficulty": difficulty,
        "activity_level": activity_level,
        "focus_muscles": focus_muscles,
        "has_muscle_focus": len(focus_muscles) > 0,
        "workout_types": activity.get("workout_types") if isinstance(activity.get("workout_types"), list) else ["strength"],
        "preferred_language": user.preferred_language,
        "user_weight_kg": float(personal.get("weight_kg") or user.weight or 70),
        "current_body_type": _body_label(body_type_data.get("current_body_id")),
        "goal_body_type": _body_label(body_type_data.get("goal_body_id")),
        "problem_areas": body_type_data.get("problem_areas", []),
        "equipment_access": v3.normalize_equipment_access(
            str(activity.get("equipment_access") or "full_gym")
        ),
    }


def get_existing_workout_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyWorkoutPlan | None:
    from sqlalchemy.orm import joinedload

    plan = (
        db.query(MonthlyWorkoutPlan)
        .options(joinedload(MonthlyWorkoutPlan.entries))
        .filter(MonthlyWorkoutPlan.user_id == user_id, MonthlyWorkoutPlan.month == month, MonthlyWorkoutPlan.year == year)
        .first()
    )
    if plan and not plan.entries:
        return None
    return plan


def generate_workout_plan(
    db: Session,
    user: User,
    *,
    focus_muscles: list[str] | None,
    local_date: str | None,
) -> MonthlyWorkoutPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    effective_focus = _resolve_focus_muscles(db, user, focus_muscles)
    existing = get_existing_workout_plan(db, user.id, month, year)
    if existing:
        db.refresh(existing)
        if existing.entries:
            if _focus_key(existing) == _focus_key_from_list(effective_focus):
                return existing
            from_day = _regen_boundary_day(db, user, today)
            return regenerate_remaining_workouts(
                db,
                user,
                from_day=from_day,
                focus_muscles=effective_focus,
                local_date=local_date,
            )
        logger.warning(
            "[WorkoutPlanner] user=%s: removing empty plan id=%s for %s-%s",
            user.id,
            existing.id,
            month,
            year,
        )
        db.delete(existing)
        db.flush()

    logger.info(
        "[WorkoutPlanner] user=%s: generating engine_v3 plan focus=%s",
        user.id,
        effective_focus,
    )
    return create_monthly_plan_v3(
        db,
        user,
        focus_muscles=effective_focus,
        local_date=local_date,
    )


def _workout_entry_dict(entry: DailyWorkoutPlanEntry, *, locked: bool = False) -> dict[str, Any]:
    if locked:
        return {
            "day": entry.day,
            "is_rest_day": entry.is_rest_day,
            "locked": True,
            "message": f"This day's plan will be available on day {entry.day}",
        }
    return {
        "day": entry.day,
        "is_rest_day": entry.is_rest_day,
        "split_name": entry.split_name,
        "focus_muscles": safe_json_loads(entry.focus_muscles_json),
        "exercises": safe_json_loads(entry.exercises_json),
        "estimated_duration_min": entry.estimated_duration_min,
    }


def _monthly_workout_day_regen_stats(
    db: Session,
    user_id: int,
    month: int,
    year: int,
    *,
    user: User | None = None,
) -> dict[str, int | bool]:
    custom_limit = workout_day_regen_limit_for_user(user)
    if user and is_planner_test_user(user) and custom_limit is None:
        return planner_unlimited_regen_stats()

    plan = get_existing_workout_plan(db, user_id, month, year)
    used = int(plan.day_regens_used or 0) if plan else 0
    if custom_limit is not None:
        limit = custom_limit
    else:
        limit = int(plan.day_regens_limit or MONTHLY_WORKOUT_DAY_REGEN_LIMIT) if plan else MONTHLY_WORKOUT_DAY_REGEN_LIMIT
    remaining = max(0, limit - used)
    return {
        "day_regens_used": used,
        "day_regens_limit": limit,
        "day_regens_remaining": remaining,
        **planner_limits_exempt_flag(user),
    }


def _monthly_workout_month_plan_regen_stats(
    db: Session,
    user_id: int,
    month: int,
    year: int,
    *,
    user: User | None = None,
) -> dict[str, int | bool]:
    custom_limit = workout_month_plan_regen_limit_for_user(user)
    if user and is_planner_test_user(user) and custom_limit is None:
        return {
            "month_plan_regens_used": 0,
            "month_plan_regens_limit": 999,
            "month_plan_regens_remaining": 999,
        }

    plan = get_existing_workout_plan(db, user_id, month, year)
    used = int(plan.month_plan_regens_used or 0) if plan else 0
    if custom_limit is not None:
        limit = custom_limit
    else:
        limit = (
            int(plan.month_plan_regens_limit or MONTHLY_WORKOUT_MONTH_PLAN_REGEN_LIMIT)
            if plan
            else MONTHLY_WORKOUT_MONTH_PLAN_REGEN_LIMIT
        )
    remaining = max(0, limit - used)
    return {
        "month_plan_regens_used": used,
        "month_plan_regens_limit": limit,
        "month_plan_regens_remaining": remaining,
    }


def _attach_workout_day_regen_stats(payload: dict[str, Any], stats: dict[str, int | bool]) -> dict[str, Any]:
    payload.update(stats)
    return payload


def workout_plan_current_response(
    plan: MonthlyWorkoutPlan,
    local_date: str | None,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    entries = sorted(plan.entries, key=lambda e: e.day)
    today_entry = next((e for e in entries if e.day == today.day), None)
    month_overview = []
    for e in entries:
        flags = day_flags(e.day, today, plan.month, plan.year)
        month_overview.append(
            {
                "day": e.day,
                "split_name": e.split_name,
                "is_rest_day": e.is_rest_day,
                **flags,
            }
        )
    payload = {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "focus_muscles": plan_get_focus_muscles(plan),
        "focus_muscle": plan.focus_muscle,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "today": _workout_entry_dict(today_entry, locked=False) if today_entry else None,
        "month_overview": month_overview,
    }
    if db is not None and user is not None:
        payload.update(_monthly_workout_day_regen_stats(db, user.id, plan.month, plan.year, user=user))
        payload.update(_monthly_workout_month_plan_regen_stats(db, user.id, plan.month, plan.year, user=user))
        payload.update(planner_days_unlocked_flag(user))
        onboarding_raw, _ = _onboarding_context(db, user.id)
        stale = stale_workout_fields(plan.onboarding_snapshot_json, onboarding_raw)
        payload["stale_fields"] = stale
        payload["is_stale"] = len(stale) > 0
    return payload


def _refresh_workout_entry_exercises(
    db: Session,
    user: User,
    plan: MonthlyWorkoutPlan,
    entry: DailyWorkoutPlanEntry,
    *,
    ctx: dict[str, Any] | None = None,
) -> None:
    regenerate_single_day_v3(db, user, plan, entry)


def regenerate_single_workout_day(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year

    if day < today.day and today.month == month and today.year == year:
        raise ValueError(f"Cannot regenerate past days. Day {day} has already passed.")

    if (
        day > today.day
        and today.month == month
        and today.year == year
        and not is_planner_days_unlocked_user(user)
    ):
        raise ValueError(
            f"Cannot regenerate future days. This day's plan unlocks on day {day}."
        )

    test_user = is_planner_test_user(user)
    if not test_user:
        regen_stats = _monthly_workout_day_regen_stats(db, user.id, month, year, user=user)
        if regen_stats["day_regens_remaining"] <= 0:
            limit = regen_stats["day_regens_limit"]
            raise DayRegenLimitExceeded(
                f"You have used all {limit} workout regenerations for this month. "
                "You can still swap individual exercises."
            )

    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(
            MonthlyWorkoutPlan.id == plan_id,
            MonthlyWorkoutPlan.user_id == user.id,
            MonthlyWorkoutPlan.month == month,
            MonthlyWorkoutPlan.year == year,
        )
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")

    existing_entry = (
        db.query(DailyWorkoutPlanEntry)
        .filter(DailyWorkoutPlanEntry.plan_id == plan.id, DailyWorkoutPlanEntry.day == day)
        .first()
    )
    if not existing_entry:
        raise LookupError("Day not found")
    if existing_entry.is_rest_day:
        raise ValueError("Cannot regenerate a rest day")

    ctx = _build_workout_ctx(db, user, focus_muscles=plan_get_focus_muscles(plan))
    release_db_connection(db)
    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(
            MonthlyWorkoutPlan.id == plan_id,
            MonthlyWorkoutPlan.user_id == user.id,
            MonthlyWorkoutPlan.month == month,
            MonthlyWorkoutPlan.year == year,
        )
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")
    existing_entry = (
        db.query(DailyWorkoutPlanEntry)
        .filter(DailyWorkoutPlanEntry.plan_id == plan.id, DailyWorkoutPlanEntry.day == day)
        .first()
    )
    if not existing_entry:
        raise LookupError("Day not found")
    if existing_entry.is_rest_day:
        raise ValueError("Cannot regenerate a rest day")

    try:
        _refresh_workout_entry_exercises(db, user, plan, existing_entry, ctx=ctx)
        if not test_user:
            plan.day_regens_used = int(plan.day_regens_used or 0) + 1
        db.commit()
        db.refresh(existing_entry)
        db.refresh(plan)
    except Exception as db_exc:
        db.rollback()
        logger.exception("[WorkoutPlanner] DB error on workout day regen for day %s: %s", day, db_exc)
        raise RuntimeError("Failed to save regenerated workout. Please try again.") from db_exc

    result = _workout_entry_dict(existing_entry, locked=False)
    return _attach_workout_day_regen_stats(
        result,
        _monthly_workout_day_regen_stats(db, user.id, month, year, user=user),
    )


def workout_plan_month_response(plan: MonthlyWorkoutPlan, local_date: str | None) -> dict[str, Any]:
    today = parse_local_date(local_date)
    days_out = []
    for e in sorted(plan.entries, key=lambda x: x.day):
        flags = day_flags(e.day, today, plan.month, plan.year)
        row = {
            "day": e.day,
            "split_name": e.split_name,
            "is_rest_day": e.is_rest_day,
            "estimated_duration_min": e.estimated_duration_min,
            **flags,
        }
        if not flags["is_future"]:
            row["focus_muscles"] = safe_json_loads(e.focus_muscles_json)
            row["exercises"] = safe_json_loads(e.exercises_json)
        days_out.append(row)
    return {"plan_id": plan.id, "month": plan.month, "year": plan.year, "days": days_out}


def delete_workout_plan(db: Session, plan: MonthlyWorkoutPlan) -> None:
    db.delete(plan)
    db.commit()


def regenerate_month_plan_workouts(
    db: Session,
    user: User,
    *,
    plan_id: int,
    local_date: str | None,
) -> dict[str, Any]:
    """Regenerate today + future days via engine v3."""
    today = parse_local_date(local_date)
    month, year = today.month, today.year

    test_user = is_planner_test_user(user)
    if not test_user:
        month_stats = _monthly_workout_month_plan_regen_stats(db, user.id, month, year, user=user)
        if month_stats["month_plan_regens_remaining"] <= 0:
            limit = month_stats["month_plan_regens_limit"]
            raise MonthPlanRegenLimitExceeded(
                f"You have used all {limit} month plan regenerations for this month."
            )

    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(
            MonthlyWorkoutPlan.id == plan_id,
            MonthlyWorkoutPlan.user_id == user.id,
            MonthlyWorkoutPlan.month == month,
            MonthlyWorkoutPlan.year == year,
        )
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")

    focus_muscles = _resolve_focus_muscles(db, user, None) or plan_get_focus_muscles(plan)

    try:
        plan = regenerate_remaining_workouts(
            db,
            user,
            from_day=today.day,
            focus_muscles=focus_muscles,
            local_date=local_date,
        )
        if not test_user:
            plan = (
                db.query(MonthlyWorkoutPlan)
                .filter(MonthlyWorkoutPlan.id == plan_id, MonthlyWorkoutPlan.user_id == user.id)
                .first()
            ) or plan
            plan.month_plan_regens_used = int(plan.month_plan_regens_used or 0) + 1
            db.commit()
            db.refresh(plan)
    except Exception as db_exc:
        db.rollback()
        logger.exception("[WorkoutPlanner] DB error on month plan regen: %s", db_exc)
        raise RuntimeError("Failed to save regenerated month plan. Please try again.") from db_exc

    return workout_plan_current_response(plan, local_date, db=db, user=user)


def regenerate_remaining_workouts(
    db: Session,
    user: User,
    *,
    from_day: int,
    focus_muscles: list[str],
    local_date: str | None,
) -> MonthlyWorkoutPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    last_day = days_in_month(month, year)

    if from_day < today.day:
        raise ValueError(
            f"Cannot regenerate past days. Earliest allowed is today (day {today.day})."
        )

    plan = get_existing_workout_plan(db, user.id, month, year)
    if not plan or not plan.entries:
        return generate_workout_plan(db, user, focus_muscles=focus_muscles, local_date=local_date)

    if from_day > last_day:
        plan_set_focus_muscles(plan, focus_muscles)
        onboarding_raw, _ = _onboarding_context(db, user.id)
        plan.onboarding_snapshot_json = encode_snapshot(build_workout_snapshot(onboarding_raw))
        db.commit()
        db.refresh(plan)
        return plan

    kept_prev = next(
        (entry for entry in sorted(plan.entries, key=lambda entry: entry.day, reverse=True) if entry.day < from_day),
        None,
    )
    split_key = None
    if kept_prev and not kept_prev.is_rest_day:
        split_name = (kept_prev.split_name or "").lower()
        for key in ("push_a", "push_b", "pull_a", "pull_b", "legs_a", "legs_b", "push", "pull", "legs", "upper", "lower", "full_body"):
            if key.replace("_", " ") in split_name or key in split_name.replace("-", "_").replace(".", "_"):
                split_key = key
                break

    logger.info(
        "[WorkoutPlanner] Regenerating user=%s from day %s via engine_v3 focus=%s",
        user.id,
        from_day,
        focus_muscles,
    )

    return regenerate_days_v3(
        db,
        user,
        plan,
        from_day=from_day,
        focus_muscles=focus_muscles,
        continue_from_split_key=split_key,
        regen_version=int(plan.month_plan_regens_used or 0) + 1,
    )


def swap_exercise(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    exercise_index: int,
    reason: str | None,
    local_date: str | None,
) -> dict[str, Any]:
    local = parse_local_date(local_date).isoformat()
    if not check_swap_allowed(user.id, "exercise", local):
        raise SwapLimitExceeded("You've used all your swaps for today. Try again tomorrow.")

    plan = db.query(MonthlyWorkoutPlan).filter(MonthlyWorkoutPlan.id == plan_id, MonthlyWorkoutPlan.user_id == user.id).first()
    if not plan:
        raise LookupError("Plan not found")

    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        raise LookupError("Day not found")
    if entry.is_rest_day:
        raise ValueError("Cannot swap exercises on a rest day")

    exercises = safe_json_loads(entry.exercises_json)
    if not isinstance(exercises, list) or exercise_index < 0 or exercise_index >= len(exercises):
        raise LookupError("Exercise index not found")

    original = exercises[exercise_index]
    if not isinstance(original, dict):
        raise ValueError("Invalid exercise data")

    other_names = [str(ex.get("name", "")) for ex in exercises if isinstance(ex, dict)]

    try:
        replacement = swap_exercise_v3(
            db,
            user,
            plan,
            entry,
            exercise_index=exercise_index,
            original=original,
            other_names=other_names,
        )
    except Exception as exc:
        logger.exception("[WorkoutPlanner] engine_v3 swap failed: %s", exc)
        raise RuntimeError("Failed to swap exercise. Please try again.") from exc

    exercises[exercise_index] = replacement
    entry.exercises_json = safe_json_dumps(exercises)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    increment_swap(user.id, "exercise", local)

    result = _workout_entry_dict(entry)
    result["swaps_used_today"] = get_swap_count(user.id, "exercise", local)
    result["swaps_limit"] = SWAP_LIMIT_PER_DAY
    return result
