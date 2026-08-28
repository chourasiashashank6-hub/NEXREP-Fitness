"""Tests for deterministic health-tip selection."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from src.services.health_tips_service import (
    NutritionContext,
    _tip_excluded_for_onboarding_diet,
    _tip_matches_diet,
    _tip_matches_goal,
    _tip_matches_triggers,
    compute_active_triggers,
    load_tip_library,
    select_health_tips,
    user_diet_tag,
    user_goal_tag,
)


def test_user_diet_tag_mapping():
    assert user_diet_tag("vegan") == "vegan"
    assert user_diet_tag("vegetarian") == "veg"
    assert user_diet_tag("jain") == "veg"
    assert user_diet_tag("keto") == "non_veg"
    assert user_diet_tag("standard") == "non_veg"


def test_user_goal_tag_mapping():
    assert user_goal_tag("fat_loss") == "fat_loss"
    assert user_goal_tag("muscle_gain") == "muscle_gain"
    assert user_goal_tag("strength") == "strength"
    assert user_goal_tag("unknown") == "maintain"


def test_vegan_never_matches_non_veg_only_tip():
    assert not _tip_matches_diet(["non_veg"], "vegan")
    assert _tip_matches_diet(["vegan"], "vegan")
    assert _tip_matches_diet(["all"], "vegan")


def test_fat_loss_never_matches_muscle_gain_only_tip():
    assert not _tip_matches_goal(["muscle_gain"], "fat_loss")
    assert _tip_matches_goal(["all"], "fat_loss")


def test_evergreen_tip_matches_without_triggers():
    assert _tip_matches_triggers([], {"protein_gap"})
    assert not _tip_matches_triggers(["protein_gap"], set())


def test_compute_protein_severe_gap_trigger():
    ctx = NutritionContext(
        diet_type="veg",
        onboarding_diet="vegetarian",
        goal="fat_loss",
        meals_per_day=3,
        meals_logged=2,
        calories_eaten=900,
        calorie_target=2000,
        protein_eaten=30,
        protein_target=150,
        fiber_eaten=10,
        fiber_target=30,
        fat_eaten=20,
        fat_target=70,
        water_ml=1000,
        water_target_ml=2500,
        high_carb_meal=False,
        late_first_meal=False,
        logged_food_items=(),
    )
    triggers = compute_active_triggers(ctx, now=datetime(2026, 8, 28, 18, 0))
    assert "protein_severe_gap" in triggers
    assert "protein_gap" in triggers


def test_compute_on_track_trigger():
    ctx = NutritionContext(
        diet_type="non_veg",
        onboarding_diet="standard",
        goal="maintain",
        meals_per_day=3,
        meals_logged=3,
        calories_eaten=2000,
        calorie_target=2100,
        protein_eaten=120,
        protein_target=150,
        fiber_eaten=25,
        fiber_target=30,
        fat_eaten=65,
        fat_target=70,
        water_ml=2200,
        water_target_ml=2500,
        high_carb_meal=False,
        late_first_meal=False,
        logged_food_items=("rice",),
    )
    triggers = compute_active_triggers(ctx, now=datetime(2026, 8, 28, 14, 0))
    assert "on_track" in triggers


def test_library_has_no_legacy_inaccurate_copy():
  tips = {t["id"]: t for t in load_tip_library()}
  bodies = " ".join(str(t.get("body", "")) for t in tips.values()).lower()
  assert "cortisol" not in bodies
  assert "20–30 times" not in bodies and "20-30 times" not in bodies
  assert "prot_006" in tips
  assert "hab_004" in tips


def test_select_health_tips_fail_open_without_db():
    user = MagicMock()
    user.id = 1
    db = MagicMock()
    with patch("src.services.health_tips_service.build_nutrition_context", side_effect=RuntimeError("boom")):
        tips = select_health_tips(db, user)
    assert len(tips) == 4
    assert all(t["title"] and t["body"] for t in tips)


def test_vegan_selection_excludes_chicken_tip():
    user = MagicMock()
    user.id = 99
    db = MagicMock()
    ctx = NutritionContext(
        diet_type="vegan",
        onboarding_diet="vegan",
        goal="fat_loss",
        meals_per_day=3,
        meals_logged=0,
        calories_eaten=0,
        calorie_target=2000,
        protein_eaten=0,
        protein_target=150,
        fiber_eaten=0,
        fiber_target=30,
        fat_eaten=0,
        fat_target=70,
        water_ml=0,
        water_target_ml=2500,
        high_carb_meal=False,
        late_first_meal=False,
        logged_food_items=(),
    )
    with patch("src.services.health_tips_service.build_nutrition_context", return_value=ctx), patch(
        "src.services.health_tips_service._record_shown_tips"
    ):
        tips = select_health_tips(db, user)
    ids = {t["id"] for t in tips}
    assert "prot_012" not in ids
    assert "prot_003" not in ids


def test_keto_user_excludes_carb_and_grain_tips():
    tips = {t["id"]: t for t in load_tip_library()}
    assert _tip_excluded_for_onboarding_diet(tips["crb_004"], "keto")
    assert _tip_excluded_for_onboarding_diet(tips["prot_001"], "keto")
    assert not _tip_excluded_for_onboarding_diet(tips["prot_012"], "keto")

    user = MagicMock()
    user.id = 100
    db = MagicMock()
    ctx = NutritionContext(
        diet_type="non_veg",
        onboarding_diet="keto",
        goal="fat_loss",
        meals_per_day=3,
        meals_logged=0,
        calories_eaten=0,
        calorie_target=2000,
        protein_eaten=0,
        protein_target=150,
        fiber_eaten=0,
        fiber_target=30,
        fat_eaten=0,
        fat_target=70,
        water_ml=0,
        water_target_ml=2500,
        high_carb_meal=False,
        late_first_meal=False,
        logged_food_items=(),
    )
    with patch("src.services.health_tips_service.build_nutrition_context", return_value=ctx), patch(
        "src.services.health_tips_service._record_shown_tips"
    ):
        selected = select_health_tips(db, user)
    ids = {t["id"] for t in selected}
    assert "crb_004" not in ids
    assert "prot_001" not in ids
    assert "fib_003" not in ids


def test_excluded_diets_field_is_optional():
    tips = {t["id"]: t for t in load_tip_library()}
    assert not _tip_excluded_for_onboarding_diet(tips["hab_006"], "standard")
    assert not _tip_excluded_for_onboarding_diet(tips["hab_006"], "vegetarian")
