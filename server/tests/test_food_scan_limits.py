"""Tests for food photo scan rate limits."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.models.models import User
from src.services.food_scan_limits import (
    FREE_DAILY_CAP,
    build_scan_usage,
    enforce_food_scan_limits,
    normalize_tier,
    per_meal_cap,
)


def test_normalize_tier_defaults_unknown_to_free():
    assert normalize_tier(None) == "free"
    assert normalize_tier("pro") == "pro"
    assert normalize_tier("ELITE") == "elite"
    assert normalize_tier("trial") == "free"


def test_per_meal_cap_by_tier():
    assert per_meal_cap("free") == FREE_DAILY_CAP
    assert per_meal_cap("pro") == 2
    assert per_meal_cap("elite") == 3


def test_enforce_free_blocks_fifth_daily_scan():
    user = User(id=1, plan_id="free", email="x@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=FREE_DAILY_CAP,
    ), patch("src.services.food_scan_limits.meals_per_day_for_user", return_value=3):
        with pytest.raises(HTTPException) as exc:
            enforce_food_scan_limits(db=MagicMock(), user=user, meal_type=None)
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["limit_type"] == "daily"
    assert detail["tier"] == "free"
    assert detail["cap"] == FREE_DAILY_CAP


def test_enforce_free_allows_under_cap():
    user = User(id=1, plan_id="free", email="x@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=FREE_DAILY_CAP - 1,
    ):
        enforce_food_scan_limits(db=MagicMock(), user=user, meal_type=None)


def test_enforce_pro_without_meal_type_uses_legacy_daily_cap():
    """STOPGAP: old APKs omit meal_type — flat daily cap (Pro=2), not 422."""
    user = User(id=2, plan_id="pro", email="y@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=1,
    ):
        enforce_food_scan_limits(db=MagicMock(), user=user, meal_type=None)


def test_enforce_pro_without_meal_type_blocks_at_legacy_daily_cap():
    user = User(id=2, plan_id="pro", email="y@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=2,
    ), patch("src.services.food_scan_limits.meals_per_day_for_user", return_value=3):
        with pytest.raises(HTTPException) as exc:
            enforce_food_scan_limits(db=MagicMock(), user=user, meal_type=None)
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["limit_type"] == "daily"
    assert detail["tier"] == "pro"
    assert detail["cap"] == 2
    assert detail["meal_type"] is None


def test_enforce_elite_without_meal_type_blocks_at_legacy_daily_cap():
    user = User(id=5, plan_id="elite", email="e@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=3,
    ), patch("src.services.food_scan_limits.meals_per_day_for_user", return_value=3):
        with pytest.raises(HTTPException) as exc:
            enforce_food_scan_limits(db=MagicMock(), user=user, meal_type="")
    assert exc.value.status_code == 429
    assert exc.value.detail["cap"] == 3


def test_enforce_pro_blocks_third_scan_in_meal_slot():
    user = User(id=3, plan_id="pro", email="z@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=0), patch(
        "src.services.food_scan_limits._count_scans",
        return_value=2,
    ), patch("src.services.food_scan_limits.meals_per_day_for_user", return_value=4):
        with pytest.raises(HTTPException) as exc:
            enforce_food_scan_limits(db=MagicMock(), user=user, meal_type="Lunch")
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["limit_type"] == "meal_slot"
    assert detail["meal_type"] == "Lunch"
    assert detail["cap"] == 2


def test_build_scan_usage_free_shape():
    user = User(id=10, plan_id="free", email="free@test", password_hash="x", name="x")
    db = MagicMock()
    with patch("src.services.food_scan_limits._count_scans", return_value=2), patch(
        "src.services.food_scan_limits.meals_per_day_for_user",
        return_value=3,
    ):
        usage = build_scan_usage(db, user)
    assert usage["tier"] == "free"
    assert usage["cap"] == FREE_DAILY_CAP
    assert usage["used"] == 2
    assert usage["remaining"] == FREE_DAILY_CAP - 2
    assert usage["slots"] is None


def test_build_scan_usage_pro_uses_require_meal_slot_counts():
    user = User(id=11, plan_id="pro", email="pro@test", password_hash="x", name="x")
    db = MagicMock()

    def fake_count(_db, _user_id, *, since, until=None, meal_slot=None, require_meal_slot=False):
        if meal_slot == "Lunch" and require_meal_slot:
            return 2
        if meal_slot == "Breakfast" and require_meal_slot:
            return 0
        return 0

    with patch("src.services.food_scan_limits._count_scans", side_effect=fake_count), patch(
        "src.services.food_scan_limits.meals_per_day_for_user",
        return_value=3,
    ):
        usage = build_scan_usage(db, user, meal_type="Lunch")
    assert usage["tier"] == "pro"
    assert usage["meal_type"] == "Lunch"
    assert usage["used"] == 2
    assert usage["remaining"] == 0
    assert usage["cap"] == 2
    assert usage["slots"] is not None
    assert len(usage["slots"]) == 3


def test_enforce_throttle_backstop():
    user = User(id=4, plan_id="elite", email="t@test", password_hash="x", name="x")
    with patch("src.services.food_scan_limits._count_recent_throttle", return_value=8), patch(
        "src.services.food_scan_limits.meals_per_day_for_user",
        return_value=3,
    ):
        with pytest.raises(HTTPException) as exc:
            enforce_food_scan_limits(db=MagicMock(), user=user, meal_type="Dinner")
    assert exc.value.status_code == 429
    assert exc.value.detail["limit_type"] == "throttle"
