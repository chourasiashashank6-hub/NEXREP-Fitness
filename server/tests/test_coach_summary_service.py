"""Tests for deterministic coach summary aggregates."""

from __future__ import annotations

from datetime import date

from src.services.coach_summary_service import (
    day_on_target,
    macro_status,
    daily_score,
)


def test_macro_status_uses_08_threshold():
    assert macro_status(119, 165) == "low"
    assert macro_status(132, 165) == "on_track"
    assert macro_status(200, 165) == "high"


def test_day_on_target_requires_90_percent():
    assert day_on_target(189, 210, 143, 158) is True
    assert day_on_target(180, 210, 120, 158) is False


def test_daily_score_penalizes_low_protein():
    low = daily_score(
        calories=1400,
        target_cal=2100,
        protein=80,
        protein_target=165,
        carbs=150,
        carbs_target=220,
        fat=50,
        fat_target=65,
        water_l=1.5,
        water_target_l=2.5,
        meals_count=2,
    )
    high = daily_score(
        calories=1400,
        target_cal=2100,
        protein=140,
        protein_target=165,
        carbs=150,
        carbs_target=220,
        fat=50,
        fat_target=65,
        water_l=1.5,
        water_target_l=2.5,
        meals_count=2,
    )
    assert high > low
