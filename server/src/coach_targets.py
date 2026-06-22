from __future__ import annotations

BASE_MUSCLES = ("Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps")

BASE_SETS_BY_WORKOUTS_PER_WEEK = (
    {"max": 2, "sets": 8},
    {"max": 4, "sets": 14},
    {"max": 6, "sets": 18},
    {"max": float("inf"), "sets": 20},
)

FOCUS_MUSCLE_MAP = {
    "Chest": ["Chest"],
    "Back": ["Back"],
    "Shoulders": ["Shoulders"],
    "Legs": ["Legs"],
    "Arms": ["Triceps", "Biceps"],
    "Core": [],
    "Balanced": [],
}

FOCUS_BONUS_SETS = 4


def get_goal_focus_muscles(goal: dict | None) -> list[str]:
    if not isinstance(goal, dict):
        return []
    focus_muscles = goal.get("focus_muscles")
    if isinstance(focus_muscles, list) and focus_muscles:
        return [str(m) for m in focus_muscles if m]
    focus_muscle = goal.get("focus_muscle")
    return [str(focus_muscle)] if focus_muscle else []


def get_muscle_weekly_targets(
    workouts_per_week: int | float | None,
    focus_muscles: list[str] | None,
) -> dict[str, int]:
    try:
        wpw = float(workouts_per_week) if workouts_per_week is not None else 4
    except (TypeError, ValueError):
        wpw = 4
    base = next(b["sets"] for b in BASE_SETS_BY_WORKOUTS_PER_WEEK if wpw <= b["max"])

    bonused_muscles: set[str] = set()
    for muscle in focus_muscles or []:
        bonused_muscles.update(FOCUS_MUSCLE_MAP.get(muscle, []))

    targets: dict[str, int] = {}
    for muscle in BASE_MUSCLES:
        targets[muscle] = int(base) + (FOCUS_BONUS_SETS if muscle in bonused_muscles else 0)
    return targets


def get_target_weekly_sets(
    workouts_per_week: int | float | None,
    focus_muscles: list[str] | None,
) -> int:
    return sum(get_muscle_weekly_targets(workouts_per_week, focus_muscles).values())


def get_onboarding_weekly_target_inputs(onboarding: dict | None) -> tuple[int | float | None, list[str]]:
    if not isinstance(onboarding, dict):
        return None, []
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    return activity.get("workouts_per_week"), get_goal_focus_muscles(goal)
