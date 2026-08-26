"""Tests for deterministic workout engine v3."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.services import workout_engine_v3 as v3


def test_deterministic_same_seed():
    ctx = v3.WorkoutEngineContext(
        user_id=42,
        workouts_per_week=4,
        exercises_per_session=5,
        goal_type="muscle_gain",
        difficulty="intermediate",
        activity_level="moderately_active",
        focus_muscles=["Chest"],
        user_weight_kg=75,
        user_sex="male",
        problem_areas=[],
        regen_version=0,
        week_number=1,
    )
    rng1 = v3._rng(42, 8, 2026, 5, "upper_a", 0)
    rng2 = v3._rng(42, 8, 2026, 5, "upper_a", 0)
    assert [rng1.random() for _ in range(5)] == [rng2.random() for _ in range(5)]


def test_regen_version_changes_seed():
    rng1 = v3._rng(42, 8, 2026, 5, "upper_a", 0)
    rng2 = v3._rng(42, 8, 2026, 5, "upper_a", 1)
    assert [rng1.random() for _ in range(5)] != [rng2.random() for _ in range(5)]


def test_split_display_name_is_i18n_key():
    assert v3.split_display_name("push_a").startswith("coach.workout.split.")
    assert v3.split_display_name("rest") == "coach.workout.split.rest"


def test_week_pattern_4_days():
    pattern = v3.week_pattern(4)
    training = [p for p in pattern if not p[1]]
    assert len(training) == 4


def test_estimate_duration_uses_45s_work():
    exercises = [{"sets": 3, "rest_seconds": 90}]
    duration = v3._estimate_duration(exercises)
    # 3 * (45 + 90) = 405s ≈ 7 min
    assert duration == 7


def test_classify_movement_pattern_squat():
    ex = v3.CatalogExercise(
        id=1,
        name="Barbell Back Squat",
        body_part="Legs",
        equipment="Barbell",
        difficulty="Intermediate",
        is_compound=True,
        met_value=5.0,
        muscles_primary=["Quadriceps"],
        muscles_secondary=[],
        cues=[],
        movement_pattern="",
    )
    assert v3.classify_movement_pattern(ex) == "squat_pattern"


def test_prescribe_weight_bodyweight_returns_nulls(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr(v3, "is_bodyweight_exercise", lambda _db, _name: True)
    ex = v3.CatalogExercise(
        id=1,
        name="Push Ups",
        body_part="Chest",
        equipment="Bodyweight",
        difficulty="Beginner",
        is_compound=True,
        met_value=4.0,
        muscles_primary=[],
        muscles_secondary=[],
        cues=[],
        movement_pattern="press_pattern",
    )
    ctx = v3.WorkoutEngineContext(
        user_id=1,
        workouts_per_week=3,
        exercises_per_session=4,
        goal_type="muscle_gain",
        difficulty="beginner",
        activity_level="lightly_active",
        focus_muscles=[],
        user_weight_kg=70,
        user_sex="male",
        problem_areas=[],
    )
    result = v3._prescribe_weight(db, ctx, ex, "primary_compound")
    assert result["weight_kg"] is None


def _front_squat_fixture() -> v3.CatalogExercise:
    return v3.CatalogExercise(
        id=100,
        name="Barbell Front Squat",
        body_part="Legs",
        equipment="Barbell",
        difficulty="Advanced",
        is_compound=True,
        met_value=6.0,
        muscles_primary=["Quadriceps"],
        muscles_secondary=["Glutes", "Core", "Upper Back"],
        cues=[],
        movement_pattern="squat_pattern",
    )


def test_front_squat_does_not_match_back():
    ex = _front_squat_fixture()
    assert v3._muscle_matches(ex, "Back") is False
    assert v3._muscle_matches(ex, "Legs") is True
    assert v3._split_excludes_body_part("upper", "Legs") is True
    assert v3._split_excludes_body_part("full_body", "Legs") is False


def test_deficit_deadlift_matches_back():
    ex = v3.CatalogExercise(
        id=52,
        name="Deficit Deadlift",
        body_part="Back",
        equipment="Barbell",
        difficulty="Advanced",
        is_compound=True,
        met_value=6.0,
        muscles_primary=["Hamstrings", "Glutes", "Erector Spinae"],
        muscles_secondary=["Quads", "Lats"],
        cues=[],
        movement_pattern="hinge_pattern",
    )
    assert v3._muscle_matches(ex, "Back") is True
