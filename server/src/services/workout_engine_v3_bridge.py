"""Bridge workout engine v3 into existing workout-planner API shapes."""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from src.models.meal_plan import DailyWorkoutPlanEntry, MonthlyWorkoutPlan
from src.models.models import User
from src.services import workout_engine_v3 as v3
from src.services.plan_snapshot import build_workout_snapshot, encode_snapshot
from src.services.planner_common import days_in_month, parse_local_date, safe_json_dumps, safe_json_loads

logger = logging.getLogger(__name__)

ENGINE_V3_SOURCE = "engine_v3"
V3_DAY_REGEN_LIMIT = 20
V3_MONTH_REGEN_LIMIT = 10


def _planner():
    from src.services import workout_planner_service as wps

    return wps


def _engine_ctx_from_user_ctx(user_id: int, ctx: dict[str, Any], *, regen_version: int = 0) -> v3.WorkoutEngineContext:
    onboarding_sex = ""
    return v3.WorkoutEngineContext(
        user_id=user_id,
        workouts_per_week=int(ctx["workouts_per_week"]),
        exercises_per_session=int(ctx["exercises_per_session"]),
        goal_type=str(ctx["goal_type"]),
        difficulty=str(ctx["difficulty"]),
        activity_level=str(ctx["activity_level"]),
        focus_muscles=list(ctx.get("focus_muscles") or []),
        user_weight_kg=float(ctx.get("user_weight_kg") or 70),
        user_sex=onboarding_sex,
        problem_areas=list(ctx.get("problem_areas") or []),
        equipment_access=v3.normalize_equipment_access(str(ctx.get("equipment_access") or "full_gym")),
        regen_version=regen_version,
        week_number=1,
    )


def _split_key_from_entry(entry: DailyWorkoutPlanEntry | None) -> str | None:
    if entry is None:
        return None
    exercises = safe_json_loads(entry.exercises_json)
    if isinstance(exercises, list) and exercises:
        first = exercises[0]
        if isinstance(first, dict) and first.get("split_key"):
            return str(first["split_key"])
    split_name = (entry.split_name or "").lower()
    for key in v3.SPLIT_KEY_MUSCLES:
        if key.replace("_", " ") in split_name or key in split_name:
            return key
    return None


def _recent_exercise_ids_from_plan(plan: MonthlyWorkoutPlan, before_day: int) -> list[int]:
    recent: list[int] = []
    for entry in sorted(plan.entries, key=lambda e: e.day):
        if entry.day >= before_day:
            break
        if entry.is_rest_day:
            continue
        exercises = safe_json_loads(entry.exercises_json)
        if not isinstance(exercises, list):
            continue
        for ex in exercises:
            if isinstance(ex, dict) and ex.get("exercise_id"):
                recent.append(int(ex["exercise_id"]))
    return recent[-30:]


def _write_day(plan_id: int, day_data: dict[str, Any]) -> DailyWorkoutPlanEntry:
    return _planner()._build_daily_workout_entry(plan_id, day_data)

def generate_month_plan_v3(
    db: Session,
    user: User,
    *,
    month: int,
    year: int,
    focus_muscles: list[str],
    days: list[int] | None = None,
    continue_from_split_key: str | None = None,
    regen_version: int = 0,
) -> list[dict[str, Any]]:
    wps = _planner()
    ctx = wps._build_workout_ctx(db, user, focus_muscles=focus_muscles)
    engine_ctx = _engine_ctx_from_user_ctx(user.id, ctx, regen_version=regen_version)
    target_days = days if days is not None else list(range(1, days_in_month(month, year) + 1))
    return v3.generate_month_days(
        db,
        engine_ctx,
        month=month,
        year=year,
        days=target_days,
        continue_from_split_key=continue_from_split_key,
    )


def create_monthly_plan_v3(
    db: Session,
    user: User,
    *,
    focus_muscles: list[str],
    local_date: str | None,
) -> MonthlyWorkoutPlan:
    wps = _planner()
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    all_days = generate_month_plan_v3(db, user, month=month, year=year, focus_muscles=focus_muscles)

    plan = MonthlyWorkoutPlan(
        user_id=user.id,
        month=month,
        year=year,
        generated_at=datetime.utcnow(),
        source=ENGINE_V3_SOURCE,
        day_regens_limit=wps.workout_day_regen_limit_for_user(user) or V3_DAY_REGEN_LIMIT,
        month_plan_regens_limit=wps.workout_month_plan_regen_limit_for_user(user) or V3_MONTH_REGEN_LIMIT,
    )
    wps.plan_set_focus_muscles(plan, focus_muscles)
    db.add(plan)
    db.flush()

    onboarding, _ = wps._onboarding_context(db, user.id)
    plan.onboarding_snapshot_json = encode_snapshot(build_workout_snapshot(onboarding))

    for d in all_days:
        db.add(wps._build_daily_workout_entry(plan.id, d))
    db.commit()
    db.refresh(plan)
    return plan


