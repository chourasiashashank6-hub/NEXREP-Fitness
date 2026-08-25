"""Tests for resolve_baseline_load_kg."""

from types import SimpleNamespace

from src.services.resolve_baseline_load_kg import (
    is_bodyweight_exercise,
    parse_recommended_weight_midpoint,
    resolve_baseline_load_kg,
)


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def join(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._result


class _FakeDb:
    def __init__(self, session_log=None, strength_lift=None, catalog=None, global_row=None):
        self.session_log = session_log
        self.strength_lift = strength_lift
        self.catalog = catalog
        self.global_row = global_row
        self._call = 0

    def query(self, model):
        name = getattr(model, "__name__", str(model))
        if name == "WorkoutSessionSetLog":
            return _FakeQuery(self.session_log)
        if name == "StrengthLift":
            return _FakeQuery(self.strength_lift)
        if name == "WorkoutCatalog":
            return _FakeQuery(self.catalog)
        if name == "GlobalExercise":
            return _FakeQuery(self.global_row)
        return _FakeQuery(None)


def test_parse_recommended_weight_midpoint():
    assert parse_recommended_weight_midpoint("Bodyweight") == 0.0
    assert parse_recommended_weight_midpoint("10-20") == 15.0
    assert parse_recommended_weight_midpoint("20-50") == 35.0
    assert parse_recommended_weight_midpoint("25") == 25.0


def test_resolve_baseline_prefers_session_log():
    db = _FakeDb(session_log=SimpleNamespace(weight_kg=52.5))
    assert resolve_baseline_load_kg(db, user_id=1, exercise_name="Bench Press") == 52.5


def test_resolve_baseline_falls_back_to_strength_lift():
    db = _FakeDb(strength_lift=SimpleNamespace(weight_kg=40.0))
    assert resolve_baseline_load_kg(db, user_id=1, exercise_name="Squat") == 40.0


def test_resolve_baseline_catalog_midpoint():
    db = _FakeDb(catalog=SimpleNamespace(recommended_weight_kg="20-50"))
    assert resolve_baseline_load_kg(db, user_id=1, exercise_name="Leg Press") == 35.0


def test_is_bodyweight_from_catalog():
    db = _FakeDb(catalog=SimpleNamespace(recommended_weight_kg="Bodyweight"))
    assert is_bodyweight_exercise(db, "Push-up") is True
