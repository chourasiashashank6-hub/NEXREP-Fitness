from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from src.models.meal_plan import DailyWorkoutPlanEntry, MonthlyWorkoutPlan
from src.models.models import GlobalExercise, User, UserOnboarding, Workout
from src.services.planner_common import parse_local_date, safe_json_dumps, safe_json_loads
from src.services.planner_test_users import is_planner_days_unlocked_user
from src.services.workout_planner_service import _focus_muscles_for_split, get_existing_workout_plan, _workout_entry_dict
from src.utils.plan_check import require_feature

PLANNER_SOURCE_MARKER = "source=workout_planner"
REFLOW_MAX_EXERCISES_PER_DAY = 8
PLANNER_BASE_EXERCISES_PER_DAY = 6

LEG_MUSCLES = {"legs", "quads", "hamstrings", "glutes", "calves"}
PUSH_MUSCLES = {"chest", "shoulders", "triceps"}
PULL_MUSCLES = {"back", "biceps", "rear delts", "lats"}
UPPER_MUSCLES = PUSH_MUSCLES | PULL_MUSCLES | {"arms"}


def is_planner_logged_workout(notes: str | None) -> bool:
    return PLANNER_SOURCE_MARKER in (notes or "").lower()


def _day_date(year: int, month: int, day: int) -> date:
    return date(year, month, day)


def _day_datetime_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, datetime.min.time())
    return start, start + timedelta(days=1)


def day_has_any_planner_log(db: Session, user_id: int, year: int, month: int, day: int) -> bool:
    """True when any planner-checkbox workout exists on this calendar day."""
    start, end = _day_datetime_bounds(_day_date(year, month, day))
    rows = (
        db.query(Workout.notes)
        .filter(
            Workout.user_id == user_id,
            Workout.date >= start,
            Workout.date < end,
        )
        .all()
    )
    return any(is_planner_logged_workout(row[0]) for row in rows)


def day_has_any_workout_log(db: Session, user_id: int, year: int, month: int, day: int) -> bool:
    start, end = _day_datetime_bounds(_day_date(year, month, day))
    return (
        db.query(Workout.id)
        .filter(
            Workout.user_id == user_id,
            Workout.date >= start,
            Workout.date < end,
        )
        .first()
        is not None
    )


def day_planner_exercises_fully_logged(db: Session, user_id: int, log_date: date) -> bool:
    """True when every exercise on the plan day has a planner-checkbox workout log."""
    plan = get_existing_workout_plan(db, user_id, log_date.month, log_date.year)
    if not plan:
        return False
    entry = next((row for row in plan.entries if row.day == log_date.day), None)
    if not entry or entry.is_rest_day:
        return False
    exercises = safe_json_loads(entry.exercises_json) or []
    if not exercises:
        return False

    start, end = _day_datetime_bounds(log_date)
    rows = (
        db.query(Workout.exercise_name, Workout.notes)
        .filter(
            Workout.user_id == user_id,
            Workout.date >= start,
            Workout.date < end,
        )
        .all()
    )
    logged_names = {
        (name or "").strip().lower()
        for name, notes in rows
        if is_planner_logged_workout(notes)
    }
    for exercise in exercises:
        target = str(exercise.get("name") or "").strip().lower()
        if not target or target not in logged_names:
            return False
    return True


def _parse_reps(reps: Any) -> int:
    if isinstance(reps, (int, float)):
        n = int(reps)
        return n if n > 0 else 10
    try:
        n = int(str(reps).split("-")[0].strip())
        return n if n > 0 else 10
    except (TypeError, ValueError):
        return 10


