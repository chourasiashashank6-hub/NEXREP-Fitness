from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.http_client import post_json
from src.models.meal_plan import DailyWorkoutPlanEntry, MonthlyWorkoutPlan
from src.models.models import User, UserOnboarding
from src.services.planner_common import (
    day_flags,
    days_chunks_from_range,
    days_in_month,
    month_chunks,
    parse_groq_json_array,
    parse_local_date,
    safe_json_dumps,
    safe_json_loads,
)
from src.services.planner_swap_limits import (
    SWAP_LIMIT_PER_DAY,
    SwapLimitExceeded,
    check_swap_allowed,
    get_swap_count,
    increment_swap,
)

WORKOUT_SYSTEM_PROMPT = """You are an expert strength and conditioning coach.
Generate a 7-day workout plan as a JSON array of 7 objects.

Each day object has keys:
- "day": integer (the day number provided)
- "is_rest_day": boolean
- "split_name": string (e.g. "Push Day", "Pull Day", "Legs", "Upper Body", "Full Body", "Active Recovery", "Rest Day")
- "focus_muscles": array of strings (e.g. ["Chest", "Shoulders", "Triceps"])
- "exercises": array of exercise objects (empty array if rest day)
- "estimated_duration_min": number (0 if rest day)

Each exercise object has keys:
- "name": string (real, standard exercise name)
- "sets": number
- "reps": string (e.g. "8-12", "15", "to failure")
- "muscle": string (primary target muscle)
- "note": string (one-line coaching cue specific to this exercise)
- "rest_seconds": number

Follow all rules in the user message. No markdown, return ONLY the JSON array."""

WORKOUT_REGEN_PROMPT_SUFFIX = """
The user message may include "continue_from_split" — this is the split that was last completed before regeneration. Start the rotation from the NEXT split in the sequence (e.g. if last was "Push Day", start with "Pull Day" or "Legs", not another Push Day immediately)."""

WORKOUT_VOLUME_RULES = """
User trains {workouts_per_week} days per week. Distribute rest days across the week:
- 1-2 workouts/week: 5-6 rest days, use Full Body sessions
- 3 workouts/week: 4 rest days, use Full Body A/B/C
- 4 workouts/week: 3 rest days, use Upper/Lower split
- 5 workouts/week: 2 rest days, use Push/Pull/Legs/Upper/Lower
- 6 workouts/week: 1 rest day, use Push/Pull/Legs × 2 (upper-lower frequency)
- 7 workouts/week: 0 rest days, 6 training days + 1 active recovery (ONLY for extremely_active)

Each TRAINING day must have EXACTLY {exercises_per_session} exercises (not fewer, not more).
Rest days have 0 exercises and is_rest_day: true.

Difficulty adjustments:
- beginner: compound movements only, 2-3 sets, 12-15 reps, simpler exercises
- intermediate: compound + isolation mix, 3-4 sets, 8-12 reps, moderate complexity
- advanced: compound + isolation + advanced techniques in the "note" field, 4-5 sets, 6-12 reps

Activity level adjustments:
- sedentary/lightly_active: keep volume conservative even if workouts_per_week is high
- very_active/extremely_active: higher volume per session is appropriate
"""

