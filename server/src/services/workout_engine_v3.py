"""Deterministic workout plan engine (v3).

Selects canonical exercises from global_exercises — no AI calls.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session

from src.models.models import GlobalExercise, WorkoutSession, WorkoutSessionSetLog
from src.services.resolve_baseline_load_kg import (
    is_bodyweight_exercise,
    parse_recommended_weight_midpoint,
    resolve_baseline_load_kg,
)

logger = logging.getLogger(__name__)

GoalType = Literal["muscle_gain", "strength", "fat_loss", "maintain", "endurance"]
Difficulty = Literal["beginner", "intermediate", "advanced"]
ExerciseRole = Literal["primary_compound", "secondary_compound", "isolation"]

WORK_SECONDS_PER_SET = 45
COOLDOWN_TRAINING_DAYS = 4
COMPOUND_COOLDOWN_TRAINING_DAYS = 2
CANDIDATE_SAMPLE = 14
NEVER_USED_WEIGHT = 999
MAX_RECENCY_WEIGHT = 21

SPLIT_I18N_PREFIX = "coach.workout.split."

# (split_key, is_rest, focus_muscles)
SPLIT_WEEK_PATTERNS: dict[int, list[tuple[str, bool, list[str]]]] = {
    1: [
        ("full_body", False, ["Chest", "Back", "Legs", "Shoulders"]),
        ("rest", True, []),
        ("rest", True, []),
        ("rest", True, []),
        ("rest", True, []),
        ("rest", True, []),
        ("rest", True, []),
    ],
    2: [
        ("full_body_a", False, ["Chest", "Back", "Legs"]),
        ("rest", True, []),
        ("rest", True, []),
        ("full_body_b", False, ["Shoulders", "Back", "Legs"]),
        ("rest", True, []),
        ("rest", True, []),
        ("rest", True, []),
    ],
    3: [
        ("full_body_a", False, ["Chest", "Back", "Legs"]),
        ("rest", True, []),
        ("full_body_b", False, ["Shoulders", "Back", "Arms"]),
        ("rest", True, []),
        ("full_body_c", False, ["Legs", "Core", "Chest"]),
        ("rest", True, []),
        ("rest", True, []),
    ],
    4: [
        ("upper_a", False, ["Chest", "Back", "Shoulders", "Arms"]),
        ("lower_a", False, ["Legs", "Core"]),
        ("rest", True, []),
        ("upper_b", False, ["Back", "Chest", "Arms"]),
        ("lower_b", False, ["Legs", "Glutes"]),
        ("rest", True, []),
        ("rest", True, []),
    ],
    5: [
        ("push", False, ["Chest", "Shoulders", "Triceps"]),
        ("pull", False, ["Back", "Biceps", "Rear Delts"]),
        ("legs", False, ["Legs", "Glutes", "Calves"]),
        ("rest", True, []),
        ("upper", False, ["Chest", "Back", "Shoulders", "Arms"]),
        ("lower", False, ["Legs", "Hamstrings", "Glutes"]),
        ("rest", True, []),
    ],
    6: [
        ("push_a", False, ["Chest", "Shoulders", "Triceps"]),
        ("pull_a", False, ["Back", "Biceps", "Rear Delts"]),
        ("legs_a", False, ["Quads", "Hamstrings", "Glutes"]),
        ("rest", True, []),
        ("push_b", False, ["Shoulders", "Chest", "Triceps"]),
        ("pull_b", False, ["Back", "Biceps", "Rear Delts"]),
        ("legs_b", False, ["Hamstrings", "Glutes", "Quads"]),
    ],
}

SPLIT_KEY_MUSCLES: dict[str, list[str]] = {
    "push": ["Chest", "Shoulders", "Triceps"],
    "push_a": ["Chest", "Shoulders", "Triceps"],
    "push_b": ["Shoulders", "Chest", "Triceps"],
    "pull": ["Back", "Biceps", "Rear Delts"],
    "pull_a": ["Back", "Biceps", "Rear Delts"],
    "pull_b": ["Back", "Biceps", "Rear Delts"],
    "legs": ["Legs", "Glutes", "Calves"],
    "legs_a": ["Quads", "Hamstrings", "Glutes"],
    "legs_b": ["Hamstrings", "Glutes", "Quads"],
    "upper": ["Chest", "Back", "Shoulders", "Arms"],
    "upper_a": ["Chest", "Back", "Shoulders", "Arms"],
    "upper_b": ["Back", "Chest", "Arms"],
    "lower": ["Legs", "Glutes"],
    "lower_a": ["Legs", "Core"],
    "lower_b": ["Legs", "Glutes"],
    "full_body": ["Chest", "Back", "Legs", "Shoulders"],
    "full_body_a": ["Chest", "Back", "Legs"],
    "full_body_b": ["Shoulders", "Back", "Legs"],
    "full_body_c": ["Legs", "Core", "Chest"],
}

PROBLEM_AREA_PATTERNS: dict[str, list[str]] = {
    "belly_fat": ["core_compound"],
    "love_handles": ["core_compound"],
    "skinny_arms": ["arm_isolation"],
    "chicken_legs": ["squat_pattern", "hinge_pattern"],
    "chest_fat": ["incline_press"],
    "back_fat": ["row_pattern"],
    "rounded_shoulders": ["rear_delt"],
    "flat_glutes": ["hip_thrust"],
    "arm_flab": ["tricep_isolation"],
    "inner_thigh_fat": ["sumo_squat"],
    "belly_pooch": ["core_compound"],
    "weak_core": ["core_compound"],
    "bra_back_fat": ["row_pattern", "lat_pull"],
}

PATTERN_CUES: dict[str, list[str]] = {
    "press": [
        "Brace your core before each rep",
        "Control the lowering phase — don't bounce",
        "Drive through the full range of motion",
    ],
    "pull": [
        "Initiate with your back, not your arms",
        "Squeeze at the peak contraction",
        "Keep shoulders down and chest up",
    ],
    "hinge": [
        "Push hips back, keep a flat back",
        "Feel the stretch in your hamstrings",
        "Drive hips forward to stand — don't round",
    ],
    "squat": [
        "Sit back and down, knees track over toes",
        "Keep chest up and core braced",
        "Drive through mid-foot to stand",
    ],
    "isolation": [
        "Move only at the target joint",
        "Use a weight you can control — no swinging",
        "Squeeze at the top, slow on the way down",
    ],
    "core": [
        "Breathe steadily — don't hold your breath",
        "Keep a neutral spine throughout",
        "Quality over speed — feel the target muscles",
    ],
}

# Male intermediate 1RM as fraction of bodyweight; female uses ×0.65
LIFT_BW_RATIOS: dict[str, dict[str, float]] = {
    "squat": {"beginner": 0.75, "intermediate": 1.0, "advanced": 1.35},
    "deadlift": {"beginner": 1.0, "intermediate": 1.5, "advanced": 2.0},
    "bench": {"beginner": 0.5, "intermediate": 0.75, "advanced": 1.0},
    "ohp": {"beginner": 0.35, "intermediate": 0.55, "advanced": 0.75},
    "row": {"beginner": 0.45, "intermediate": 0.65, "advanced": 0.85},
}

ROLE_PRESCRIPTION: dict[ExerciseRole, dict[str, Any]] = {
    "primary_compound": {
        "sets_base": 3,
        "reps_low": 6,
        "reps_high": 8,
        "pct_1rm": 0.78,
        "rest_seconds": 120,
    },
    "secondary_compound": {
        "sets_base": 3,
        "reps_low": 8,
        "reps_high": 12,
        "pct_1rm": 0.70,
        "rest_seconds": 90,
    },
    "isolation": {
        "sets_base": 3,
        "reps_low": 12,
        "reps_high": 15,
        "pct_1rm": 0.62,
        "rest_seconds": 60,
    },
}

GOAL_VOLUME_TARGETS: dict[str, tuple[int, int]] = {
    "muscle_gain": (10, 16),
    "strength": (8, 12),
    "fat_loss": (8, 14),
    "endurance": (8, 14),
    "maintain": (8, 14),
}

EquipmentAccess = Literal["full_gym", "dumbbells", "bodyweight_only"]

EQUIPMENT_ACCESS_ALLOWED: dict[EquipmentAccess, set[str] | None] = {
    "full_gym": None,
    "dumbbells": {"bodyweight", "dumbbell", "resistance band"},
    "bodyweight_only": {"bodyweight"},
}

MUSCLE_VOLUME_GROUP: dict[str, str] = {
    "chest": "Chest",
    "back": "Back",
    "shoulders": "Shoulders",
    "rear delts": "Shoulders",
    "biceps": "Arms",
    "triceps": "Arms",
    "arms": "Arms",
    "quads": "Legs",
    "hamstrings": "Legs",
    "glutes": "Legs",
    "calves": "Legs",
    "legs": "Legs",
    "core": "Core",
}

VOLUME_REBALANCE_MAX_SETS_PER_EXERCISE = 10
VOLUME_OVER_CAP_BUFFER = 3

WEIGHT_INCREMENTS: dict[str, float] = {
    "barbell_compound": 2.5,
    "dumbbell": 2.0,
    "machine_cable": 2.5,
    "bodyweight": 0.0,
}


@dataclass
class CatalogExercise:
    id: int
    name: str
    body_part: str
    equipment: str
    difficulty: str
    is_compound: bool
    met_value: float
    muscles_primary: list[str]
    muscles_secondary: list[str]
    cues: list[str]
    movement_pattern: str


@dataclass
class WorkoutEngineContext:
    user_id: int
    workouts_per_week: int
    exercises_per_session: int
    goal_type: str
    difficulty: str
    activity_level: str
    focus_muscles: list[str]
    user_weight_kg: float
    user_sex: str
    problem_areas: list[str]
    equipment_access: EquipmentAccess = "full_gym"
    regen_version: int = 0
    week_number: int = 1


def normalize_goal(goal: str) -> GoalType:
    g = (goal or "muscle_gain").strip().lower()
    if g in {"strength", "power"}:
        return "strength"
    if g in {"fat_loss", "cut", "weight_loss"}:
        return "fat_loss"
    if g in {"endurance", "cardio"}:
        return "endurance"
    if g in {"maintain", "maintenance"}:
        return "maintain"
    return "muscle_gain"


def normalize_equipment_access(value: str | None) -> EquipmentAccess:
    key = (value or "full_gym").strip().lower().replace(" ", "_").replace("-", "_")
    if key in {"bodyweight", "bodyweight_only", "no_equipment"}:
        return "bodyweight_only"
    if key in {"dumbbells", "dumbbell", "home_gym"}:
        return "dumbbells"
    return "full_gym"


def normalize_difficulty(difficulty: str) -> Difficulty:
    d = (difficulty or "intermediate").strip().lower()
    if d == "beginner":
        return "beginner"
    if d == "advanced":
        return "advanced"
    return "intermediate"


def _rng(user_id: int, month: int, year: int, day: int, slot: str, version: int) -> random.Random:
    seed_str = f"{user_id}|{year}-{month:02d}|{day}|{slot}|{version}"
    seed = int(hashlib.sha256(seed_str.encode()).hexdigest()[:16], 16)
    return random.Random(seed)


def split_display_name(split_key: str) -> str:
    if split_key == "rest":
        return f"{SPLIT_I18N_PREFIX}rest"
    return f"{SPLIT_I18N_PREFIX}{split_key}"


def week_pattern(workouts_per_week: int) -> list[tuple[str, bool, list[str]]]:
    wpw = max(1, min(6, int(workouts_per_week)))
    return SPLIT_WEEK_PATTERNS.get(wpw, SPLIT_WEEK_PATTERNS[4])


def rotate_pattern(
    pattern: list[tuple[str, bool, list[str]]],
    *,
    continue_from_split_key: str | None,
) -> list[tuple[str, bool, list[str]]]:
    if not continue_from_split_key:
        return pattern
    training = [p for p in pattern if not p[1]]
    if not training:
        return pattern
    keys = [p[0] for p in training]
    try:
        idx = keys.index(continue_from_split_key)
        rotate_by = (idx + 1) % len(keys)
    except ValueError:
        rotate_by = 0
    if rotate_by == 0:
        return pattern
    rotated_training = training[rotate_by:] + training[:rotate_by]
    out: list[tuple[str, bool, list[str]]] = []
    ti = 0
    for split_key, is_rest, muscles in pattern:
        if is_rest:
            out.append(("rest", True, []))
        else:
            out.append(rotated_training[ti])
            ti += 1
    return out


def classify_movement_pattern(ex: CatalogExercise) -> str:
    name = ex.name.lower()
    if any(k in name for k in ("plank", "woodchop", "dead bug", "bird dog", "crunch", "side plank")):
        return "core_compound"
    if any(k in name for k in ("face pull", "reverse fly", "band pull")):
        return "rear_delt"
    if any(k in name for k in ("incline", "pike push")):
        return "incline_press"
    if any(k in name for k in ("row", "pulldown", "pull-up", "chin-up", "lat ")):
        return "row_pattern"
    if "lat pulldown" in name or "pull-up" in name or "chin-up" in name:
        return "lat_pull"
    if any(k in name for k in ("curl", "hammer")):
        return "arm_isolation"
    if any(k in name for k in ("tricep", "pushdown", "skull", "dip", "extension")) and ex.body_part == "Arms":
        return "tricep_isolation"
    if any(k in name for k in ("sumo", "adductor")):
        return "sumo_squat"
    if any(k in name for k in ("hip thrust", "glute bridge")):
        return "hip_thrust"
    if any(k in name for k in ("squat", "lunge", "leg press", "hack")):
        return "squat_pattern"
    if any(k in name for k in ("deadlift", "rdl", "hinge", "good morning")):
        return "hinge_pattern"
    if ex.is_compound:
        if any(k in name for k in ("press", "push", "bench", "fly")):
            return "press_pattern"
        if any(k in name for k in ("row", "pull")):
            return "row_pattern"
        return "squat_pattern"
    return "isolation_pattern"


def cue_pattern_category(pattern: str) -> str:
    if pattern in {"core_compound", "hip_thrust"}:
        return "core"
    if pattern in {"row_pattern", "lat_pull", "rear_delt"}:
        return "pull"
    if pattern in {"press_pattern", "incline_press"}:
        return "press"
    if pattern in {"squat_pattern", "sumo_squat"}:
        return "squat"
    if pattern in {"hinge_pattern"}:
        return "hinge"
    if pattern in {"arm_isolation", "tricep_isolation", "isolation_pattern"}:
        return "isolation"
    return "isolation"


def load_catalog(db: Session) -> list[CatalogExercise]:
    rows = db.query(GlobalExercise).all()
    out: list[CatalogExercise] = []
    for row in rows:
        cues_raw = getattr(row, "cues", None) or []
        if isinstance(cues_raw, str):
            import json

            try:
                cues_raw = json.loads(cues_raw)
            except Exception:
                cues_raw = []
        cues = [str(c) for c in cues_raw] if isinstance(cues_raw, list) else []
        ex = CatalogExercise(
            id=int(row.id),
            name=str(row.name),
            body_part=str(row.body_part or ""),
            equipment=str(row.equipment or ""),
            difficulty=str(row.difficulty or "Intermediate"),
            is_compound=bool(row.is_compound),
            met_value=float(row.met_value or 5.0),
            muscles_primary=list(row.muscles_primary or []),
            muscles_secondary=list(row.muscles_secondary or []),
            cues=cues,
            movement_pattern="",
        )
        ex.movement_pattern = classify_movement_pattern(ex)
        out.append(ex)
    return out


def _equipment_allowed(ex: CatalogExercise, access: EquipmentAccess) -> bool:
    allowed = EQUIPMENT_ACCESS_ALLOWED.get(access)
    if allowed is None:
        return True
    return ex.equipment.strip().lower() in allowed


def _difficulty_allowed(ex_diff: str, user_diff: Difficulty) -> bool:
    tier = {"beginner": 0, "intermediate": 1, "advanced": 2}
    ex_t = tier.get(ex_diff.strip().lower(), 1)
    user_t = tier[user_diff]
    if user_diff == "beginner":
        return ex_t <= 1
    if user_diff == "intermediate":
        return ex_t <= 2
    return ex_t >= 1


def _split_target_muscles(split_key: str, focus_muscles: list[str]) -> list[str]:
    base = list(SPLIT_KEY_MUSCLES.get(split_key, ["Chest", "Back", "Legs"]))
    for fm in focus_muscles:
        if fm and fm not in base:
            base.append(fm)
    return base


def _muscle_matches(ex: CatalogExercise, muscle: str) -> bool:
    m = muscle.lower()
    if ex.body_part.lower() == m:
        return True
    primary = " ".join(ex.muscles_primary).lower()
    secondary = " ".join(ex.muscles_secondary).lower()
    if m in {"arms", "biceps", "triceps"}:
        return ex.body_part.lower() == "arms" or "bicep" in primary or "tricep" in primary
    if m in {"rear delts", "rear delt"}:
        return "rear" in primary or "rear" in secondary or "face pull" in ex.name.lower()
    if m in {"legs", "quads", "hamstrings", "glutes", "calves"}:
        return ex.body_part.lower() == "legs" or m.rstrip("s") in primary
    return m.rstrip("s") in primary or m.rstrip("s") in secondary or m in ex.name.lower()


def _filter_pool(
    catalog: list[CatalogExercise],
    *,
    target_muscles: list[str],
    difficulty: Difficulty,
    equipment_access: EquipmentAccess,
    exclude_ids: set[int],
    required_patterns: list[str],
) -> list[CatalogExercise]:
    pool: list[CatalogExercise] = []
    for ex in catalog:
        if ex.id in exclude_ids:
            continue
        if not _equipment_allowed(ex, equipment_access):
            continue
        if not _difficulty_allowed(ex.difficulty, difficulty):
            continue
        if not any(_muscle_matches(ex, m) for m in target_muscles):
            continue
        pool.append(ex)
    if required_patterns:
        pattern_hits = [ex for ex in pool if ex.movement_pattern in required_patterns]
        if pattern_hits:
            pool = pattern_hits + [ex for ex in pool if ex not in pattern_hits]
    return pool


def _recency_weight(ex_id: int, recent_ids: list[int]) -> int:
    if ex_id not in recent_ids:
        return NEVER_USED_WEIGHT
    days_ago = len(recent_ids) - recent_ids.index(ex_id)
    return max(1, min(MAX_RECENCY_WEIGHT, days_ago))


def _weighted_sample(
    rng: random.Random,
    candidates: list[CatalogExercise],
    weights: list[int],
    k: int,
) -> list[CatalogExercise]:
    if not candidates:
        return []
    pool = list(candidates)
    w = list(weights)
    picked: list[CatalogExercise] = []
    for _ in range(min(k, len(pool))):
        total = sum(w)
        if total <= 0:
            break
        r = rng.randint(1, total)
        acc = 0
        for i, wt in enumerate(w):
            acc += wt
            if r <= acc:
                picked.append(pool.pop(i))
                w.pop(i)
                break
    return picked


def _lift_family(ex_name: str) -> str:
    n = ex_name.lower()
    if any(k in n for k in ("deadlift", "rdl", "romanian")):
        return "deadlift"
    if any(k in n for k in ("squat", "leg press", "hack squat", "goblet squat", "lunge")):
        return "squat"
    if any(k in n for k in ("bench", "floor press", "chest press")):
        return "bench"
    if any(k in n for k in ("overhead", "ohp", "shoulder press", "military press", "pike push")):
        return "ohp"
    if any(k in n for k in ("row", "pulldown", "pull-up", "chin-up")):
        return "row"
    return "bench"


def _estimate_1rm_kg(ctx: WorkoutEngineContext, ex: CatalogExercise) -> float | None:
    family = _lift_family(ex.name)
    ratios = LIFT_BW_RATIOS.get(family, LIFT_BW_RATIOS["bench"])
    diff = normalize_difficulty(ctx.difficulty)
    ratio = ratios.get(diff, ratios["intermediate"])
    sex_mult = 0.65 if (ctx.user_sex or "").lower() in {"female", "f", "woman"} else 1.0
    return ctx.user_weight_kg * ratio * sex_mult


def _epley_1rm(weight_kg: float, reps: int) -> float:
    return weight_kg * (1.0 + reps / 30.0)


def _latest_session_sets(
    db: Session,
    user_id: int,
    exercise_name: str,
) -> list[WorkoutSessionSetLog]:
    key = exercise_name.strip().lower()
    rows = (
        db.query(WorkoutSessionSetLog)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSessionSetLog.session_pk)
        .filter(
            WorkoutSession.user_id == user_id,
            WorkoutSessionSetLog.exercise_name.ilike(exercise_name),
        )
        .order_by(WorkoutSessionSetLog.completed_at.desc())
        .limit(20)
        .all()
    )
    if not rows:
        return []
    latest_session = rows[0].session_pk
    return [r for r in rows if r.session_pk == latest_session]


def _round_weight(kg: float, equipment: str) -> float:
    eq = equipment.lower()
    step = 2.5 if "barbell" in eq else 2.0
    return round(kg / step) * step


def _increment_kg(ex: CatalogExercise) -> float:
    eq = ex.equipment.lower()
    if eq == "bodyweight":
        return 0.0
    if "barbell" in eq and ex.is_compound:
        return WEIGHT_INCREMENTS["barbell_compound"]
    if "dumbbell" in eq:
        return WEIGHT_INCREMENTS["dumbbell"]
    return WEIGHT_INCREMENTS["machine_cable"]


def _prescribe_weight(
    db: Session,
    ctx: WorkoutEngineContext,
    ex: CatalogExercise,
    role: ExerciseRole,
) -> dict[str, Any]:
    role_cfg = ROLE_PRESCRIPTION[role]
    baseline = resolve_baseline_load_kg(db, ctx.user_id, ex.name)
    sets_logs = _latest_session_sets(db, ctx.user_id, ex.name)

    estimated_1rm: float | None = None
    has_history = baseline is not None and baseline > 0

    if sets_logs:
        best = max(
            (r for r in sets_logs if r.weight_kg and r.weight_kg > 0),
            key=lambda r: _epley_1rm(float(r.weight_kg), int(r.reps)),
            default=None,
        )
        if best is not None:
            estimated_1rm = _epley_1rm(float(best.weight_kg), int(best.reps))
    elif baseline and baseline > 0:
        estimated_1rm = float(baseline) / role_cfg["pct_1rm"]
    else:
        estimated_1rm = _estimate_1rm_kg(ctx, ex)

    if estimated_1rm is None or estimated_1rm <= 0 or is_bodyweight_exercise(db, ex.name):
        return {
            "weight_kg": None,
            "weight_kg_low": None,
            "weight_kg_high": None,
            "weight_change_kg": None,
            "progression_note": None,
        }

    working = estimated_1rm * role_cfg["pct_1rm"]
    working = _round_weight(working, ex.equipment)
    low = _round_weight(max(working - 2.5, 2.5), ex.equipment)
    high = _round_weight(working + 2.5, ex.equipment)

    weight_change_kg: float | None = None
    progression_note: str | None = None

    if has_history and sets_logs:
        reps_high = role_cfg["reps_high"]
        working_sets = [r for r in sets_logs if r.weight_kg and r.weight_kg > 0]
        if working_sets and all(int(r.reps) >= reps_high for r in working_sets):
            inc = _increment_kg(ex)
            if inc > 0:
                working = _round_weight(float(working_sets[0].weight_kg) + inc, ex.equipment)
                low = _round_weight(working - 2.5, ex.equipment)
                high = _round_weight(working + 2.5, ex.equipment)
                weight_change_kg = inc
                progression_note = f"+{inc:g} kg from last time"
        elif working_sets and all(int(r.reps) < role_cfg["reps_low"] for r in working_sets):
            progression_note = None
        elif working_sets:
            progression_note = "Same as last time — aim for one more rep"

    return {
        "weight_kg": working,
        "weight_kg_low": low,
        "weight_kg_high": high,
        "weight_change_kg": weight_change_kg,
        "progression_note": progression_note,
    }


def _select_cue(
    rng: random.Random,
    ex: CatalogExercise,
) -> str:
    if ex.cues:
        return ex.cues[rng.randint(0, len(ex.cues) - 1)]
    cat = cue_pattern_category(ex.movement_pattern)
    variants = PATTERN_CUES.get(cat, PATTERN_CUES["isolation"])
    return variants[rng.randint(0, len(variants) - 1)]


def _assign_roles(count: int, compounds: list[CatalogExercise], isolations: list[CatalogExercise]) -> list[tuple[CatalogExercise, ExerciseRole]]:
    ordered: list[CatalogExercise] = compounds + isolations
    ordered = ordered[:count]
    roles: list[tuple[CatalogExercise, ExerciseRole]] = []
    for i, ex in enumerate(ordered):
        if i == 0 and ex.is_compound:
            roles.append((ex, "primary_compound"))
        elif ex.is_compound:
            roles.append((ex, "secondary_compound"))
        else:
            roles.append((ex, "isolation"))
    return roles


def _goal_sets_adjustment(goal: GoalType, week_number: int) -> int:
    extra = 1 if week_number >= 3 else 0
    if goal == "strength":
        return extra
    if goal == "fat_loss":
        return 0
    return extra


def _prescribe_exercise(
    db: Session,
    ctx: WorkoutEngineContext,
    ex: CatalogExercise,
    role: ExerciseRole,
    rng: random.Random,
    *,
    extra_sets: int = 0,
) -> dict[str, Any]:
    goal = normalize_goal(ctx.goal_type)
    role_cfg = ROLE_PRESCRIPTION[role]
    sets = role_cfg["sets_base"] + _goal_sets_adjustment(goal, ctx.week_number) + extra_sets
    if goal == "strength" and role == "primary_compound":
        sets = min(sets, 5)
        reps = f"{max(3, role_cfg['reps_low'] - 2)}-{role_cfg['reps_low']}"
        rest = max(role_cfg["rest_seconds"], 150)
    elif goal == "fat_loss" and role == "isolation":
        reps = f"{role_cfg['reps_high']}-{role_cfg['reps_high'] + 3}"
        rest = min(role_cfg["rest_seconds"], 45)
    else:
        reps = f"{role_cfg['reps_low']}-{role_cfg['reps_high']}"
        rest = role_cfg["rest_seconds"]

    muscle = ex.body_part
    if ex.body_part == "Arms":
        if "bicep" in " ".join(ex.muscles_primary).lower():
            muscle = "Biceps"
        elif "tricep" in " ".join(ex.muscles_primary).lower():
            muscle = "Triceps"
        else:
            muscle = "Arms"

    weight_fields = _prescribe_weight(db, ctx, ex, role)
    return {
        "name": ex.name,
        "exercise_id": ex.id,
        "met_value": ex.met_value,
        "sets": sets,
        "reps": reps,
        "muscle": muscle,
        "note": _select_cue(rng, ex),
        "rest_seconds": rest,
        **weight_fields,
    }


def _volume_group_for_muscle(muscle: str) -> str:
    key = (muscle or "").strip().lower()
    if not key:
        return "Other"
    if key in MUSCLE_VOLUME_GROUP:
        return MUSCLE_VOLUME_GROUP[key]
    for token, group in MUSCLE_VOLUME_GROUP.items():
        if token in key or key in token:
            return group
    return muscle.strip().title() or "Other"


def _weekly_muscle_sets(training_days: list[dict[str, Any]]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for day in training_days:
        for ex in day.get("exercises") or []:
            if not isinstance(ex, dict):
                continue
            group = _volume_group_for_muscle(str(ex.get("muscle") or ""))
            totals[group] = totals.get(group, 0) + int(ex.get("sets") or 0)
    return totals


def _exercise_matches_volume_group(ex: dict[str, Any], group: str) -> bool:
    return _volume_group_for_muscle(str(ex.get("muscle") or "")) == group


def rebalance_week_volume(week_days: list[dict[str, Any]], ctx: WorkoutEngineContext) -> None:
    """Adjust weekly working sets per muscle group toward goal-appropriate ACSM ranges."""
    training_days = [d for d in week_days if not d.get("is_rest_day")]
    if not training_days:
        return

    goal = normalize_goal(ctx.goal_type)
    low, high = GOAL_VOLUME_TARGETS.get(goal, GOAL_VOLUME_TARGETS["muscle_gain"])
    over_cap = high + VOLUME_OVER_CAP_BUFFER
    focus_groups = {_volume_group_for_muscle(m) for m in ctx.focus_muscles}

    def all_exercises() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for day in training_days:
            for ex in day.get("exercises") or []:
                if isinstance(ex, dict):
                    out.append(ex)
        return out

    totals = _weekly_muscle_sets(training_days)

    for group, total in list(totals.items()):
        if group == "Other":
            continue
        priority = group in focus_groups

        while total < low:
            candidates = [
                ex
                for ex in all_exercises()
                if _exercise_matches_volume_group(ex, group)
                and int(ex.get("sets") or 0) < VOLUME_REBALANCE_MAX_SETS_PER_EXERCISE
            ]
            if not candidates:
                break
            candidates.sort(
                key=lambda ex: (
                    0 if priority else 1,
                    int(ex.get("sets") or 0),
                )
            )
            pick = candidates[0]
            pick["sets"] = int(pick.get("sets") or 0) + 1
            total += 1

        while total > over_cap:
            candidates = [
                ex
                for ex in all_exercises()
                if _exercise_matches_volume_group(ex, group) and int(ex.get("sets") or 0) > 2
            ]
            if not candidates:
                break
            candidates.sort(key=lambda ex: (-int(ex.get("sets") or 0), str(ex.get("name") or "")))
            pick = candidates[-1]
            pick["sets"] = int(pick.get("sets") or 0) - 1
            total -= 1

    for day in training_days:
        exercises = day.get("exercises")
        if isinstance(exercises, list) and exercises:
            day["estimated_duration_min"] = _estimate_duration(exercises)


def _estimate_duration(exercises: list[dict[str, Any]]) -> int:
    total_sec = 0
    for ex in exercises:
        sets = int(ex.get("sets") or 0)
        rest = int(ex.get("rest_seconds") or 60)
        total_sec += sets * (WORK_SECONDS_PER_SET + rest)
    return max(1, round(total_sec / 60))


def _required_patterns(problem_areas: list[str]) -> list[str]:
    patterns: list[str] = []
    for area in problem_areas:
        key = str(area).strip().lower().replace(" ", "_")
        for rule_key, pats in PROBLEM_AREA_PATTERNS.items():
            if rule_key in key or key in rule_key:
                patterns.extend(pats)
    return list(dict.fromkeys(patterns))


def build_training_day(
    db: Session,
    ctx: WorkoutEngineContext,
    *,
    day: int,
    month: int,
    year: int,
    split_key: str,
    recent_exercise_ids: list[int],
    exclude_ids: set[int],
    catalog: list[CatalogExercise],
) -> dict[str, Any]:
    target_muscles = _split_target_muscles(split_key, ctx.focus_muscles)
    difficulty = normalize_difficulty(ctx.difficulty)
    required = _required_patterns(ctx.problem_areas)

    equipment_access = normalize_equipment_access(ctx.equipment_access)
    pool = _filter_pool(
        catalog,
        target_muscles=target_muscles,
        difficulty=difficulty,
        equipment_access=equipment_access,
        exclude_ids=exclude_ids,
        required_patterns=required,
    )
    if len(pool) < ctx.exercises_per_session:
        pool = _filter_pool(
            catalog,
            target_muscles=target_muscles,
            difficulty=difficulty,
            equipment_access=equipment_access,
            exclude_ids=set(),
            required_patterns=[],
        )
    if len(pool) < ctx.exercises_per_session:
        raise RuntimeError(
            f"Insufficient catalog pool for split={split_key} muscles={target_muscles} "
            f"(need {ctx.exercises_per_session}, have {len(pool)})"
        )

    rng = _rng(ctx.user_id, month, year, day, split_key, ctx.regen_version)
    weights = [_recency_weight(ex.id, recent_exercise_ids) for ex in pool]
    sample = _weighted_sample(rng, pool, weights, CANDIDATE_SAMPLE)

    compounds = sorted([ex for ex in sample if ex.is_compound], key=lambda e: e.name)
    isolations = sorted([ex for ex in sample if not ex.is_compound], key=lambda e: e.name)

    need_compounds = max(1, ctx.exercises_per_session // 2)
    selected_compounds = compounds[:need_compounds]
    remaining = ctx.exercises_per_session - len(selected_compounds)
    selected_isolations = isolations[:remaining]

    if len(selected_compounds) + len(selected_isolations) < ctx.exercises_per_session:
        leftovers = [ex for ex in sample if ex not in selected_compounds and ex not in selected_isolations]
        for ex in leftovers:
            if len(selected_compounds) + len(selected_isolations) >= ctx.exercises_per_session:
                break
            if ex.is_compound:
                selected_compounds.append(ex)
            else:
                selected_isolations.append(ex)

    extra_sets = 0
    if ctx.focus_muscles:
        extra_sets = 1

    role_assignments = _assign_roles(
        ctx.exercises_per_session,
        selected_compounds,
        selected_isolations,
    )

    exercises: list[dict[str, Any]] = []
    focus_set: set[str] = {m.lower() for m in ctx.focus_muscles}
    for ex, role in role_assignments:
        bonus = 1 if any(_muscle_matches(ex, fm) for fm in ctx.focus_muscles) and focus_set else 0
        exercises.append(
            _prescribe_exercise(db, ctx, ex, role, rng, extra_sets=bonus if role != "isolation" else 0)
        )

    focus_muscles_out = list(dict.fromkeys(target_muscles))
    return {
        "day": day,
        "is_rest_day": False,
        "split_name": split_display_name(split_key),
        "split_key": split_key,
        "focus_muscles": focus_muscles_out,
        "exercises": exercises,
        "estimated_duration_min": _estimate_duration(exercises),
        "engine": "v3",
    }


def build_rest_day(day: int) -> dict[str, Any]:
    return {
        "day": day,
        "is_rest_day": True,
        "split_name": split_display_name("rest"),
        "split_key": "rest",
        "focus_muscles": [],
        "exercises": [],
        "estimated_duration_min": 0,
        "engine": "v3",
    }


def generate_month_days(
    db: Session,
    ctx: WorkoutEngineContext,
    *,
    month: int,
    year: int,
    days: list[int],
    continue_from_split_key: str | None = None,
    prior_recent_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    catalog = load_catalog(db)
    if not catalog:
        raise RuntimeError("global_exercises catalog is empty")

    pattern = week_pattern(ctx.workouts_per_week)
    pattern = rotate_pattern(pattern, continue_from_split_key=continue_from_split_key)

    recent_ids = list(prior_recent_ids or [])
    used_today: set[int] = set()
    out: list[dict[str, Any]] = []
    current_week: list[dict[str, Any]] = []

    for day in days:
        week_number = ((day - 1) // 7) + 1
        day_ctx = WorkoutEngineContext(
            **{**ctx.__dict__, "week_number": week_number},
        )
        pattern_idx = (day - 1) % 7
        split_key, is_rest, _ = pattern[pattern_idx]

        if is_rest:
            day_data = build_rest_day(day)
            out.append(day_data)
            current_week.append(day_data)
            if day % 7 == 0 or day == days[-1]:
                rebalance_week_volume(current_week, ctx)
                current_week = []
            continue

        exclude = set(used_today)
        if recent_ids:
            exclude.add(recent_ids[-1])

        day_data = build_training_day(
            db,
            day_ctx,
            day=day,
            month=month,
            year=year,
            split_key=split_key,
            recent_exercise_ids=recent_ids,
            exclude_ids=exclude,
            catalog=catalog,
        )
        for ex in day_data["exercises"]:
            eid = ex.get("exercise_id")
            if eid:
                recent_ids.append(int(eid))
                if len(recent_ids) > 30:
                    recent_ids = recent_ids[-30:]
        used_today = {int(ex["exercise_id"]) for ex in day_data["exercises"] if ex.get("exercise_id")}
        out.append(day_data)
        current_week.append(day_data)
        if day % 7 == 0 or day == days[-1]:
            rebalance_week_volume(current_week, ctx)
            current_week = []

    return out


def regenerate_single_day(
    db: Session,
    ctx: WorkoutEngineContext,
    *,
    month: int,
    year: int,
    day: int,
    exclude_exercise_ids: set[int] | None = None,
    recent_exercise_ids: list[int] | None = None,
) -> dict[str, Any]:
    catalog = load_catalog(db)
    pattern = week_pattern(ctx.workouts_per_week)
    pattern_idx = (day - 1) % 7
    split_key, is_rest, _ = pattern[pattern_idx]
    if is_rest:
        raise ValueError("Cannot regenerate a rest day")

    bumped_ctx = WorkoutEngineContext(**{**ctx.__dict__, "regen_version": ctx.regen_version + 1})
    exclude = set(exclude_exercise_ids or set())
    return build_training_day(
        db,
        bumped_ctx,
        day=day,
        month=month,
        year=year,
        split_key=split_key,
        recent_exercise_ids=list(recent_exercise_ids or []),
        exclude_ids=exclude,
        catalog=catalog,
    )


def swap_exercise_in_day(
    db: Session,
    ctx: WorkoutEngineContext,
    *,
    month: int,
    year: int,
    day: int,
    original_exercise: dict[str, Any],
    other_names: list[str],
    recent_exercise_ids: list[int] | None = None,
) -> dict[str, Any]:
    catalog = load_catalog(db)
    muscle = str(original_exercise.get("muscle") or "Chest")
    difficulty = normalize_difficulty(ctx.difficulty)
    exclude_names = {n.lower() for n in other_names if n}
    exclude_ids = {
        ex.id
        for ex in catalog
        if ex.name.lower() in exclude_names or ex.name.lower() == str(original_exercise.get("name", "")).lower()
    }

    pool = _filter_pool(
        catalog,
        target_muscles=[muscle],
        difficulty=difficulty,
        equipment_access=normalize_equipment_access(ctx.equipment_access),
        exclude_ids=exclude_ids,
        required_patterns=[],
    )
    if not pool:
        raise RuntimeError(f"No swap candidates for muscle={muscle}")

    rng = _rng(ctx.user_id, month, year, day, f"swap_{muscle}", ctx.regen_version + 1)
    weights = [_recency_weight(ex.id, list(recent_exercise_ids or [])) for ex in pool]
    picked = _weighted_sample(rng, pool, weights, 1)
    if not picked:
        raise RuntimeError("Swap selection failed")

    ex = picked[0]
    role: ExerciseRole = "secondary_compound" if ex.is_compound else "isolation"
    return _prescribe_exercise(db, ctx, ex, role, rng)
