"""Calorie Log's authoritative daily-target calculation, shared with Meal Planner.

Calorie Log display is a hybrid of two formulas (confirmed in code, not approximated):

1) **kcal** — `computeUserCaloriePlan` (mobile/src/utils/calorieEngine.js):
   Mifflin–St Jeor BMR × activity multiplier + goal/pace daily kcal adjustment.
   Varies by goal_tag (Fat Loss / Muscle Gain / Strength) AND goal_pace (slow/moderate/fast).

2) **protein / carbs / fat / fibre / water** — `resolve_user_targets` in calories.py:
   - Keeps stored calorie/fibre/water from user_calorie_targets or onboarding targets_json
   - Recomputes macros via `calculate_macro_targets`:
       protein_g = body_weight_kg × goal factor (weight_loss 2.2, muscle_gain 2.0,
       maintenance 1.6, default 1.8), capped at 35% of *stored* target calories
       remaining calories → 60% carbs / 40% fat
   - So macros *do* vary by goal (via g/kg protein factor), but are NOT a fixed P/C/F %
     split like meal-engine v3's GOAL_SPLITS.

Meal Planner calls `get_calorie_log_targets` so both screens share this same logic.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from sqlalchemy.orm import Session

from src.models.models import User, UserOnboarding
from src.models.weight_log import WeightLog

ActivityLevel = Literal["sedentary", "light", "moderate", "active", "very_active"]
GoalTag = Literal["Fat Loss", "Muscle Gain", "Strength"]
GoalPace = Literal["slow", "moderate", "fast"]

ACTIVITY_MULTIPLIER: dict[str, float] = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

GOAL_PACE_MAP: dict[str, dict[str, dict[str, float]]] = {
    "Fat Loss": {
        "slow": {"weeklyKg": 0.25, "dailyKcal": -275},
        "moderate": {"weeklyKg": 0.5, "dailyKcal": -550},
        "fast": {"weeklyKg": 0.75, "dailyKcal": -825},
    },
    "Muscle Gain": {
        "slow": {"weeklyKg": 0.125, "dailyKcal": 137},
        "moderate": {"weeklyKg": 0.25, "dailyKcal": 275},
        "fast": {"weeklyKg": 0.5, "dailyKcal": 550},
    },
    "Strength": {
        "slow": {"weeklyKg": 0.125, "dailyKcal": 110},
        "moderate": {"weeklyKg": 0.2, "dailyKcal": 220},
        "fast": {"weeklyKg": 0.375, "dailyKcal": 412},
    },
}


def _safe_number(value: Any, fallback: float = 0.0) -> float:
    try:
        n = float(value)
        return n if n == n and n not in (float("inf"), float("-inf")) else fallback
    except (TypeError, ValueError):
        return fallback


def normalize_goal_tag(goal_tag: str | None) -> GoalTag:
    if goal_tag in ("Fat Loss", "Muscle Gain", "Strength"):
        return goal_tag  # type: ignore[return-value]
    return "Fat Loss"


def normalize_goal_pace(goal_pace: str | None) -> GoalPace:
    if goal_pace in ("slow", "moderate", "fast"):
        return goal_pace  # type: ignore[return-value]
    return "moderate"


def normalize_activity_level(level: str | None) -> ActivityLevel:
    if level in ("sedentary", "light", "moderate", "active", "very_active"):
        return level  # type: ignore[return-value]
    return "moderate"


def compute_user_calorie_plan(
    *,
    gender: str,
    age: float,
    height_cm: float,
    current_weight_kg: float,
    target_weight_kg: float,
    goal_tag: str,
    goal_pace: str,
    activity_level: str,
) -> dict[str, float | int]:
    """Python port of mobile/src/utils/calorieEngine.js `computeUserCaloriePlan`."""
    age_n = _safe_number(age, 25)
    height_n = _safe_number(height_cm, 170)
    weight_n = _safe_number(current_weight_kg, 70)
    target_n = _safe_number(target_weight_kg, weight_n)
    tag = normalize_goal_tag(goal_tag)
    pace = normalize_goal_pace(goal_pace)
    activity = normalize_activity_level(activity_level)

    if str(gender).lower() == "male":
        bmr = 10 * weight_n + 6.25 * height_n - 5 * age_n + 5
    else:
        bmr = 10 * weight_n + 6.25 * height_n - 5 * age_n - 161

    multiplier = ACTIVITY_MULTIPLIER[activity]
    tdee = round(bmr * multiplier)
    pace_config = GOAL_PACE_MAP[tag][pace]
    daily_adjustment = pace_config["dailyKcal"]
    daily_calorie_target = round(tdee + daily_adjustment)
    weight_delta_kg = abs(weight_n - target_n)
    weekly_kg = pace_config["weeklyKg"]
    weeks_to_goal = int(weight_delta_kg / weekly_kg) if weekly_kg > 0 else 0
    if weekly_kg > 0 and weeks_to_goal * weekly_kg < weight_delta_kg:
        weeks_to_goal += 1

    return {
        "bmr": int(round(bmr)),
        "tdee": int(tdee),
        "dailyAdjustment": float(daily_adjustment),
        "dailyCalorieTarget": int(daily_calorie_target),
        "weeklyTargetKg": float(weekly_kg),
        "weeksToGoal": int(weeks_to_goal),
    }


def burn_profile_from_onboarding(
    onboarding: dict[str, Any] | None,
    *,
    weight_kg_override: float | None = None,
) -> dict[str, Any] | None:
    """Match CalorieLog.tsx `toBurnProfile` mapping."""
    if not isinstance(onboarding, dict):
        return None
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}

    name = str(personal.get("name") or "").strip()
    age = _safe_number(personal.get("age"), 0)
    height_cm = _safe_number(personal.get("height_cm"), 0)
    weight_kg = _safe_number(
        weight_kg_override if weight_kg_override is not None else personal.get("weight_kg"),
        0,
    )
    target_kg = _safe_number(goal.get("target_weight_kg") or personal.get("weight_kg"), weight_kg)
    if not name or age <= 0 or height_cm <= 0 or weight_kg <= 0:
        return None

    goal_type_map = {
        "fat_loss": "Fat Loss",
        "muscle_gain": "Muscle Gain",
        "strength": "Strength",
    }
    pace_map = {
        "slow": "slow",
        "moderate": "moderate",
        "aggressive": "fast",
        "fast": "fast",
    }
    activity_map = {
        "sedentary": "sedentary",
        "lightly_active": "light",
        "light": "light",
        "moderate": "moderate",
        "moderately_active": "moderate",
        "very_active": "active",
        "extremely_active": "very_active",
        "active": "active",
    }
    goal_type = goal_type_map.get(str(goal.get("type") or "").lower(), "Fat Loss")
    goal_pace = pace_map.get(str(goal.get("pace") or "").lower(), "moderate")
    activity_level = activity_map.get(str(activity.get("level") or "").lower(), "moderate")

    return {
        "name": name,
        "gender": "male" if personal.get("sex") == "male" else "female",
        "age": age,
        "height_cm": height_cm,
        "current_weight_kg": weight_kg,
        "target_weight_kg": target_kg,
        "goal_tag": goal_type,
        "goal_pace": goal_pace,
        "activity_level": activity_level,
    }


def _latest_weight_kg(db: Session, user_id: int) -> float | None:
    try:
        row = (
            db.query(WeightLog)
            .filter(WeightLog.user_id == user_id)
            .order_by(WeightLog.logged_at.desc(), WeightLog.id.desc())
            .first()
        )
        if row is None:
            return None
        kg = _safe_number(getattr(row, "weight_kg", None), 0)
        return kg if kg > 0 else None
    except Exception:
        db.rollback()
        return None


def get_calorie_log_targets(db: Session, user: User) -> dict[str, Any]:
    """Same numbers Calorie Log shows: Mifflin kcal + resolve_user_targets macros/fibre/water."""
    from src.routes.calories import resolve_user_targets

    resolved = resolve_user_targets(db, user)
    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    onboarding = ob.onboarding_json if ob and isinstance(ob.onboarding_json, dict) else None
    latest_kg = _latest_weight_kg(db, int(user.id))
    profile = burn_profile_from_onboarding(onboarding, weight_kg_override=latest_kg)

    if profile is not None:
        plan = compute_user_calorie_plan(
            gender=str(profile["gender"]),
            age=float(profile["age"]),
            height_cm=float(profile["height_cm"]),
            current_weight_kg=float(profile["current_weight_kg"]),
            target_weight_kg=float(profile["target_weight_kg"]),
            goal_tag=str(profile["goal_tag"]),
            goal_pace=str(profile["goal_pace"]),
            activity_level=str(profile["activity_level"]),
        )
        display_kcal = int(plan["dailyCalorieTarget"])
    else:
        display_kcal = int(resolved.get("target_calories") or 2100)

    return {
        "target_calories": display_kcal,
        "target_protein_g": int(float(resolved["target_protein_g"])),
        "target_carbs_g": int(float(resolved["target_carbs_g"])),
        "target_fat_g": int(float(resolved["target_fat_g"])),
        "target_fiber_g": int(float(resolved["target_fiber_g"])),
        "target_water_l": float(Decimal(str(resolved["target_water_l"]))),
        "protein_pct": int(resolved.get("protein_pct") or 0),
        "carbs_pct": int(resolved.get("carbs_pct") or 0),
        "fat_pct": int(resolved.get("fat_pct") or 0),
        "source": "calorie_log",
    }
