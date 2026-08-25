"""Per-exercise calorie model — MET from exercise catalog, formula aligned with mobile sessionCalories.ts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

DEFAULT_MET = 5.0
SET_DURATION_SEC = 45
REST_DURATION_SEC = 90
GUIDED_WARMUP_EXERCISE_NAME = "Guided Warm-up"
# Cardio warm-up phases average ~6 MET in generatePreworkoutPlan treadmill profiles.
GUIDED_WARMUP_DEFAULT_MET = 6.0

# Active session (Option A): rep-density-adjusted MET within time model
BASELINE_WORK_SEC = 45
BASELINE_REPS_DEFAULT = 10
DEFAULT_REST_SEC = 90
DENSITY_EXPONENT = 0.35
REP_MULT_MIN = 0.80
REP_MULT_MAX = 1.20
MIN_WORK_SEC = 1

ACTIVE_SESSION_NOTES_RE = re.compile(r"^active_session(?:_partial)?:([^\s;,]+)", re.IGNORECASE)


@dataclass(frozen=True)
class ActiveSetLogInput:
    """Minimal per-set fields for active-session calorie estimation."""

    reps: int | None
    started_at: datetime | None
    completed_at: datetime | None
    prescribed_reps: int | None = None
    rest_seconds: int | None = None


def parse_active_session_id(notes: str | None) -> str | None:
    if not notes:
        return None
    match = ACTIVE_SESSION_NOTES_RE.match(notes.strip())
    return match.group(1) if match else None


def _prescribed_reps_per_set(workout: Any) -> int:
    sets = int(getattr(workout, "sets", None) or 0)
    total_reps = int(getattr(workout, "reps", None) or 0)
    if sets > 0 and total_reps > 0:
        return max(1, round(total_reps / sets))
    return BASELINE_REPS_DEFAULT


def calc_set_kcal(
    *,
    met: float,
    user_weight_kg: float,
    set_duration_sec: int = SET_DURATION_SEC,
    rest_duration_sec: int = REST_DURATION_SEC,
) -> int:
    met_value = met if met > 0 else DEFAULT_MET
    weight = max(0.0, float(user_weight_kg or 0))
    hours = (set_duration_sec + rest_duration_sec) / 3600.0
    return max(0, int(round(met_value * weight * hours)))


def calc_active_set_kcal(
    *,
    met: float,
    user_weight_kg: float,
    work_sec: float | int | None,
    rest_sec: int | None = None,
    reps: int | None = None,
    prescribed_reps: int | None = None,
    prescribed_work_sec: int = BASELINE_WORK_SEC,
) -> int:
    """
    Rep-adjusted MET × body weight × (work + rest) / 3600 for one logged set.

    Fallback order: full (time+reps) → reps with baseline work time → time only → flat set.
    """
    met_value = met if met > 0 else DEFAULT_MET
    weight = max(0.0, float(user_weight_kg or 0))
    rest = max(0, int(rest_sec if rest_sec is not None else DEFAULT_REST_SEC))
    baseline_reps = max(1, int(prescribed_reps or BASELINE_REPS_DEFAULT))
    baseline_work = max(MIN_WORK_SEC, int(prescribed_work_sec or BASELINE_WORK_SEC))

    work: float | None = None
    if work_sec is not None:
        parsed_work = float(work_sec)
        if parsed_work > 0:
            work = parsed_work

    reps_valid = reps is not None and int(reps) > 0

    if not reps_valid and work is None:
        return max(1, calc_set_kcal(met=met_value, user_weight_kg=weight))

    if not reps_valid and work is not None:
        hours = (work + rest) / 3600.0
        return max(1, int(round(met_value * weight * hours)))

    reps_eff = max(1, int(reps or baseline_reps))
    if work is None:
        work = float(baseline_work)
    work = max(float(MIN_WORK_SEC), work)

    baseline_density = baseline_reps / baseline_work
    actual_density = reps_eff / work
    density_ratio = actual_density / baseline_density if baseline_density > 0 else 1.0
    rep_multiplier = max(REP_MULT_MIN, min(REP_MULT_MAX, density_ratio**DENSITY_EXPONENT))
    effective_met = met_value * rep_multiplier
    hours = (work + rest) / 3600.0
    return max(1, int(round(effective_met * weight * hours)))


def calc_active_exercise_kcal(
    set_logs: list[ActiveSetLogInput],
    *,
    met: float,
    user_weight_kg: float,
    prescribed_reps: int | None = None,
    rest_sec: int | None = None,
) -> int:
    if not set_logs:
        return 1
    total = 0
    for entry in set_logs:
        work_sec: float | None = None
        if entry.started_at is not None and entry.completed_at is not None:
            work_sec = max(0.0, (entry.completed_at - entry.started_at).total_seconds())
        total += calc_active_set_kcal(
            met=met,
            user_weight_kg=user_weight_kg,
            work_sec=work_sec,
            rest_sec=entry.rest_seconds if entry.rest_seconds is not None else rest_sec,
            reps=entry.reps,
            prescribed_reps=entry.prescribed_reps if entry.prescribed_reps is not None else prescribed_reps,
        )
    return max(1, total)


def calc_exercise_estimate_kcal(
    sets: int | None,
    user_weight_kg: float,
    *,
    met: float,
) -> int:
    set_count = max(1, int(sets or 1))
    effective_met = met if met > 0 else DEFAULT_MET
    return max(1, calc_set_kcal(met=effective_met, user_weight_kg=user_weight_kg) * set_count)


def is_guided_warmup(exercise_name: str | None) -> bool:
    return (exercise_name or "").strip().lower() == GUIDED_WARMUP_EXERCISE_NAME.lower()


def round_to_nearest_5(value: float) -> int:
    return int(round(value / 5.0) * 5)


def parse_time_taken_to_seconds(time_taken: str | None) -> int | None:
    if not time_taken:
        return None
    try:
        minute_part, second_part = time_taken.split(":")
        minutes = int(minute_part)
        seconds = int(second_part)
    except (ValueError, AttributeError):
        return None
    if minutes < 0 or seconds < 0 or seconds > 59:
        return None
    return minutes * 60 + seconds


def resolve_duration_seconds(
    *,
    duration_minutes: int | None,
    time_taken: str | None,
) -> int:
    parsed = parse_time_taken_to_seconds(time_taken)
    if parsed is not None and parsed > 0:
        return parsed
    if duration_minutes and duration_minutes > 0:
        return int(duration_minutes) * 60
    return 0


def estimate_cardio_duration_kcal(
    duration_sec: float,
    user_weight_kg: float,
    met: float | None = None,
) -> int:
    weight = max(0.0, float(user_weight_kg or 0))
    met_value = met if met and met > 0 else DEFAULT_MET
    seconds = max(0.0, float(duration_sec))
    if seconds <= 0:
        return 1
    raw = met_value * weight * (seconds / 3600.0)
    return max(1, round_to_nearest_5(raw))


def estimate_workout_calories_session_model(
    *,
    exercise_name: str | None,
    sets: int | None,
    duration_minutes: int | None = None,
    time_taken: str | None = None,
    user_weight_kg: float,
    met: float,
) -> int:
    """
    MET × weight × (45s work + 90s rest) × sets for strength exercises.
    Guided warm-up uses duration-based cardio estimate.
    """
    if is_guided_warmup(exercise_name):
        duration_sec = resolve_duration_seconds(
            duration_minutes=duration_minutes,
            time_taken=time_taken,
        )
        return estimate_cardio_duration_kcal(
            duration_sec,
            user_weight_kg,
            GUIDED_WARMUP_DEFAULT_MET,
        )

    return calc_exercise_estimate_kcal(sets, user_weight_kg, met=met)


def load_active_set_logs_for_workout(db: Any, workout: Any) -> list[ActiveSetLogInput]:
    """Load per-set logs for an active-session workout row, if session data still exists."""
    from src.models.models import WorkoutSession, WorkoutSessionSetLog

    session_id = parse_active_session_id(getattr(workout, "notes", None))
    user_id = getattr(workout, "user_id", None)
    exercise_name = (getattr(workout, "exercise_name", None) or "").strip()
    if not session_id or not user_id or not exercise_name:
        return []

    session = (
        db.query(WorkoutSession)
        .filter(
            WorkoutSession.session_id == session_id,
            WorkoutSession.user_id == user_id,
        )
        .first()
    )
    if not session:
        return []

    rows = (
        db.query(WorkoutSessionSetLog)
        .filter(
            WorkoutSessionSetLog.session_pk == session.id,
            WorkoutSessionSetLog.exercise_name == exercise_name,
        )
        .order_by(WorkoutSessionSetLog.set_number.asc())
        .all()
    )
    return [
        ActiveSetLogInput(
            reps=row.reps,
            started_at=row.started_at,
            completed_at=row.completed_at,
            prescribed_reps=_prescribed_reps_per_set(workout),
            rest_seconds=DEFAULT_REST_SEC,
        )
        for row in rows
    ]


def estimate_saved_workout_calories(
    workout: Any,
    user_weight_kg: float,
    db: Any,
    *,
    met: float | None = None,
    override_time_taken: str | None = None,
) -> int:
    """
    Source-aware calorie estimate for a persisted workout row.

    Active session rows (notes prefix) recompute from WorkoutSessionSetLog when available;
    manual/planner rows use the flat sets-only model.
    """
    from src.services.exercise_met_service import resolve_met_for_exercise

    effective_met = met
    if effective_met is None:
        effective_met = resolve_met_for_exercise(
            db,
            exercise_id=getattr(workout, "exercise_id", None),
            exercise_name=getattr(workout, "exercise_name", None),
        )

    session_id = parse_active_session_id(getattr(workout, "notes", None))
    if session_id and db is not None:
        set_logs = load_active_set_logs_for_workout(db, workout)
        if set_logs:
            return calc_active_exercise_kcal(
                set_logs,
                met=float(effective_met),
                user_weight_kg=user_weight_kg,
                prescribed_reps=_prescribed_reps_per_set(workout),
                rest_sec=DEFAULT_REST_SEC,
            )

    effective_time_taken = override_time_taken or (
        f"{int(workout.duration)}:00" if getattr(workout, "duration", None) else None
    )
    return estimate_workout_calories_session_model(
        exercise_name=getattr(workout, "exercise_name", None),
        sets=getattr(workout, "sets", None),
        duration_minutes=getattr(workout, "duration", None),
        time_taken=effective_time_taken,
        user_weight_kg=user_weight_kg,
        met=float(effective_met),
    )