def regenerate_days_v3(
    db: Session,
    user: User,
    plan: MonthlyWorkoutPlan,
    *,
    from_day: int,
    focus_muscles: list[str],
    continue_from_split_key: str | None = None,
    regen_version: int = 1,
) -> MonthlyWorkoutPlan:
    wps = _planner()
    month, year = plan.month, plan.year
    last_day = days_in_month(month, year)
    if from_day > last_day:
        wps.plan_set_focus_muscles(plan, focus_muscles)
        onboarding, _ = wps._onboarding_context(db, user.id)
        plan.onboarding_snapshot_json = encode_snapshot(build_workout_snapshot(onboarding))
        db.commit()
        db.refresh(plan)
        return plan

    recent = _recent_exercise_ids_from_plan(plan, from_day)
    ctx = wps._build_workout_ctx(db, user, focus_muscles=focus_muscles)
    engine_ctx = _engine_ctx_from_user_ctx(user.id, ctx, regen_version=regen_version)

    new_days = v3.generate_month_days(
        db,
        engine_ctx,
        month=month,
        year=year,
        days=list(range(from_day, last_day + 1)),
        continue_from_split_key=continue_from_split_key,
        prior_recent_ids=recent,
    )

    new_by_day = {d["day"]: d for d in new_days}
    for entry in list(plan.entries):
        if entry.day >= from_day:
            db.delete(entry)
    db.flush()

    for day_num, day_data in new_by_day.items():
        db.add(wps._build_daily_workout_entry(plan.id, day_data))

    wps.plan_set_focus_muscles(plan, focus_muscles)
    plan.source = ENGINE_V3_SOURCE
    onboarding, _ = wps._onboarding_context(db, user.id)
    plan.onboarding_snapshot_json = encode_snapshot(build_workout_snapshot(onboarding))
    db.commit()
    db.refresh(plan)
    return plan


def regenerate_single_day_v3(
    db: Session,
    user: User,
    plan: MonthlyWorkoutPlan,
    entry: DailyWorkoutPlanEntry,
    *,
    regen_version: int | None = None,
) -> dict[str, Any]:
    wps = _planner()
    ctx = wps._build_workout_ctx(db, user, focus_muscles=wps.plan_get_focus_muscles(plan))
    version = regen_version if regen_version is not None else int(getattr(plan, "day_regens_used", 0) or 0) + 1
    engine_ctx = _engine_ctx_from_user_ctx(user.id, ctx, regen_version=version)

    exercises = safe_json_loads(entry.exercises_json)
    exclude_ids = set()
    if isinstance(exercises, list):
        for ex in exercises:
            if isinstance(ex, dict) and ex.get("exercise_id"):
                exclude_ids.add(int(ex["exercise_id"]))

    recent = _recent_exercise_ids_from_plan(plan, entry.day)
    day_data = v3.regenerate_single_day(
        db,
        engine_ctx,
        month=plan.month,
        year=plan.year,
        day=entry.day,
        exclude_exercise_ids=exclude_ids,
        recent_exercise_ids=recent,
    )

    entry.is_rest_day = day_data["is_rest_day"]
    entry.split_name = day_data["split_name"]
    entry.focus_muscles_json = safe_json_dumps(day_data["focus_muscles"])
    entry.exercises_json = safe_json_dumps(day_data["exercises"])
    entry.estimated_duration_min = int(day_data["estimated_duration_min"])
    plan.source = ENGINE_V3_SOURCE
    db.flush()
    return day_data


def swap_exercise_v3(
    db: Session,
    user: User,
    plan: MonthlyWorkoutPlan,
    entry: DailyWorkoutPlanEntry,
    *,
    exercise_index: int,
    original: dict[str, Any],
    other_names: list[str],
) -> dict[str, Any]:
    wps = _planner()
    ctx = wps._build_workout_ctx(db, user, focus_muscles=wps.plan_get_focus_muscles(plan))
    engine_ctx = _engine_ctx_from_user_ctx(user.id, ctx, regen_version=int(getattr(plan, "day_regens_used", 0) or 0))
    recent = _recent_exercise_ids_from_plan(plan, entry.day + 1)
    replacement = v3.swap_exercise_in_day(
        db,
        engine_ctx,
        month=plan.month,
        year=plan.year,
        day=entry.day,
        original_exercise=original,
        other_names=other_names,
        recent_exercise_ids=recent,
    )
    return replacement


def migration_from_day(db: Session, user: User, today: date) -> int:
    """First day to regenerate: tomorrow if today has logs, else today."""
    wps = _planner()
    if wps._has_logged_workout(db, user, today):
        return today.day + 1
    return today.day


def migrate_user_current_month_v3(db: Session, user: User, *, local_date: str | None) -> bool:
    """Idempotent migration of current-month plan to engine v3 (future days only)."""
    wps = _planner()
    today = parse_local_date(local_date)
    plan = wps.get_existing_workout_plan(db, user.id, today.month, today.year)
    if not plan or not plan.entries:
        return False
    if plan.source == ENGINE_V3_SOURCE:
        return False

    from_day = migration_from_day(db, user, today)
    last_day = days_in_month(today.month, today.year)
    if from_day > last_day:
        plan.source = ENGINE_V3_SOURCE
        db.commit()
        return True

    kept_prev = next(
        (e for e in sorted(plan.entries, key=lambda e: e.day, reverse=True) if e.day < from_day),
        None,
    )
    split_key = None
    if kept_prev and not kept_prev.is_rest_day:
        split_name = (kept_prev.split_name or "").lower()
        for key in v3.SPLIT_KEY_MUSCLES:
            if key in split_name.replace("-", "_").replace(" ", "_"):
                split_key = key
                break

    regenerate_days_v3(
        db,
        user,
        plan,
        from_day=from_day,
        focus_muscles=wps.plan_get_focus_muscles(plan),
        continue_from_split_key=split_key,
        regen_version=1,
    )
    logger.info("[WorkoutEngineV3] Migrated user=%s plan=%s from_day=%s", user.id, plan.id, from_day)
    return True
