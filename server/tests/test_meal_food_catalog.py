"""Tests for catalog-backed meal planner — units, composition, region, supplements."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

from src.services.meal_food_catalog import (
    MAX_UNITS_PER_FOOD,
    MIN_POOL_SIZE,
    build_item_from_units,
    clamp_units,
    enforce_meal_composition,
    fetch_food_candidate_pool,
    is_composite_food_name,
    meal_composition_ok,
    resolve_catalog_region,
    resolve_raw_item,
    scale_item_units,
)


CHA = {
    "food_id": 383,
    "food_name": "Masala chai (with milk, sugar)",
    "unit_label": "small cup",
    "unit_grams": 150.0,
    "kcal_per_unit": 82.5,
    "protein_per_unit": 3.0,
    "carbs_per_unit": 12.0,
    "fat_per_unit": 2.25,
    "region": "pan_indian",
}

DAL = {
    "food_id": 75,
    "food_name": "Dal tadka",
    "unit_label": "medium bowl",
    "unit_grams": 150.0,
    "kcal_per_unit": 180.0,
    "protein_per_unit": 12.0,
    "carbs_per_unit": 28.0,
    "fat_per_unit": 4.0,
    "region": "pan_indian",
}

RICE = {
    "food_id": 3,
    "food_name": "Brown rice (cooked)",
    "unit_label": "medium bowl, cooked",
    "unit_grams": 150.0,
    "kcal_per_unit": 166.5,
    "protein_per_unit": 3.9,
    "carbs_per_unit": 34.5,
    "fat_per_unit": 1.35,
    "region": "pan_indian",
}

SABZI = {
    "food_id": 50,
    "food_name": "Mixed vegetable curry",
    "unit_label": "medium bowl",
    "unit_grams": 150.0,
    "kcal_per_unit": 135.0,
    "protein_per_unit": 4.5,
    "carbs_per_unit": 18.0,
    "fat_per_unit": 5.25,
    "region": "pan_indian",
}


def test_build_item_from_units_computes_grams_and_macros():
    item = build_item_from_units(CHA, 1)
    assert item["food_id"] == 383
    assert item["units"] == 1.0
    assert item["quantity_g"] == 150
    assert item["calories"] == 82
    assert item["region"] == "pan_indian"


def test_clamp_units_hard_cap_at_two():
    assert clamp_units(5, CHA) == MAX_UNITS_PER_FOOD
    assert clamp_units(99, DAL) == MAX_UNITS_PER_FOOD


def test_resolve_rejects_unknown_food_id():
    food_by_id = {383: CHA}
    assert resolve_raw_item({"food_id": 99999, "units": 1}, food_by_id) is None


def test_resolve_caps_units_above_two():
    item = resolve_raw_item({"food_id": 75, "units": 5}, {75: DAL})
    assert item is not None
    assert item["units"] <= MAX_UNITS_PER_FOOD


def test_scale_item_units_never_exceeds_max():
    item = build_item_from_units(CHA, 1)
    scale_item_units(item, 5.0)
    assert item["units"] <= MAX_UNITS_PER_FOOD


def test_single_item_meal_fails_composition():
    ok, reason = meal_composition_ok([build_item_from_units(DAL, 2)])
    assert ok is False
    assert reason and "fewer than 2" in reason


def test_enforce_repairs_single_item_and_dominance():
    food_by_id = {75: DAL, 3: RICE, 50: SABZI, 383: CHA}
    meal = {"meal_type": "Dinner", "items": [build_item_from_units(DAL, 5)]}
    enforce_meal_composition(meal, food_by_id, meal_kcal_target=700)
    ok, reason = meal_composition_ok(meal["items"])
    assert ok, reason
    assert len(meal["items"]) >= 2
    assert all(float(i["units"]) <= MAX_UNITS_PER_FOOD for i in meal["items"])


def test_resolve_catalog_region_from_styles():
    assert resolve_catalog_region(["no_preference"]) == "pan_indian"
    assert resolve_catalog_region(["south_indian"]) == "south_indian"
    assert resolve_catalog_region(["punjabi", "gujarati"], day=0) == "punjabi"
    assert resolve_catalog_region(["punjabi", "gujarati"], day=1) == "gujarati"


def test_composite_denylist():
    assert is_composite_food_name("Dal baati churma")
    assert not is_composite_food_name("Dal tadka")


def test_thin_pool_progressive_fallback_logs_warning(caplog):
    preferred = [
        {
            "food_id": i,
            "food_name": f"f{i}",
            "unit_label": "serving",
            "unit_grams": 100,
            "kcal_per_unit": 100,
            "protein_per_unit": 5,
            "carbs_per_unit": 10,
            "fat_per_unit": 2,
            "is_vegetarian": True,
            "is_vegan": False,
            "region": "south_indian",
        }
        for i in range(1, 6)
    ]
    broader = preferred + [
        {
            "food_id": i,
            "food_name": f"f{i}",
            "unit_label": "serving",
            "unit_grams": 100,
            "kcal_per_unit": 100,
            "protein_per_unit": 5,
            "carbs_per_unit": 10,
            "fat_per_unit": 2,
            "is_vegetarian": True,
            "is_vegan": False,
            "region": "south_indian",
        }
        for i in range(6, 16)
    ]
    db = MagicMock()
    with patch("src.services.meal_food_catalog._query_candidates", side_effect=[preferred, broader]):
        with caplog.at_level(logging.INFO):
            pool = fetch_food_candidate_pool(db, diet_type="vegetarian", region="south_indian", limit=100)
        assert len(pool) >= MIN_POOL_SIZE
        assert any("thin preferred pool" in r.message for r in caplog.records)


def test_under_target_after_cap_logs_warning(caplog):
    food_by_id = {75: DAL, 3: RICE}
    meal = {"meal_type": "Lunch", "items": [build_item_from_units(DAL, 1)]}
    with caplog.at_level(logging.WARNING):
        enforce_meal_composition(meal, food_by_id, meal_kcal_target=900)
    assert any("still under calorie target after unit cap" in r.message for r in caplog.records)
