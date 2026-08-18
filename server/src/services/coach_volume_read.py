"""Read-only muscle set-volume rollup for the Journey Engine.

Mirrors `workout_coach_data()` volume math without modifying that endpoint.
Uses the same `_infer_muscles_from_workout()` primitive from `src.main`.

Follow-up (not in this build): consolidate with `workout_coach_data()` once the
engine is proven permanent.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from src.coach_targets import get_muscle_weekly_targets, get_onboarding_weekly_target_inputs, get_target_weekly_sets
from src.models.models import UserOnboarding, Workout

BASE_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"]
MUSCLE_PALETTE = {
    "Chest": "#4ADE80",
    "Shoulders": "#FBBF24",
    "Triceps": "#A78BFA",
    "Back": "#60A5FA",
    "Legs": "#F87171",
    "Biceps": "#2DD4BF",
}


def _weekly_target_context(db: Session, user_id: int) -> tuple[dict[str, int], int]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else None
    workouts_per_week, focus_muscles = get_onboarding_weekly_target_inputs(onboarding)
    muscle_targets = get_muscle_weekly_targets(workouts_per_week, focus_muscles)
    return muscle_targets, get_target_weekly_sets(workouts_per_week, focus_muscles)


def read_weekly_muscle_volume(
    db: Session,
    user_id: int,
    *,
    days: int = 14,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return weeklyVolume-style payload for the rolling 7-day window."""
    from src.main import _infer_muscles_from_workout

    now = now or datetime.utcnow()
    muscle_targets, target_weekly_sets = _weekly_target_context(db, user_id)
    since = now - timedelta(days=days)
    rows = (
        db.query(Workout)
        .filter(Workout.user_id == user_id, Workout.date >= since)
        .order_by(Workout.date.desc())
        .all()
    )
    if not rows:
        return {
            "weeklyVolume": [
                {"muscle": m, "sets": 0, "targetSets": muscle_targets[m], "color": MUSCLE_PALETTE[m]}
                for m in BASE_MUSCLES
            ],
            "totalWeeklySets": 0,
            "targetWeeklySets": target_weekly_sets,
            "byMuscleSets": {m: 0 for m in BASE_MUSCLES},
        }

    week_since = now - timedelta(days=7)
    by_muscle_sets: dict[str, int] = {m: 0 for m in BASE_MUSCLES}
    for workout in rows:
        muscles = _infer_muscles_from_workout(workout, db)
        sets = max(0, int(workout.sets or 0))
        for muscle in muscles:
            if muscle not in by_muscle_sets:
                continue
            if workout.date >= week_since:
                by_muscle_sets[muscle] += sets

    weekly_volume = [
        {
            "muscle": muscle,
            "sets": by_muscle_sets[muscle],
            "targetSets": muscle_targets[muscle],
            "color": MUSCLE_PALETTE[muscle],
        }
        for muscle in BASE_MUSCLES
    ]
    return {
        "weeklyVolume": weekly_volume,
        "totalWeeklySets": sum(item["sets"] for item in weekly_volume),
        "targetWeeklySets": sum(item["targetSets"] for item in weekly_volume),
        "byMuscleSets": dict(by_muscle_sets),
    }


def read_muscle_sets_in_window(
    db: Session,
    user_id: int,
    window_start: datetime,
    window_end: datetime,
) -> dict[str, int]:
    """Set counts per muscle for an arbitrary [start, end) window."""
    from src.main import _infer_muscles_from_workout

    by_muscle: dict[str, int] = {m: 0 for m in BASE_MUSCLES}
    rows = (
        db.query(Workout)
        .filter(
            Workout.user_id == user_id,
            Workout.date >= window_start,
            Workout.date < window_end,
        )
        .all()
    )
    for workout in rows:
        muscles = _infer_muscles_from_workout(workout, db)
        sets = max(0, int(workout.sets or 0))
        for muscle in muscles:
            if muscle in by_muscle:
                by_muscle[muscle] += sets
    return by_muscle
