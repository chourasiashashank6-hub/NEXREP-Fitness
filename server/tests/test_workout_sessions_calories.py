"""Active session Option A calorie model + source-aware history recompute."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal, engine
from src.main import WorkoutRequest, _estimate_saved_workout_calories, estimate_workout_calories_via_met
from src.routes.workout_sessions import _active_set_kcal
from src.routes.workout_sessions import SetLogIn
from src.services.exercise_met_service import resolve_met_for_exercise
from src.services.global_exercises_service import load_global_exercises_if_empty
from src.services.session_calories import (
    calc_active_exercise_kcal,
    calc_active_set_kcal,
    calc_exercise_estimate_kcal,
    ActiveSetLogInput,
    estimate_saved_workout_calories,
)

WEIGHT_KG = 75.0
EXERCISE = "Dips"
MET = 5.5
PRESCRIBED_REPS = 10


@pytest.fixture(scope="module")
def met_db() -> Session:
    load_global_exercises_if_empty(engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_dips_worked_examples_corrected_high_reps_fast():
    """15 reps / 50s — corrected from proposal table (was 16, actual is 18)."""
    kcal = calc_active_set_kcal(
        met=MET,
        user_weight_kg=WEIGHT_KG,
        work_sec=50,
        rest_sec=90,
        reps=15,
        prescribed_reps=PRESCRIBED_REPS,
    )
    assert kcal == 18


def test_dips_fast_vs_slow_and_rep_axes():
    fast_10 = calc_active_set_kcal(
        met=MET, user_weight_kg=WEIGHT_KG, work_sec=35, rest_sec=90, reps=10, prescribed_reps=10
    )
    slow_10 = calc_active_set_kcal(
        met=MET, user_weight_kg=WEIGHT_KG, work_sec=70, rest_sec=90, reps=10, prescribed_reps=10
    )
    low_reps = calc_active_set_kcal(
        met=MET, user_weight_kg=WEIGHT_KG, work_sec=35, rest_sec=90, reps=6, prescribed_reps=10
    )
    high_reps = calc_active_set_kcal(
        met=MET, user_weight_kg=WEIGHT_KG, work_sec=50, rest_sec=90, reps=15, prescribed_reps=10
    )

    assert fast_10 == 16
    assert slow_10 == 16
    assert low_reps == 13
    assert high_reps == 18
    assert fast_10 != low_reps
    assert high_reps > fast_10


def test_manual_planner_flat_model_unchanged(met_db: Session):
    met = resolve_met_for_exercise(met_db, exercise_name=EXERCISE)
    flat = calc_exercise_estimate_kcal(3, WEIGHT_KG, met=met)
    payload = WorkoutRequest(type="compound", exerciseName=EXERCISE, sets=3, reps=10, duration=5)
    via_met = estimate_workout_calories_via_met(payload, WEIGHT_KG, met_db)

    workout = SimpleNamespace(
        user_id=1,
        exercise_id=None,
        type="compound",
        exercise_name=EXERCISE,
        sets=3,
        reps=30,
        duration=5,
        notes="source=workout_planner; body_part=Triceps",
    )
    history = estimate_saved_workout_calories(workout, WEIGHT_KG, met_db, met=met)

    assert flat == via_met == history == 45


def test_active_session_history_matches_completion_formula(met_db: Session, monkeypatch):
    started = datetime.utcnow()
    set_logs = [
        ActiveSetLogInput(
            reps=10,
            started_at=started,
            completed_at=started + timedelta(seconds=35),
            prescribed_reps=10,
        ),
        ActiveSetLogInput(
            reps=10,
            started_at=started + timedelta(seconds=120),
            completed_at=started + timedelta(seconds=190),
            prescribed_reps=10,
        ),
        ActiveSetLogInput(
            reps=15,
            started_at=started + timedelta(seconds=240),
            completed_at=started + timedelta(seconds=290),
            prescribed_reps=10,
        ),
    ]

    def _mock_load(_db, workout):
        if "active_session:test-session-uuid" in str(getattr(workout, "notes", "")):
            return set_logs
        return []

    monkeypatch.setattr(
        "src.services.session_calories.load_active_set_logs_for_workout",
        _mock_load,
    )

    workout = SimpleNamespace(
        user_id=1,
        exercise_id=None,
        type="strength",
        exercise_name=EXERCISE,
        sets=3,
        reps=35,
        duration=5,
        notes="active_session:test-session-uuid",
    )
    history_kcal = estimate_saved_workout_calories(workout, WEIGHT_KG, met_db, met=MET)
    assert history_kcal == 16 + 16 + 18


def test_active_session_missing_set_logs_falls_back_flat(met_db: Session, monkeypatch):
    monkeypatch.setattr(
        "src.services.session_calories.load_active_set_logs_for_workout",
        lambda _db, _workout: [],
    )
    workout = SimpleNamespace(
        user_id=999999,
        exercise_id=None,
        type="compound",
        exercise_name=EXERCISE,
        sets=3,
        reps=30,
        duration=5,
        notes="active_session:missing-session-id",
    )
    assert estimate_saved_workout_calories(workout, WEIGHT_KG, met_db, met=MET) == 45


def test_fallback_reps_without_timestamps(met_db: Session):
    logs = [ActiveSetLogInput(reps=12, started_at=None, completed_at=None, prescribed_reps=10)]
    kcal = calc_active_exercise_kcal(logs, met=4.0, user_weight_kg=WEIGHT_KG, prescribed_reps=10)
    single = calc_active_set_kcal(
        met=4.0, user_weight_kg=WEIGHT_KG, work_sec=None, rest_sec=90, reps=12, prescribed_reps=10
    )
    assert kcal == single


def test_completion_path_uses_same_helper():
    started = datetime.utcnow()
    log = SetLogIn(
        exercise_name=EXERCISE,
        set_number=1,
        reps=10,
        started_at=started,
        completed_at=started + timedelta(seconds=35),
        prescribed_reps=10,
        rest_seconds=90,
    )
    direct = calc_active_set_kcal(
        met=MET,
        user_weight_kg=WEIGHT_KG,
        work_sec=35,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
    )
    assert _active_set_kcal(log, MET, WEIGHT_KG, baseline_load_kg=None) == direct


def test_magnitude_near_duration_only_baseline():
    """Typical 45s/10-rep set stays within ~20% of old duration-only estimate."""
    duration_only = int(round(MET * WEIGHT_KG * (45 + 90) / 3600))
    option_a = calc_active_set_kcal(
        met=MET, user_weight_kg=WEIGHT_KG, work_sec=45, rest_sec=90, reps=10, prescribed_reps=10
    )
    assert abs(option_a - duration_only) / duration_only <= 0.05


def test_load_multiplier_worked_examples():
    """Incline DB Press baseline 30kg — 20/30/50kg loads."""
    met = 6.0
    baseline = 30.0
    at_baseline = calc_active_set_kcal(
        met=met,
        user_weight_kg=WEIGHT_KG,
        work_sec=45,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
        load_kg=30,
        baseline_load_kg=baseline,
    )
    light = calc_active_set_kcal(
        met=met,
        user_weight_kg=WEIGHT_KG,
        work_sec=45,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
        load_kg=20,
        baseline_load_kg=baseline,
    )
    heavy = calc_active_set_kcal(
        met=met,
        user_weight_kg=WEIGHT_KG,
        work_sec=45,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
        load_kg=50,
        baseline_load_kg=baseline,
    )
    assert at_baseline == 17
    assert light == 15
    assert heavy == 20
    assert light < at_baseline < heavy


def test_load_multiplier_missing_load_is_neutral():
    base = calc_active_set_kcal(
        met=MET,
        user_weight_kg=WEIGHT_KG,
        work_sec=45,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
        load_kg=None,
        baseline_load_kg=30,
    )
    no_baseline = calc_active_set_kcal(
        met=MET,
        user_weight_kg=WEIGHT_KG,
        work_sec=45,
        rest_sec=90,
        reps=10,
        prescribed_reps=10,
        load_kg=50,
        baseline_load_kg=None,
    )
    assert base == 15
    assert no_baseline == base


def test_history_recompute_includes_load_weight(met_db: Session, monkeypatch):
    started = datetime.utcnow()
    set_logs = [
        ActiveSetLogInput(
            reps=10,
            started_at=started,
            completed_at=started + timedelta(seconds=45),
            prescribed_reps=10,
            weight_kg=50,
        ),
    ]

    def _mock_load(_db, workout):
        if "active_session:load-test" in str(getattr(workout, "notes", "")):
            return set_logs
        return []

    monkeypatch.setattr(
        "src.services.session_calories.load_active_set_logs_for_workout",
        _mock_load,
    )
    monkeypatch.setattr(
        "src.services.resolve_baseline_load_kg.resolve_baseline_load_kg",
        lambda _db, _uid, _name: 30.0,
    )

    workout = SimpleNamespace(
        user_id=1,
        exercise_id=None,
        type="strength",
        exercise_name="Incline Dumbbell Press",
        sets=1,
        reps=10,
        duration=2,
        notes="active_session:load-test",
    )
    with_load = estimate_saved_workout_calories(workout, WEIGHT_KG, met_db, met=6.0)
    assert with_load == 20
