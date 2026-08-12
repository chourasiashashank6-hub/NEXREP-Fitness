"""Muscle inference for Workout Coach readiness/volume."""

from types import SimpleNamespace

from src.main import _infer_muscles_from_workout, _muscles_from_body_part


class _FakeDb:
    pass


def test_notes_triceps_wins_over_catalog_arms():
    workout = SimpleNamespace(
        exercise_id=None,
        exercise_name="Tricep Pushdown",
        notes="source=workout_planner; body_part=Triceps",
    )
    muscles = _infer_muscles_from_workout(workout, _FakeDb())  # type: ignore[arg-type]
    assert muscles == ["Triceps"]


def test_generic_arms_maps_to_biceps_and_triceps():
    assert _muscles_from_body_part("Arms") == ["Biceps", "Triceps"]


def test_triceps_body_part_maps_only_triceps():
    assert _muscles_from_body_part("Triceps") == ["Triceps"]
