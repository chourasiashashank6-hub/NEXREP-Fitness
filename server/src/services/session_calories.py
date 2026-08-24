"""Per-exercise calorie model — MET from exercise catalog, formula aligned with mobile sessionCalories.ts."""

from __future__ import annotations

DEFAULT_MET = 5.0
SET_DURATION_SEC = 45
REST_DURATION_SEC = 90
GUIDED_WARMUP_EXERCISE_NAME = "Guided Warm-up"
# Cardio warm-up phases average ~6 MET in generatePreworkoutPlan treadmill profiles.
GUIDED_WARMUP_DEFAULT_MET = 6.0


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
