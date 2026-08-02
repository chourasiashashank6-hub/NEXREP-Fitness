"""
Onboarding snapshot helpers for stale-plan detection.

At generation time, call `build_meal_snapshot` / `build_workout_snapshot`
and store the result as JSON on the plan row.  On planner load, call the
corresponding `stale_*_fields` function to compute which onboarding
field(s) have drifted since generation.  The banner / modal copy then
names those specific fields so the user knows exactly what changed.
"""

from __future__ import annotations

import json
from typing import Any


# ---------------------------------------------------------------------------
# Field definitions
# ---------------------------------------------------------------------------

MEAL_SNAPSHOT_FIELDS = [
    "age",
    "biological_sex",
    "height_cm",
    "current_weight_kg",
    "primary_goal",
    "goal_pace",
    "target_weight_kg",
    "daily_activity_level",
    "diet_type",
    "food_allergies",
    "meals_per_day",
]

WORKOUT_SNAPSHOT_FIELDS = [
    "current_weight_kg",
    "primary_goal",
    "difficulty",
    "body_type_current",
    "body_type_goal",
    "body_type_problem_areas",
    "workouts_per_week",
    "workout_types",
    "muscle_focus",
]


# ---------------------------------------------------------------------------
# Snapshot builders
# ---------------------------------------------------------------------------

def build_meal_snapshot(onboarding: dict[str, Any]) -> dict[str, Any]:
    """Extract the meal-planner-relevant onboarding fields into a flat dict."""
    personal = onboarding.get("personal") or {}
    goal = onboarding.get("goal") or {}
    activity = onboarding.get("activity") or {}
    dietary = onboarding.get("dietary") or {}

    return {
        "age": personal.get("age"),
        "biological_sex": personal.get("biological_sex"),
        "height_cm": personal.get("height_cm"),
        "current_weight_kg": personal.get("weight_kg"),
        "primary_goal": goal.get("type"),
        "goal_pace": goal.get("pace"),
        "target_weight_kg": goal.get("target_weight_kg"),
        "daily_activity_level": activity.get("level"),
        "diet_type": dietary.get("diet_type"),
        "food_allergies": sorted(dietary.get("allergies") or []),
        "meals_per_day": dietary.get("meals_per_day"),
    }


def build_workout_snapshot(onboarding: dict[str, Any]) -> dict[str, Any]:
    """Extract the workout-planner-relevant onboarding fields into a flat dict."""
    personal = onboarding.get("personal") or {}
    goal = onboarding.get("goal") or {}
    activity = onboarding.get("activity") or {}
    body_type = onboarding.get("body_type") or {}
    if not isinstance(body_type, dict):
        body_type = {}

    focus = goal.get("focus_muscles")
    if isinstance(focus, list):
        focus = sorted(str(m).strip() for m in focus if m)
    elif goal.get("focus_muscle"):
        focus = [str(goal["focus_muscle"]).strip()]
    else:
        focus = []

    workout_types = activity.get("workout_types")
    if isinstance(workout_types, list):
        workout_types = sorted(str(t).strip() for t in workout_types if t)
    else:
        workout_types = ["strength"]

    problem_areas = body_type.get("problem_areas") or []
    if isinstance(problem_areas, list):
        problem_areas = sorted(str(p).strip() for p in problem_areas if p)

    return {
        "current_weight_kg": personal.get("weight_kg"),
        "primary_goal": goal.get("type"),
        "difficulty": goal.get("difficulty"),
        "body_type_current": body_type.get("current_body_id"),
        "body_type_goal": body_type.get("goal_body_id"),
        "body_type_problem_areas": problem_areas,
        "workouts_per_week": activity.get("workouts_per_week"),
        "workout_types": workout_types,
        "muscle_focus": focus,
    }


# ---------------------------------------------------------------------------
# Snapshot serialisation helpers for plan rows
# ---------------------------------------------------------------------------

def encode_snapshot(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, sort_keys=True)


def decode_snapshot(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Staleness check
# ---------------------------------------------------------------------------

def stale_fields(stored: dict[str, Any] | None, current: dict[str, Any]) -> list[str]:
    """
    Return the list of field names that differ between stored snapshot and
    current snapshot.  Empty list means plan is up-to-date.

    An absent stored snapshot means the plan predates snapshotting — mark it
    stale with a single sentinel so the banner shows a generic message instead
    of listing every onboarding field as "changed".
    """
    if stored is None:
        return ["_legacy_no_snapshot"]

    mismatched: list[str] = []
    for key in current:
        stored_val = stored.get(key)
        current_val = current.get(key)
        # Normalise lists so order doesn't matter
        if isinstance(stored_val, list) and isinstance(current_val, list):
            if sorted(str(x) for x in stored_val) != sorted(str(x) for x in current_val):
                mismatched.append(key)
        elif stored_val != current_val:
            mismatched.append(key)
    return mismatched


def stale_meal_fields(plan_snapshot_json: str | None, onboarding: dict[str, Any]) -> list[str]:
    stored = decode_snapshot(plan_snapshot_json)
    current = build_meal_snapshot(onboarding)
    return stale_fields(stored, current)


def stale_workout_fields(plan_snapshot_json: str | None, onboarding: dict[str, Any]) -> list[str]:
    stored = decode_snapshot(plan_snapshot_json)
    current = build_workout_snapshot(onboarding)
    return stale_fields(stored, current)
