"""Progress XP level math and calorie-target checks."""

from __future__ import annotations

from src.services.xp_service import (
    XP_CALORIE_TARGET_HIT,
    XP_EXERCISE_LOGGED,
    XP_STREAK_DAY_BONUS,
    _calorie_target_hit,
    level_for_total_xp,
    xp_to_next_level,
)


def test_level_for_total_xp_boundaries():
    assert level_for_total_xp(0) == 1
    assert level_for_total_xp(149) == 1
    assert level_for_total_xp(150) == 2
    assert level_for_total_xp(4499) == 9
    assert level_for_total_xp(4500) == 10
    assert level_for_total_xp(99999) == 10


def test_xp_to_next_level_mid_level():
    into, needed = xp_to_next_level(200)
    assert into == 50
    assert needed == 200


def test_xp_to_next_level_max_level():
    into, needed = xp_to_next_level(5000)
    assert needed is None
    assert into >= 0


def test_calorie_target_hit_within_five_percent():
    class Log:
        target_calories = 2000
        total_calories = 2040

    assert _calorie_target_hit(Log()) is True


def test_calorie_target_hit_outside_five_percent():
    class Log:
        target_calories = 2000
        total_calories = 2110

    assert _calorie_target_hit(Log()) is False


def test_xp_constants_match_spec():
    assert XP_EXERCISE_LOGGED == 10
    assert XP_CALORIE_TARGET_HIT == 30
    assert XP_STREAK_DAY_BONUS == 15