PUSH_EXERCISES = [
    {"name": "Barbell Bench Press", "sets": 4, "reps": "8-12", "muscle": "Chest", "note": "Control the negative", "rest_seconds": 90},
    {"name": "Overhead Press", "sets": 3, "reps": "10", "muscle": "Shoulders", "note": "Brace core", "rest_seconds": 90},
    {"name": "Incline Dumbbell Press", "sets": 3, "reps": "10-12", "muscle": "Chest", "note": "Squeeze at top", "rest_seconds": 75},
    {"name": "Tricep Pushdown", "sets": 3, "reps": "12-15", "muscle": "Triceps", "note": "Elbows pinned", "rest_seconds": 60},
    {"name": "Cable Fly", "sets": 3, "reps": "12-15", "muscle": "Chest", "note": "Squeeze at center", "rest_seconds": 60},
    {"name": "Dips", "sets": 3, "reps": "10-12", "muscle": "Triceps", "note": "Lean forward for chest emphasis", "rest_seconds": 75},
]
PULL_EXERCISES = [
    {"name": "Lat Pulldown", "sets": 4, "reps": "8-12", "muscle": "Back", "note": "Pull to chest", "rest_seconds": 90},
    {"name": "Seated Cable Row", "sets": 3, "reps": "10-12", "muscle": "Back", "note": "Pause at contraction", "rest_seconds": 75},
    {"name": "Face Pull", "sets": 3, "reps": "15", "muscle": "Rear Delts", "note": "External rotate", "rest_seconds": 60},
    {"name": "Barbell Curl", "sets": 3, "reps": "10-12", "muscle": "Biceps", "note": "No swinging", "rest_seconds": 60},
    {"name": "Bent Over Row", "sets": 3, "reps": "8-10", "muscle": "Back", "note": "Flat back", "rest_seconds": 90},
    {"name": "Hammer Curl", "sets": 3, "reps": "12", "muscle": "Biceps", "note": "Neutral grip", "rest_seconds": 60},
]
LEG_EXERCISES = [
    {"name": "Barbell Back Squat", "sets": 4, "reps": "6-10", "muscle": "Legs", "note": "Brace core", "rest_seconds": 120},
    {"name": "Romanian Deadlift", "sets": 3, "reps": "8-10", "muscle": "Hamstrings", "note": "Hinge hips", "rest_seconds": 90},
    {"name": "Leg Press", "sets": 3, "reps": "12-15", "muscle": "Legs", "note": "Full range", "rest_seconds": 90},
    {"name": "Walking Lunges", "sets": 3, "reps": "12 each", "muscle": "Legs", "note": "Upright torso", "rest_seconds": 75},
    {"name": "Leg Curl", "sets": 3, "reps": "12-15", "muscle": "Hamstrings", "note": "Control the negative", "rest_seconds": 60},
    {"name": "Standing Calf Raise", "sets": 4, "reps": "15", "muscle": "Calves", "note": "Full stretch at bottom", "rest_seconds": 45},
]

FULL_BODY_EXERCISES = [
    {"name": "Goblet Squat", "sets": 3, "reps": "10-12", "muscle": "Legs", "note": "Chest up", "rest_seconds": 90},
    {"name": "Push Ups", "sets": 3, "reps": "12-15", "muscle": "Chest", "note": "Full range", "rest_seconds": 60},
    {"name": "Dumbbell Row", "sets": 3, "reps": "10-12", "muscle": "Back", "note": "Pull to hip", "rest_seconds": 75},
    {"name": "Romanian Deadlift", "sets": 3, "reps": "8-10", "muscle": "Hamstrings", "note": "Hinge hips", "rest_seconds": 90},
    {"name": "Overhead Press", "sets": 3, "reps": "10", "muscle": "Shoulders", "note": "Brace core", "rest_seconds": 75},
    {"name": "Plank", "sets": 3, "reps": "45s", "muscle": "Core", "note": "Neutral spine", "rest_seconds": 45},
    {"name": "Walking Lunges", "sets": 3, "reps": "12 each", "muscle": "Legs", "note": "Upright torso", "rest_seconds": 75},
    {"name": "Lat Pulldown", "sets": 3, "reps": "10-12", "muscle": "Back", "note": "Pull to chest", "rest_seconds": 75},
]

UPPER_EXERCISES = PUSH_EXERCISES[:4] + PULL_EXERCISES[:4]
LOWER_EXERCISES = LEG_EXERCISES


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


def _workout_split_instruction(workouts_per_week: int) -> str:
    if workouts_per_week >= 6:
        return """
For 6 workouts/week, use a Push/Pull/Legs × 2 split across the 7 days:
Day 1: Push A (Chest, Shoulders, Triceps) — higher chest volume
Day 2: Pull A (Back, Biceps, Rear Delts) — heavier compound pulling
Day 3: Legs A (Quads, Hamstrings, Glutes, Calves)
Day 4: Rest
Day 5: Push B (Shoulders, Chest, Triceps) — higher shoulder volume
Day 6: Pull B (Back, Biceps, Rear Delts) — more isolation
Day 7: Legs B (Hamstrings, Glutes, Quads — different exercise selection from Legs A)
This ensures every muscle is trained twice per week."""
    if workouts_per_week == 5:
        return """
For 5 workouts/week, use Push/Pull/Legs/Upper/Lower:
Day 1: Push (Chest, Shoulders, Triceps)
Day 2: Pull (Back, Biceps)
Day 3: Legs (Quads, Hamstrings, Glutes, Calves)
Day 4: Rest
Day 5: Upper Body (Chest, Back, Shoulders, Arms)
Day 6: Lower Body (Legs, Glutes)
Day 7: Rest"""
    if workouts_per_week == 4:
        return """
For 4 workouts/week, use Upper/Lower split:
Day 1: Upper A (Chest, Back, Shoulders, Arms)
Day 2: Lower A (Quads, Hamstrings, Glutes, Calves)
Day 3: Rest
Day 4: Upper B (Back, Chest, Arms, Rear Delts)
Day 5: Lower B (Hamstrings, Glutes, Quads)
Days 6-7: Rest"""
    if workouts_per_week == 3:
        return """
For 3 workouts/week, use Full Body A/B/C:
Day 1: Full Body A (squat pattern, push, pull)
Day 3: Full Body B (hinge pattern, push, pull — different exercises)
Day 5: Full Body C (varied compound movements)
Rest on non-training days"""
    return f"""
For {workouts_per_week} workouts/week, distribute {workouts_per_week} training days across the 7-day block with rest days between sessions."""


