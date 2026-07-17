"""Calorie Log target formula ported into Meal Planner."""

from __future__ import annotations

from src.services.calorie_log_targets import compute_user_calorie_plan
from src.routes.calories import calculate_macro_targets, _normalize_goal


def test_mifflin_matches_js_engine_shape():
    plan = compute_user_calorie_plan(
        gender="male",
        age=28,
        height_cm=175,
        current_weight_kg=80,
        target_weight_kg=75,
        goal_tag="Fat Loss",
        goal_pace="moderate",
        activity_level="moderate",
    )
    # BMR = 10*80 + 6.25*175 - 5*28 + 5 = 800 + 1093.75 - 140 + 5 = 1758.75
    assert plan["bmr"] == 1759
    assert plan["tdee"] == round(1758.75 * 1.55) or plan["tdee"] == round(plan["bmr"] * 1.55)
    assert plan["dailyAdjustment"] == -550
    assert plan["dailyCalorieTarget"] == int(plan["tdee"]) - 550


def test_macro_targets_vary_by_goal_via_protein_per_kg():
    """Calorie Log macros: protein g/kg changes with goal; remainder is 60/40 carbs/fat."""
    kcal = 3367
    weight = 75.0
    loss = calculate_macro_targets(kcal, weight, "fat_loss")
    gain = calculate_macro_targets(kcal, weight, "muscle_gain")
    maint = calculate_macro_targets(kcal, weight, "maintain")

    assert _normalize_goal("fat_loss") == "weight_loss"
    # weight_loss 2.2 g/kg → higher protein than maintenance 1.6
    assert loss["target_protein_g"] > maint["target_protein_g"]
    assert gain["target_protein_g"] != maint["target_protein_g"]
    # Not a fixed % split — protein share is bodyweight-driven (then capped at 35%).
    assert loss["protein_pct"] <= 35
    # Remaining calories after protein → 60% carbs / 40% fat of remainder.
    p_cal = loss["target_protein_g"] * 4
    rem = kcal - p_cal
    assert abs(loss["target_carbs_g"] * 4 - rem * 0.60) <= 4
    assert abs(loss["target_fat_g"] * 9 - rem * 0.40) <= 9


def test_low_protein_relative_to_v3_goal_splits_is_expected():
    """Flagged behavioral change: Calorie Log protein << v3 maintain 30% split."""
    from src.services import meal_engine_v3 as v3

    kcal = 3367
    weight = 75.0
    cl = calculate_macro_targets(kcal, weight, "maintain")
    v3_maintain = v3.daily_targets(3005, "maintain")
    assert cl["target_protein_g"] < 150
    assert int(round(v3_maintain.protein)) >= 200