def estimate_duration_min(exercises: list[dict[str, Any]]) -> int:
    total_seconds = 0
    for exercise in exercises:
        if not isinstance(exercise, dict):
            continue
        sets = max(1, int(exercise.get("sets") or 1))
        reps = _parse_reps(exercise.get("reps"))
        rest_sec = max(0, int(exercise.get("rest_seconds") or 45))
        active_seconds = sets * reps * 2.2
        rest_seconds = max(0, sets - 1) * rest_sec
        total_seconds += max(60, round(active_seconds + rest_seconds))
    if not exercises:
        return 0
    return max(1, (total_seconds + 59) // 60)


def _is_day_locked(day: int, today: date, plan_month: int, plan_year: int, user: User) -> bool:
    if today.month != plan_month or today.year != plan_year:
        return False
    if day <= today.day:
        return False
    return not is_planner_days_unlocked_user(user)


def _normalize_exercises(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict) and item.get("name"):
            out.append(item)
    return out


def _exercise_names(exercises: list[dict[str, Any]]) -> set[str]:
    return {(str(ex.get("name") or "")).strip().lower() for ex in exercises if ex.get("name")}


def _split_family(split_name: str) -> str:
    name = (split_name or "").lower()
    normalized = name.replace(".", "_").replace("-", "_")
    if "push" in name:
        return "push"
    if "pull" in name:
        return "pull"
    if "leg" in name or "lower" in name:
        return "legs"
    if "upper" in name:
        return "upper"
    if "full_body" in normalized or "full body" in name or "full-body" in name:
        return "full_body"
    return "unknown"


def _resolve_day_focus_muscles(entry: DailyWorkoutPlanEntry) -> list[str]:
    stored = safe_json_loads(entry.focus_muscles_json)
    if isinstance(stored, list) and stored:
        return [str(m) for m in stored if m]
    return _focus_muscles_for_split(entry.split_name)


def _muscle_matches_any(exercise_muscle: str, focus_muscles: list[str]) -> bool:
    ex = (exercise_muscle or "").strip().lower()
    if not ex:
        return False
    for raw in focus_muscles:
        focus = str(raw or "").strip().lower()
        if not focus:
            continue
        if ex == focus or focus in ex or ex in focus:
            return True
        if focus == "legs" and any(leg in ex or ex in leg for leg in LEG_MUSCLES):
            return True
        if focus == "arms" and ("bicep" in ex or "tricep" in ex or ex == "arms"):
            return True
    return False


def _exercise_matches_split_family(exercise_muscle: str, family: str) -> bool:
    ex = (exercise_muscle or "").strip().lower()
    if not ex:
        return False
    if family == "full_body":
        return True
    if family == "legs":
        return any(leg in ex or ex in leg for leg in LEG_MUSCLES)
    if family == "push":
        return any(muscle in ex or ex in muscle for muscle in PUSH_MUSCLES)
    if family == "pull":
        return any(muscle in ex or ex in muscle for muscle in PULL_MUSCLES)
    if family == "upper":
        return any(muscle in ex or ex in muscle for muscle in UPPER_MUSCLES) and not any(
            leg in ex or ex in leg for leg in LEG_MUSCLES
        )
    return False


def _is_exercise_compatible_with_day(exercise: dict[str, Any], entry: DailyWorkoutPlanEntry) -> bool:
    focus = _resolve_day_focus_muscles(entry)
    if any(str(m).strip().lower() == "full body" for m in focus):
        return True
    muscle = str(exercise.get("muscle") or "")
    if _muscle_matches_any(muscle, focus):
        return True
    return _exercise_matches_split_family(muscle, _split_family(entry.split_name))


def _remaining_reflow_slots(exercise_count: int) -> int:
    return max(0, REFLOW_MAX_EXERCISES_PER_DAY - exercise_count)


def _is_missed_plan_day(entry_date: date, today: date, has_workout_log: bool) -> bool:
    """A plan day is missed only after the local calendar day has fully passed."""
    if entry_date >= today:
        return False
    return not has_workout_log


def _dedupe_exercises_by_name(exercises: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    kept: list[dict[str, Any]] = []
    for exercise in exercises:
        name = (str(exercise.get("name") or "")).strip().lower()
        if not name or name in seen:
            continue
        seen.add(name)
        kept.append(exercise)
    return kept


def _trim_exercises_to_cap(exercises: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trimmed = list(exercises)
    while len(trimmed) > REFLOW_MAX_EXERCISES_PER_DAY:
        reflow_index = next(
            (index for index, exercise in enumerate(trimmed) if exercise.get("reflow_source_day")),
            -1,
        )
        if reflow_index >= 0:
            trimmed.pop(reflow_index)
        else:
            trimmed.pop()
    return trimmed


def _repair_day_exercises(exercises: list[dict[str, Any]], entry: DailyWorkoutPlanEntry) -> list[dict[str, Any]]:
    """Keep valid Smart Reflow writes; fix duplicates, over-cap, and incompatible reflow only."""
    normalized = _normalize_exercises(exercises)
    repaired = _dedupe_exercises_by_name(normalized)
    repaired = [
        exercise
        for exercise in repaired
        if not exercise.get("reflow_source_day") or _is_exercise_compatible_with_day(exercise, entry)
    ]
    repaired = _trim_exercises_to_cap(repaired)

    has_reflow = any(exercise.get("reflow_source_day") for exercise in repaired)
    target = min(PLANNER_BASE_EXERCISES_PER_DAY, REFLOW_MAX_EXERCISES_PER_DAY)
    if not has_reflow and len(repaired) > target:
        repaired = repaired[:target]
    return repaired


def _day_needs_repair(exercises: list[dict[str, Any]], entry: DailyWorkoutPlanEntry) -> bool:
    normalized = _normalize_exercises(exercises)
    if not normalized:
        return False
    if len(normalized) > REFLOW_MAX_EXERCISES_PER_DAY:
        return True
    if len(_exercise_names(normalized)) < len(normalized):
        return True
    if any(
        exercise.get("reflow_source_day") and not _is_exercise_compatible_with_day(exercise, entry)
        for exercise in normalized
    ):
        return True
    has_reflow = any(exercise.get("reflow_source_day") for exercise in normalized)
    target = min(PLANNER_BASE_EXERCISES_PER_DAY, REFLOW_MAX_EXERCISES_PER_DAY)
    if not has_reflow and len(normalized) > target:
        return True
    return False


def apply_reflow_patches(
    db: Session,
    user: User,
    *,
    plan_id: int,
    patches: list[dict[str, Any]],
    local_date: str | None,
) -> dict[str, Any]:
    """
    Apply client-computed reflow patches. Validates ownership, locked days, and
    that target days have zero planner logs. Does not consume regen quota.
    """
    require_feature(user, "smart_reflow", db)
    today = parse_local_date(local_date)

    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.id == plan_id, MonthlyWorkoutPlan.user_id == user.id)
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")
    if plan.month != today.month or plan.year != today.year:
        raise ValueError("Reflow only applies to the current month plan")

    if not patches:
        return {"applied_days": [], "plan_id": plan.id}

    entry_by_day = {entry.day: entry for entry in plan.entries}
    applied: list[int] = []

    for patch in patches:
        day = int(patch.get("day") or 0)
        if day <= 0:
            raise ValueError(f"Invalid day: {day}")
        entry = entry_by_day.get(day)
        if not entry:
            raise LookupError(f"Day {day} not found")
        if entry.is_rest_day:
            raise ValueError(f"Cannot reflow into rest day {day}")
        if _is_day_locked(day, today, plan.month, plan.year, user):
            raise ValueError(f"Day {day} is locked")
        if day_has_any_planner_log(db, user.id, plan.year, plan.month, day):
            raise ValueError(f"Day {day} already has logged exercises")

        incoming = _normalize_exercises(patch.get("exercises"))
        if not incoming:
            raise ValueError(f"Day {day} patch has no exercises")

        existing = _normalize_exercises(safe_json_loads(entry.exercises_json))
        if existing:
            existing_names = _exercise_names(existing)
            changed = False
            for exercise in incoming:
                name = (str(exercise.get("name") or "")).strip().lower()
                if name and name not in existing_names:
                    existing.append(exercise)
                    existing_names.add(name)
                    changed = True
            if not changed:
                continue
            final_exercises = existing
        else:
            final_exercises = incoming

        if len(final_exercises) > REFLOW_MAX_EXERCISES_PER_DAY:
            raise ValueError(
                f"Day {day} would exceed the reflow exercise cap ({REFLOW_MAX_EXERCISES_PER_DAY})"
            )

        duration = int(patch.get("estimated_duration_min") or 0)
        if duration <= 0:
            duration = estimate_duration_min(final_exercises)

        entry.exercises_json = safe_json_dumps(final_exercises)
        entry.estimated_duration_min = duration
        db.add(entry)
        applied.append(day)

    if applied:
        db.commit()

    updated_days = []
    for day in applied:
        entry = entry_by_day[day]
        db.refresh(entry)
        updated_days.append(_workout_entry_dict(entry))

    return {"applied_days": applied, "plan_id": plan.id, "days": updated_days}


def repair_smart_reflow_plan(
    db: Session,
    user: User,
    *,
    plan_id: int,
    local_date: str | None,
) -> dict[str, Any]:
    """Repair invalid planner day states (cap, duplicates, incompatible reflow)."""
    require_feature(user, "smart_reflow", db)

    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.id == plan_id, MonthlyWorkoutPlan.user_id == user.id)
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")

    repaired_days: list[int] = []
    updated_days: list[dict[str, Any]] = []

    for entry in plan.entries:
        if entry.is_rest_day:
            continue
        exercises = _normalize_exercises(safe_json_loads(entry.exercises_json))
        if not exercises:
            continue
        if not _day_needs_repair(exercises, entry):
            continue

        kept = _repair_day_exercises(exercises, entry)

        entry.exercises_json = safe_json_dumps(kept)
        entry.estimated_duration_min = estimate_duration_min(kept)
        db.add(entry)
        repaired_days.append(entry.day)

        entry.exercises_json = safe_json_dumps(kept)
        entry.estimated_duration_min = estimate_duration_min(kept)
        db.add(entry)
        repaired_days.append(entry.day)

    if repaired_days:
        db.commit()
        entry_by_day = {entry.day: entry for entry in plan.entries}
        for day in repaired_days:
            entry = entry_by_day[day]
            db.refresh(entry)
            updated_days.append(_workout_entry_dict(entry))

    return {"repaired_days": repaired_days, "plan_id": plan.id, "days": updated_days}


def weekly_summary_enabled(db: Session, user_id: int) -> bool:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    if not row or not isinstance(row.onboarding_json, dict):
        return True
    app_setup = row.onboarding_json.get("app_setup")
    if not isinstance(app_setup, dict):
        return True
    notifications = app_setup.get("notifications")
    if not isinstance(notifications, dict):
        return True
    return bool(notifications.get("weekly_summary", True))


def _body_part_from_notes(notes: str | None) -> str | None:
    for part in (notes or "").split(";"):
        piece = part.strip()
        if piece.lower().startswith("body_part="):
            return piece.split("=", 1)[1].strip()
    return None


def build_weekly_review(db: Session, user: User, local_date: str | None) -> dict[str, Any]:
    """Compare planned vs actual for the past 7 local days.

    A day counts as completed when *any* workout is logged (manual or planner).
    Smart Reflow source-day detection uses planner-checkbox logs only so reflow
    does not re-append exercises the user already checked off in the planner.
    """
    today = parse_local_date(local_date)
    week_start = today - timedelta(days=6)
    plan = get_existing_workout_plan(db, user.id, today.month, today.year)

    planned_days = 0
    completed_days = 0
    missed_days: list[int] = []
    muscle_counts: dict[str, int] = {}
    planned_muscle_sets: dict[str, int] = {}

    if plan:
        for entry in plan.entries:
            entry_date = _day_date(plan.year, plan.month, entry.day)
            if entry_date < week_start or entry_date > today:
                continue
            if entry.is_rest_day:
                continue
            planned_days += 1
            for exercise in _normalize_exercises(safe_json_loads(entry.exercises_json)):
                muscle = str(exercise.get("muscle") or "Other").strip() or "Other"
                planned_muscle_sets[muscle] = planned_muscle_sets.get(muscle, 0) + max(1, int(exercise.get("sets") or 1))
            has_log = day_has_any_workout_log(db, user.id, plan.year, plan.month, entry.day)
            if has_log:
                completed_days += 1
            elif _is_missed_plan_day(entry_date, today, has_log):
                missed_days.append(entry.day)

    start_dt, _ = _day_datetime_bounds(week_start)
    _, end_dt = _day_datetime_bounds(today)
    workouts = (
        db.query(Workout)
        .filter(
            Workout.user_id == user.id,
            Workout.date >= start_dt,
            Workout.date < end_dt,
        )
        .all()
    )
    for workout in workouts:
        muscle = _body_part_from_notes(workout.notes) or (workout.exercise_name or "Other")
        key = muscle.strip() or "Other"
        muscle_counts[key] = muscle_counts.get(key, 0) + 1

    low_volume_muscles: list[str] = []
    for muscle, planned_sets in planned_muscle_sets.items():
        if planned_sets >= 4 and muscle_counts.get(muscle, 0) < 2:
            low_volume_muscles.append(muscle)

    compensation_target_day: int | None = None
    if plan:
        for entry in sorted(plan.entries, key=lambda item: item.day):
            if entry.day <= today.day or entry.is_rest_day:
                continue
            if _is_day_locked(entry.day, today, plan.month, plan.year, user):
                continue
            compensation_target_day = entry.day
            break

    adherence_pct = round((completed_days / planned_days) * 100) if planned_days else 100
    top_muscles = sorted(muscle_counts.items(), key=lambda item: item[1], reverse=True)[:5]

    summary = {
        "week_start": week_start.isoformat(),
        "week_end": today.isoformat(),
        "planned_training_days": planned_days,
        "completed_training_days": completed_days,
        "missed_training_days": missed_days,
        "adherence_pct": adherence_pct,
        "workouts_logged": len(workouts),
        "top_muscles": [{"muscle": name, "count": count} for name, count in top_muscles],
        "low_volume_muscles": low_volume_muscles,
        "compensation_target_day": compensation_target_day,
        "weekly_summary_enabled": weekly_summary_enabled(db, user.id),
    }
    summary["message"] = weekly_review_message(summary)
    summary["compensation_message"] = weekly_compensation_message(summary)
    return summary


def weekly_compensation_message(summary: dict[str, Any]) -> str | None:
    low = summary.get("low_volume_muscles") or []
    target_day = summary.get("compensation_target_day")
    if not low or not target_day:
        return None
    muscle = str(low[0])
    return f"{muscle} volume was low — next week adds 2 sets on day {target_day}"


def weekly_review_message(summary: dict[str, Any]) -> str:
    planned = int(summary.get("planned_training_days") or 0)
    completed = int(summary.get("completed_training_days") or 0)
    workouts = int(summary.get("workouts_logged") or 0)
    missed = summary.get("missed_training_days") or []
    top = summary.get("top_muscles") or []
    muscle_line = ", ".join(f"{item['muscle']} ({item['count']})" for item in top[:3] if item.get("muscle"))
    if planned:
        lines = [f"{completed} of {planned} planned workouts completed."]
    else:
        lines = [f"{workouts} workouts logged this week."]
    if missed:
        lines.append(f"Missed plan days: {', '.join(str(d) for d in missed)}.")
    compensation = weekly_compensation_message(summary)
    if compensation:
        lines.append(compensation)
    elif muscle_line:
        lines.append(f"Top muscles: {muscle_line}.")
    return " ".join(lines)


def _is_compound_exercise(db: Session, name: str) -> bool:
    key = (name or "").strip().lower()
    if not key:
        return True
    row = (
        db.query(GlobalExercise.is_compound)
        .filter(GlobalExercise.name.ilike(key))
        .first()
    )
    if row is not None:
        return bool(row[0])
    return True


def _priority_exercises(db: Session, exercises: list[dict[str, Any]], limit: int = 2) -> list[dict[str, Any]]:
    ranked = sorted(
        _normalize_exercises(exercises),
        key=lambda ex: (0 if _is_compound_exercise(db, str(ex.get("name") or "")) else 1),
    )
    return ranked[:limit]


def apply_weekly_compensation(
    db: Session,
    user: User,
    *,
    plan_id: int,
    local_date: str | None,
) -> dict[str, Any] | None:
    """Sunday weekly review: move priority work from missed days into upcoming plan days."""
    if not weekly_summary_enabled(db, user.id):
        return None
    require_feature(user, "smart_reflow", db)

    summary = build_weekly_review(db, user, local_date)
    missed_days = summary.get("missed_training_days") or []
    if not missed_days:
        return {"applied_days": [], "plan_id": plan_id, "summary": summary}

    today = parse_local_date(local_date)
    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.id == plan_id, MonthlyWorkoutPlan.user_id == user.id)
        .first()
    )
    if not plan:
        return None

    entry_by_day = {entry.day: entry for entry in plan.entries}
    exercises_to_move: list[dict[str, Any]] = []
    for day in missed_days:
        entry = entry_by_day.get(int(day))
        if not entry or entry.is_rest_day:
            continue
        for exercise in _priority_exercises(db, safe_json_loads(entry.exercises_json), 2):
            tagged = dict(exercise)
            tagged["reflow_source_day"] = int(day)
            exercises_to_move.append(tagged)

    if not exercises_to_move:
        return {"applied_days": [], "plan_id": plan_id, "summary": summary}

    target_days: list[DailyWorkoutPlanEntry] = []
    for entry in sorted(plan.entries, key=lambda item: item.day):
        if entry.day <= today.day or entry.is_rest_day:
            continue
        if _is_day_locked(entry.day, today, plan.month, plan.year, user):
            continue
        if day_has_any_planner_log(db, user.id, plan.year, plan.month, entry.day):
            continue
        if _remaining_reflow_slots(len(_normalize_exercises(safe_json_loads(entry.exercises_json)))) <= 0:
            continue
        target_days.append(entry)

    patches: list[dict[str, Any]] = []
    queue = list(exercises_to_move)
    working_by_day: dict[int, list[dict[str, Any]]] = {
        entry.day: _normalize_exercises(safe_json_loads(entry.exercises_json)) for entry in target_days
    }

    for item in queue:
        exercise_name = (str(item.get("name") or "")).strip().lower()
        if not exercise_name:
            continue
        for target in target_days:
            existing = working_by_day.get(target.day, [])
            if _remaining_reflow_slots(len(existing)) <= 0:
                continue
            if exercise_name in _exercise_names(existing):
                continue
            if not _is_exercise_compatible_with_day(item, target):
                continue
            tagged = dict(item)
            existing.append(tagged)
            working_by_day[target.day] = existing
            break

    for target in target_days:
        original = _normalize_exercises(safe_json_loads(target.exercises_json))
        updated = working_by_day.get(target.day, original)
        if len(updated) <= len(original):
            continue
        if len(updated) > REFLOW_MAX_EXERCISES_PER_DAY:
            continue
        patches.append(
            {
                "day": target.day,
                "exercises": updated,
                "estimated_duration_min": estimate_duration_min(updated),
            }
        )

    if not patches:
        return {"applied_days": [], "plan_id": plan_id, "summary": summary}

    low_muscles = summary.get("low_volume_muscles") or []
    compensation_day = summary.get("compensation_target_day")
    if low_muscles and compensation_day:
        comp_entry = entry_by_day.get(int(compensation_day))
        if comp_entry and not comp_entry.is_rest_day:
            if not day_has_any_planner_log(db, user.id, plan.year, plan.month, int(compensation_day)):
                comp_exercises = _normalize_exercises(safe_json_loads(comp_entry.exercises_json))
                changed = False
                for exercise in comp_exercises:
                    muscle = str(exercise.get("muscle") or "").strip()
                    if muscle in low_muscles:
                        exercise["sets"] = min(max(1, int(exercise.get("sets") or 1)) + 2, 6)
                        changed = True
                if changed:
                    existing_patch_days = {int(p["day"]) for p in patches}
                    if int(compensation_day) in existing_patch_days:
                        for patch in patches:
                            if int(patch["day"]) == int(compensation_day):
                                patch["exercises"] = comp_exercises
                                patch["estimated_duration_min"] = estimate_duration_min(comp_exercises)
                    else:
                        patches.append(
                            {
                                "day": int(compensation_day),
                                "exercises": comp_exercises,
                                "estimated_duration_min": estimate_duration_min(comp_exercises),
                            }
                        )

    try:
        result = apply_reflow_patches(db, user, plan_id=plan_id, patches=patches, local_date=local_date)
    except Exception:
        logger.exception("weekly compensation reflow failed for user_id=%s plan_id=%s", user.id, plan_id)
        raise
    result["summary"] = summary
    return result