def _workout_focus_instruction(focus_muscles: list[str]) -> str:
    if not focus_muscles:
        return """
Muscle Focus: Balanced — train all muscle groups equally according to the split. No extra volume for any specific group.
"""
    if len(focus_muscles) == 1:
        muscle = focus_muscles[0]
        return f"""
Muscle Focus: {muscle}
Add 1-2 extra sets for {muscle} on EVERY training day where it appears.
Include {muscle} in at least one additional session per week beyond the normal rotation.
"""
    muscles_str = ", ".join(focus_muscles)
    return f"""
Muscle Focus: {muscles_str} (multiple focus muscles selected by user)
Distribute extra volume across these focus muscles:
- Add 1 extra set for each focus muscle on days where they naturally appear in the split.
- For each focus muscle, ensure it appears in at least one training session per 7-day block.
- Do NOT overload a single session with all focus muscles — spread them across the week intelligently.
- For example, if focus muscles are [Chest, Back], Push days get +1 set chest, Pull days get +1 set back.
- If all focus muscles fit in one split (e.g. Chest + Triceps on Push Day), add +1-2 sets for each.
"""


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


def _build_workout_system_prompt(ctx: dict[str, Any], *, continue_from_split: bool = False) -> str:
    prompt = WORKOUT_SYSTEM_PROMPT + "\n" + WORKOUT_VOLUME_RULES.format(
        workouts_per_week=ctx["workouts_per_week"],
        exercises_per_session=ctx["exercises_per_session"],
    )
    prompt += "\n" + _workout_split_instruction(int(ctx["workouts_per_week"]))
    prompt += _workout_focus_instruction(ctx.get("focus_muscles") or [])
    if continue_from_split:
        prompt += WORKOUT_REGEN_PROMPT_SUFFIX
    return prompt


def _onboarding_context(db: Session, user_id: int) -> tuple[dict, dict]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}
    targets = row.targets_json if row and isinstance(row.targets_json, dict) else {}
    return onboarding, targets


def _groq_workout_chunk(user_message: dict[str, Any], *, system_prompt: str | None = None) -> list[dict[str, Any]]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing")
    prompt = system_prompt or WORKOUT_SYSTEM_PROMPT
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
            "temperature": 0.5,
            "max_tokens": _workout_chunk_max_tokens(int(user_message.get("exercises_per_session") or 5)),
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(user_message)},
            ],
        },
        timeout=90,
    )
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    return parse_groq_json_array(content)


