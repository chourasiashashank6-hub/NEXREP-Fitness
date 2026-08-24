"""Session calorie model — uses DB/catalog MET values."""

from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal, engine
from src.main import WorkoutRequest, _estimate_saved_workout_calories, estimate_workout_calories_via_met
from src.services.exercise_met_service import resolve_met_for_exercise
from src.services.global_exercises_service import load_global_exercises_if_empty
from src.services.session_calories import (
    calc_exercise_estimate_kcal,
    calc_set_kcal,
    estimate_workout_calories_session_model,
)

WEIGHT_KG = 75.0
SETS = 3


@pytest.fixture(scope="module")
def met_db() -> Session:
    load_global_exercises_if_empty(engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _kcal_for(met_db: Session, name: str, sets: int = SETS) -> int:
    met = resolve_met_for_exercise(met_db, exercise_name=name)
    return calc_exercise_estimate_kcal(sets, WEIGHT_KG, met=met)


def test_bug_report_exercises_produce_distinct_kcal(met_db):
    values = {
        "Dips": _kcal_for(met_db, "Dips"),
        "Cable Fly": _kcal_for(met_db, "Cable Fly"),
        "Tricep Pushdown": _kcal_for(met_db, "Tricep Pushdown"),
        "Incline Dumbbell Press": _kcal_for(met_db, "Incline Dumbbell Press"),
    }
    assert values == {
        "Dips": 45,
        "Cable Fly": 33,
        "Tricep Pushdown": 30,
        "Incline Dumbbell Press": 42,
    }
    assert len(set(values.values())) == 4


def test_via_met_uses_db_met(met_db):
    payload = WorkoutRequest(
        type="compound",
        exerciseName="Dips",
        sets=3,
        reps=10,
        duration=5,
        timeTaken="3:40",
    )
    assert estimate_workout_calories_via_met(payload, WEIGHT_KG, met_db) == 45


def test_push_day_session_total_with_db_met(met_db):
    exercises = [
        ("Barbell Bench Press", 4),
        ("Overhead Press", 3),
        ("Incline Dumbbell Press", 3),
        ("Tricep Pushdown", 3),
        ("Cable Fly", 3),
        ("Dips", 3),
    ]
    total = sum(_kcal_for(met_db, name, sets) for name, sets in exercises)
    assert total == 263


def test_partial_completion_is_proportional(met_db):
    exercises = [
        ("Barbell Bench Press", 4),
        ("Overhead Press", 3),
        ("Incline Dumbbell Press", 3),
        ("Tricep Pushdown", 3),
        ("Cable Fly", 3),
        ("Dips", 3),
    ]
    full = sum(_kcal_for(met_db, name, sets) for name, sets in exercises)
    half = sum(_kcal_for(met_db, name, sets) for name, sets in exercises[:3])
    assert half > full * 0.4
    assert half < full * 0.6


def test_guided_warmup_uses_duration_model():
    kcal = estimate_workout_calories_session_model(
        exercise_name="Guided Warm-up",
        sets=4,
        duration_minutes=15,
        user_weight_kg=WEIGHT_KG,
        met=6.0,
    )
    assert kcal == 110


def test_saved_workout_recompute_uses_db_met(met_db):
    workout = SimpleNamespace(
        exercise_id=None,
        type="compound",
        exercise_name="Dips",
        sets=3,
        reps=10,
        duration=5,
        notes="source=workout_planner",
    )
    assert _estimate_saved_workout_calories(workout, WEIGHT_KG, met_db) == 45


def test_calc_set_kcal_uses_explicit_met():
    assert calc_set_kcal(met=5.5, user_weight_kg=75) == 15
