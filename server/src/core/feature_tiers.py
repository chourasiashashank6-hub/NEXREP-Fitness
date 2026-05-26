"""
Single source of truth for which plan is required per feature.
Import this everywhere plan checks are needed.
"""

# Feature key → minimum plan required
# "free"  = available to all users
# "pro"   = requires pro or elite
# "elite" = requires elite only
FEATURE_TIERS: dict[str, str] = {
    # ── Cloud AI features ──────────────────────────────────────────
    "food_photo_analysis": "pro",
    "calorie_coach": "pro",
    "workout_coach": "pro",
    "meal_plan_generation": "elite",
    "meal_day_regen": "elite",
    "meal_swap": "elite",
    "protein_suggestions": "elite",
    "workout_plan_generation": "elite",
    "workout_swap": "elite",
    "meal_regen_remaining": "elite",
    "workout_regen_remaining": "elite",
    # ── On-device AI ───────────────────────────────────────────────
    # MediaPipe pose guidance and rep counter run on-device.
    # Access is checked client-side only (no server endpoint needed).
    "mediapipe_pose_guidance": "pro",
    "ai_rep_counter": "pro",
    # ── Free tier features (listed for completeness) ───────────────
    "workout_logging": "free",
    "calorie_logging": "free",
    "weight_logging": "free",
    "water_logging": "free",
    "basic_nutrition": "free",
}


def get_required_plan(feature: str) -> str:
    """Return the minimum plan string for a feature. Defaults to 'elite'
    (most restrictive) if the feature key is unknown."""
    return FEATURE_TIERS.get(feature, "elite")