def _gemini_workout_chunk(user_message: dict[str, Any], *, system_prompt: str | None = None) -> list[dict[str, Any]]:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing")
    prompt = system_prompt or WORKOUT_SYSTEM_PROMPT
    model = settings.GEMINI_MODEL or "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.GEMINI_API_KEY}"
    raw = post_json(
        url,
        headers={"Content-Type": "application/json"},
        payload={
            "contents": [{"role": "user", "parts": [{"text": prompt + "\n\n" + json.dumps(user_message)}]}],
            "generationConfig": {
                "temperature": 0.5,
                "maxOutputTokens": _workout_chunk_max_tokens(int(user_message.get("exercises_per_session") or 5)),
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    parts = (raw.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    content = parts[0].get("text", "") if parts else ""
    return parse_groq_json_array(content)


def _validate_workout_day(day_obj: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(day_obj.get("day"), int):
        return None
    is_rest = bool(day_obj.get("is_rest_day"))
    exercises = day_obj.get("exercises") if isinstance(day_obj.get("exercises"), list) else []
    focus = day_obj.get("focus_muscles") if isinstance(day_obj.get("focus_muscles"), list) else []
    return {
        "day": int(day_obj["day"]),
        "is_rest_day": is_rest,
        "split_name": str(day_obj.get("split_name") or ("Rest Day" if is_rest else "Training Day")),
        "focus_muscles": [str(m) for m in focus],
        "exercises": exercises if not is_rest else [],
        "estimated_duration_min": int(day_obj.get("estimated_duration_min") or (0 if is_rest else 50)),
    }


def _fallback_week_splits(workouts_per_week: int) -> list[tuple[str, bool]]:
    wpw = max(1, min(7, int(workouts_per_week)))
    patterns: dict[int, list[tuple[str, bool]]] = {
        1: [
            ("Full Body", False),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Rest Day", True),
        ],
        2: [
            ("Full Body", False),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Full Body", False),
            ("Rest Day", True),
            ("Rest Day", True),
            ("Rest Day", True),
        ],
        3: [
            ("Full Body A", False),
            ("Rest Day", True),
            ("Full Body B", False),
            ("Rest Day", True),
            ("Full Body C", False),
            ("Rest Day", True),
            ("Rest Day", True),
        ],
        4: [
            ("Upper A", False),
            ("Lower A", False),
            ("Rest Day", True),
            ("Upper B", False),
            ("Lower B", False),
            ("Rest Day", True),
            ("Rest Day", True),
        ],
        5: [
            ("Push Day", False),
            ("Pull Day", False),
            ("Legs", False),
            ("Rest Day", True),
            ("Upper Body", False),
            ("Lower Body", False),
            ("Rest Day", True),
        ],
        6: [
            ("Push A", False),
            ("Pull A", False),
            ("Legs A", False),
            ("Rest Day", True),
            ("Push B", False),
            ("Pull B", False),
            ("Legs B", False),
        ],
    }
    return patterns.get(wpw, patterns[4])


def _exercise_pool_for_split(split_name: str) -> list[dict[str, Any]]:
    name = split_name.lower()
    if "push" in name:
        return PUSH_EXERCISES
    if "pull" in name:
        return PULL_EXERCISES
    if "leg" in name or "lower" in name:
        return LOWER_EXERCISES
    if "upper" in name:
        return UPPER_EXERCISES
    if "full body" in name:
        return FULL_BODY_EXERCISES
    return PUSH_EXERCISES


def _focus_muscles_for_split(split_name: str) -> list[str]:
    name = split_name.lower()
    if "push" in name:
        return ["Chest", "Shoulders", "Triceps"]
    if "pull" in name:
        return ["Back", "Biceps", "Rear Delts"]
    if "leg" in name or "lower" in name:
        return ["Quads", "Hamstrings", "Glutes", "Calves"]
    if "upper" in name:
        return ["Chest", "Back", "Shoulders", "Arms"]
    if "full body" in name:
        return ["Full Body"]
    return ["Chest", "Shoulders", "Triceps"]


def _pad_exercises(pool: list[dict[str, Any]], count: int, *, extra_sets: int = 0) -> list[dict[str, Any]]:
    if count <= 0:
        return []
    out: list[dict[str, Any]] = []
    for i in range(count):
        base = dict(pool[i % len(pool)])
        base["sets"] = int(base.get("sets") or 3) + extra_sets
        out.append(base)
    return out


def _workout_chunk_max_tokens(exercises_per_session: int) -> int:
    return max(2500, exercises_per_session * 450)


def _ensure_exercises_for_day(
    day: dict[str, Any],
    *,
    exercises_per_session: int,
    week_number: int,
) -> dict[str, Any]:
    """Pad or trim training days so exercise count matches onboarding-derived target."""
    if day.get("is_rest_day"):
        day["exercises"] = []
        day["estimated_duration_min"] = 0
        return day

    target = max(1, int(exercises_per_session))
    existing = [dict(ex) for ex in (day.get("exercises") or []) if isinstance(ex, dict) and ex.get("name")]
    if len(existing) > target:
        day["exercises"] = existing[:target]
        day["estimated_duration_min"] = max(int(day.get("estimated_duration_min") or 0), target * 8)
        return day

    if len(existing) >= target:
        day["exercises"] = existing
        day["estimated_duration_min"] = max(int(day.get("estimated_duration_min") or 0), target * 8)
        return day

    split = str(day.get("split_name") or "Training Day")
    pool = _exercise_pool_for_split(split)
    extra_sets = 1 if week_number >= 3 else 0
    used_names = {str(ex.get("name", "")).strip().lower() for ex in existing if ex.get("name")}
    padded = list(existing)

    for candidate in pool:
        if len(padded) >= target:
            break
        name = str(candidate.get("name", "")).strip().lower()
        if not name or name in used_names:
            continue
        copy = dict(candidate)
        copy["sets"] = int(copy.get("sets") or 3) + extra_sets
        padded.append(copy)
        used_names.add(name)

    idx = 0
    while len(padded) < target and pool:
        copy = dict(pool[idx % len(pool)])
        copy["sets"] = int(copy.get("sets") or 3) + extra_sets
        padded.append(copy)
        idx += 1

    day["exercises"] = padded
    day["estimated_duration_min"] = max(int(day.get("estimated_duration_min") or 0), target * 8)
    return day


def _normalize_workout_chunk_days(
    days: list[dict[str, Any]],
    *,
    exercises_per_session: int,
    week_number: int,
) -> list[dict[str, Any]]:
    return [
        _ensure_exercises_for_day(d, exercises_per_session=exercises_per_session, week_number=week_number)
        for d in days
    ]


def _fallback_workout_days(
    days: list[int],
    workouts_per_week: int,
    week_number: int,
    *,
    exercises_per_session: int,
) -> list[dict[str, Any]]:
    week_pattern = _fallback_week_splits(workouts_per_week)
    out: list[dict[str, Any]] = []
    extra_sets = 1 if week_number >= 3 else 0
    for i, d in enumerate(days):
        split, is_rest = week_pattern[i % len(week_pattern)]
        exs: list[dict[str, Any]] = []
        if not is_rest:
            pool = _exercise_pool_for_split(split)
            exs = _pad_exercises(pool, exercises_per_session, extra_sets=extra_sets)
        out.append(
            {
                "day": d,
                "is_rest_day": is_rest,
                "split_name": "Rest Day" if is_rest else split,
                "focus_muscles": [] if is_rest else _focus_muscles_for_split(split),
                "exercises": exs,
                "estimated_duration_min": 0 if is_rest else max(45, exercises_per_session * 8),
            }
        )
    return out


def _log_workout_day_counts(days: list[dict[str, Any]], exercises_per_session: int, workouts_per_week: int) -> None:
    for day_data in days:
        if not day_data.get("is_rest_day", False):
            actual_exercises = len(day_data.get("exercises") or [])
            if actual_exercises < exercises_per_session - 1:
                logger.warning(
                    "Day %s has only %s exercises, expected %s",
                    day_data.get("day"),
                    actual_exercises,
                    exercises_per_session,
                )
    training_days = sum(1 for d in days if not d.get("is_rest_day", False))
    rest_days = len(days) - training_days
    logger.info(
        "[WorkoutPlanner] Chunk: %s training days, %s rest days (workouts_per_week=%s)",
        training_days,
        rest_days,
        workouts_per_week,
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
        stored = goal.get("focus_muscle")
        focus_muscles = [str(stored)] if stored else []

    difficulty = str(goal.get("difficulty") or "intermediate").strip().lower()
    activity_level = str(activity.get("level") or "moderately_active").strip().lower()
    workouts_per_week = int(activity.get("workouts_per_week") or 4)
    exercises_per_session = get_exercises_per_session(difficulty, activity_level, workouts_per_week)

    return {
        "workouts_per_week": workouts_per_week,
        "exercises_per_session": exercises_per_session,
        "goal_type": str(goal.get("type") or "muscle_gain"),
        "difficulty": difficulty,
        "activity_level": activity_level,
        "focus_muscles": focus_muscles,
        "has_muscle_focus": len(focus_muscles) > 0,
        "workout_types": activity.get("workout_types") if isinstance(activity.get("workout_types"), list) else ["strength"],
        "user_weight_kg": float(personal.get("weight_kg") or user.weight or 70),
    }


def _generate_workout_chunk(
    *,
    days: list[int],
    chunk_index: int,
    ctx: dict[str, Any],
    continue_from_split: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    week_number = chunk_index + 1
    user_msg = {
        "days": days,
        "workouts_per_week": ctx["workouts_per_week"],
        "exercises_per_session": ctx["exercises_per_session"],
        "goal_type": ctx["goal_type"],
        "difficulty": ctx["difficulty"],
        "activity_level": ctx["activity_level"],
        "focus_muscles": ctx["focus_muscles"],
        "has_muscle_focus": ctx["has_muscle_focus"],
        "workout_types": ctx["workout_types"],
        "user_weight_kg": ctx["user_weight_kg"],
        "week_number": week_number,
    }
    if continue_from_split:
        user_msg["continue_from_split"] = continue_from_split
    if week_number >= 3:
        user_msg["progression_note"] = (
            f"This is week {week_number}. Slightly increase sets or reps compared to weeks 1-2 for progressive overload."
        )

    system_prompt = _build_workout_system_prompt(ctx, continue_from_split=bool(continue_from_split))

    for attempt in range(2):
        try:
            raw = _groq_workout_chunk(user_msg, system_prompt=system_prompt)
            validated = [_validate_workout_day(d) for d in raw]
            validated = [d for d in validated if d]
            if len(validated) >= len(days):
                result = _normalize_workout_chunk_days(
                    validated[: len(days)],
                    exercises_per_session=int(ctx["exercises_per_session"]),
                    week_number=week_number,
                )
                _log_workout_day_counts(result, int(ctx["exercises_per_session"]), int(ctx["workouts_per_week"]))
                return result, "groq"
        except Exception:
            if attempt == 0:
                continue
        try:
            raw = _gemini_workout_chunk(user_msg, system_prompt=system_prompt)
            validated = [_validate_workout_day(d) for d in raw]
            validated = [d for d in validated if d]
            if len(validated) >= len(days):
                result = _normalize_workout_chunk_days(
                    validated[: len(days)],
                    exercises_per_session=int(ctx["exercises_per_session"]),
                    week_number=week_number,
                )
                _log_workout_day_counts(result, int(ctx["exercises_per_session"]), int(ctx["workouts_per_week"]))
                return result, "gemini"
        except Exception:
            pass

    fallback = _fallback_workout_days(
        days,
        int(ctx["workouts_per_week"]),
        week_number,
        exercises_per_session=int(ctx["exercises_per_session"]),
    )
    _log_workout_day_counts(fallback, int(ctx["exercises_per_session"]), int(ctx["workouts_per_week"]))
    return fallback, "fallback"


def get_existing_workout_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyWorkoutPlan | None:
    return (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.user_id == user_id, MonthlyWorkoutPlan.month == month, MonthlyWorkoutPlan.year == year)
        .first()
    )


def generate_workout_plan(
    db: Session,
    user: User,
    *,
    focus_muscles: list[str] | None,
    local_date: str | None,
) -> MonthlyWorkoutPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    existing = get_existing_workout_plan(db, user.id, month, year)
    if existing:
        return existing

    muscles = focus_muscles if focus_muscles is not None else []
    ctx = _build_workout_ctx(db, user, focus_muscles=muscles)
    logger.info(
        "[WorkoutPlanner] user=%s: workouts_per_week=%s, exercises_per_session=%s, difficulty=%s, goal=%s, focus=%s",
        user.id,
        ctx["workouts_per_week"],
        ctx["exercises_per_session"],
        ctx["difficulty"],
        ctx["goal_type"],
        ctx["focus_muscles"],
    )

    all_days: list[dict[str, Any]] = []
    source = "groq"
    for idx, chunk in enumerate(month_chunks(month, year)):
        chunk_days, chunk_source = _generate_workout_chunk(days=chunk, chunk_index=idx, ctx=ctx)
        if chunk_source == "fallback":
            source = "fallback"
        elif chunk_source == "gemini" and source == "groq":
            source = "gemini"
        all_days.extend(chunk_days)

    plan = MonthlyWorkoutPlan(
        user_id=user.id,
        month=month,
        year=year,
        generated_at=datetime.utcnow(),
        source=source,
    )
    plan_set_focus_muscles(plan, ctx["focus_muscles"])
    db.add(plan)
    db.flush()

    for d in all_days:
        db.add(
            DailyWorkoutPlanEntry(
                plan_id=plan.id,
                day=int(d["day"]),
                is_rest_day=bool(d.get("is_rest_day")),
                split_name=str(d.get("split_name") or "Rest Day"),
                focus_muscles_json=safe_json_dumps(d.get("focus_muscles") or []),
                exercises_json=safe_json_dumps(d.get("exercises") or []),
                estimated_duration_min=int(d.get("estimated_duration_min") or 0),
            )
        )
    db.commit()
    db.refresh(plan)
    return plan


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


def workout_plan_current_response(plan: MonthlyWorkoutPlan, local_date: str | None) -> dict[str, Any]:
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
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "focus_muscles": plan_get_focus_muscles(plan),
        "focus_muscle": plan.focus_muscle,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "today": _workout_entry_dict(today_entry, locked=False) if today_entry else None,
        "month_overview": month_overview,
    }


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
    if from_day > last_day:
        raise ValueError("from_day exceeds month length")

    plan = get_existing_workout_plan(db, user.id, month, year)
    if not plan:
        raise LookupError("No plan exists for this month")

    plan_set_focus_muscles(plan, focus_muscles)

    db.query(DailyWorkoutPlanEntry).filter(
        DailyWorkoutPlanEntry.plan_id == plan.id,
        DailyWorkoutPlanEntry.day >= from_day,
    ).delete(synchronize_session=False)
    db.flush()

    last_training = (
        db.query(DailyWorkoutPlanEntry)
        .filter(
            DailyWorkoutPlanEntry.plan_id == plan.id,
            DailyWorkoutPlanEntry.day < from_day,
            DailyWorkoutPlanEntry.is_rest_day.is_(False),
        )
        .order_by(DailyWorkoutPlanEntry.day.desc())
        .first()
    )
    continue_from = last_training.split_name if last_training else None

    effective_focus = plan_get_focus_muscles(plan)
    ctx = _build_workout_ctx(db, user, focus_muscles=effective_focus)
    logger.info(
        "[WorkoutPlanner] Regenerating user=%s from day %s: workouts_per_week=%s, exercises_per_session=%s, focus=%s",
        user.id,
        from_day,
        ctx["workouts_per_week"],
        ctx["exercises_per_session"],
        ctx["focus_muscles"],
    )

    chunks = days_chunks_from_range(from_day, last_day)
    split_cursor = continue_from
    for idx, chunk_days in enumerate(chunks):
        new_days, _ = _generate_workout_chunk(
            days=chunk_days,
            chunk_index=idx,
            ctx=ctx,
            continue_from_split=split_cursor,
        )
        for d in new_days:
            db.add(
                DailyWorkoutPlanEntry(
                    plan_id=plan.id,
                    day=int(d["day"]),
                    is_rest_day=bool(d.get("is_rest_day")),
                    split_name=str(d.get("split_name") or "Rest Day"),
                    focus_muscles_json=safe_json_dumps(d.get("focus_muscles") or []),
                    exercises_json=safe_json_dumps(d.get("exercises") or []),
                    estimated_duration_min=int(d.get("estimated_duration_min") or 0),
                )
            )
        non_rest = [d for d in reversed(new_days) if not d.get("is_rest_day")]
        if non_rest:
            split_cursor = str(non_rest[0].get("split_name"))

    plan.generated_at = datetime.utcnow()
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


EXERCISE_SWAP_SYSTEM_PROMPT = """You are an expert strength coach. Replace one exercise with a suitable alternative.
Return ONLY a JSON object with key "exercise" containing the replacement.

The replacement exercise MUST:
- Target the SAME primary muscle group as the original.
- Be a different movement pattern (e.g. if original was a press, suggest a fly or crossover; if original was a row, suggest a pulldown or face pull).
- Keep similar sets and rep range.
- Be a real, standard gym exercise.
- Include a coaching cue in the "note" field.
- If the reason is "no_equipment", suggest a bodyweight or dumbbell-only alternative.
- If the reason is "too_hard", suggest an easier regression.
- If the reason is "too_easy", suggest a harder progression.
- If the reason is "injury", suggest a joint-friendly alternative for that muscle.

The exercise object must have keys: name, sets, reps, muscle, note, rest_seconds."""

EXERCISE_ALTERNATIVES: dict[str, list[dict[str, Any]]] = {
    "Chest": [
        {"name": "Push Ups", "sets": 3, "reps": "15-20", "muscle": "Chest", "note": "Full range of motion", "rest_seconds": 60},
        {"name": "Dumbbell Fly", "sets": 3, "reps": "12-15", "muscle": "Chest", "note": "Slight bend in elbows", "rest_seconds": 60},
        {"name": "Cable Crossover", "sets": 3, "reps": "12-15", "muscle": "Chest", "note": "Squeeze at center", "rest_seconds": 60},
    ],
    "Back": [
        {"name": "Dumbbell Row", "sets": 4, "reps": "10-12", "muscle": "Back", "note": "Pull to hip", "rest_seconds": 75},
        {"name": "Pull Ups", "sets": 3, "reps": "8-12", "muscle": "Back", "note": "Full dead hang at bottom", "rest_seconds": 90},
        {"name": "T-Bar Row", "sets": 3, "reps": "10-12", "muscle": "Back", "note": "Keep chest on pad", "rest_seconds": 75},
    ],
    "Shoulders": [
        {"name": "Arnold Press", "sets": 3, "reps": "10-12", "muscle": "Shoulders", "note": "Rotate palms during press", "rest_seconds": 75},
        {"name": "Face Pull", "sets": 3, "reps": "15", "muscle": "Shoulders", "note": "External rotate at the end", "rest_seconds": 60},
        {"name": "Dumbbell Front Raise", "sets": 3, "reps": "12-15", "muscle": "Shoulders", "note": "Alternate arms", "rest_seconds": 60},
    ],
    "Biceps": [
        {"name": "Hammer Curl", "sets": 3, "reps": "10-12", "muscle": "Biceps", "note": "No swinging", "rest_seconds": 60},
        {"name": "Incline Dumbbell Curl", "sets": 3, "reps": "10-12", "muscle": "Biceps", "note": "Let arms hang fully", "rest_seconds": 60},
        {"name": "Cable Curl", "sets": 3, "reps": "12-15", "muscle": "Biceps", "note": "Constant tension", "rest_seconds": 60},
    ],
    "Triceps": [
        {"name": "Skull Crushers", "sets": 3, "reps": "10-12", "muscle": "Triceps", "note": "Lower to forehead", "rest_seconds": 75},
        {"name": "Overhead Tricep Extension", "sets": 3, "reps": "12-15", "muscle": "Triceps", "note": "Full stretch at bottom", "rest_seconds": 60},
        {"name": "Diamond Push Ups", "sets": 3, "reps": "12-15", "muscle": "Triceps", "note": "Hands close together", "rest_seconds": 60},
    ],
    "Legs": [
        {"name": "Goblet Squat", "sets": 3, "reps": "12-15", "muscle": "Legs", "note": "Hold dumbbell at chest", "rest_seconds": 90},
        {"name": "Walking Lunges", "sets": 3, "reps": "12 each", "muscle": "Legs", "note": "Long stride", "rest_seconds": 75},
        {"name": "Leg Press", "sets": 4, "reps": "10-12", "muscle": "Legs", "note": "Don't lock knees", "rest_seconds": 90},
    ],
    "Rear Delts": [
        {"name": "Reverse Fly", "sets": 3, "reps": "15", "muscle": "Rear Delts", "note": "Pinch shoulder blades", "rest_seconds": 60},
        {"name": "Band Pull Apart", "sets": 3, "reps": "20", "muscle": "Rear Delts", "note": "Chest up", "rest_seconds": 45},
    ],
}


def get_fallback_exercise_swap(muscle: str, exclude_names: list[str]) -> dict[str, Any]:
    alternatives = EXERCISE_ALTERNATIVES.get(muscle, EXERCISE_ALTERNATIVES["Chest"])
    for alt in alternatives:
        if alt["name"] not in exclude_names:
            return dict(alt)
    return dict(alternatives[0])


def _groq_swap_exercise(user_msg: dict[str, Any]) -> dict[str, Any]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing")
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
            "temperature": 0.6,
            "max_tokens": 300,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": EXERCISE_SWAP_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_msg)},
            ],
        },
        timeout=45,
    )
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = json.loads(content.replace("```json", "").replace("```", "").strip())
    exercise = parsed.get("exercise") if isinstance(parsed, dict) else None
    if not isinstance(exercise, dict) or not exercise.get("name"):
        raise ValueError("Invalid exercise swap response")
    return exercise


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

    onboarding, _ = _onboarding_context(db, user.id)
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    other_names = [str(ex.get("name", "")) for ex in exercises if isinstance(ex, dict)]

    user_msg = {
        "original_exercise": original,
        "reason": reason or "want_variety",
        "other_exercises_today": [n for n in other_names if n and n != original.get("name")],
        "difficulty": str(goal.get("difficulty") or "intermediate"),
        "goal_type": str(goal.get("type") or "muscle_gain"),
    }

    replacement: dict[str, Any] | None = None
    try:
        replacement = _groq_swap_exercise(user_msg)
    except Exception:
        replacement = None

    if not replacement:
        muscle = str(original.get("muscle") or "Chest")
        replacement = get_fallback_exercise_swap(muscle, exclude_names=other_names)

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
