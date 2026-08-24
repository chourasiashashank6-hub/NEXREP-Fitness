"""Session calorie model — aligned with mobile sessionCalories.ts burn targets."""

from types import SimpleNamespace

from src.main import WorkoutRequest, estimate_workout_calories_via_met
from src.services.session_calories import (
    calc_exercise_estimate_kcal,
    calc_set_kcal,
    estimate_workout_calories_session_model,
    met_for_exercise,
)


def test_met_for_exercise_bench_press():
    assert met_for_exercise("Barbell Bench Press") == 6.0
    assert met_for_exercise("Cable Fly") == 5.0


def test_calc_set_kcal_matches_client_formula():
    # 75 kg, default MET 5: round(5 * 75 * 135/3600) = 14
    assert calc_set_kcal(exercise_name="Cable Fly", user_weight_kg=75) == 14
    # bench press MET 6: round(6 * 75 * 135/3600) = 17
    assert calc_set_kcal(exercise_name="Barbell Bench Press", user_weight_kg=75) == 17


def test_calc_exercise_estimate_scales_by_sets():
    assert calc_exercise_estimate_kcal("Dips", 1, 75) == 14
    assert calc_exercise_estimate_kcal("Dips", 4, 75) == 56


def test_via_met_matches_session_model_for_planner_style_log():
    payload = WorkoutRequest(
        type="compound",
        exerciseName="Barbell Bench Press",
        sets=4,
        reps=10,
        duration=8,
        difficulty="intermediate",
        timeTaken="7:28",
    )
    assert estimate_workout_calories_via_met(payload, 75) == 68


def test_six_push_day_exercises_near_session_target():
    """Full Push Day completion should sum near client plannedBurnTargets session kcal."""
    exercises = [
        ("Barbell Bench Press", 4),
        ("Overhead Press", 3),
        ("Incline Dumbbell Press", 3),
        ("Tricep Pushdown", 3),
        ("Cable Fly", 3),
        ("Dips", 3),
    ]
    weight_kg = 75.0
    session_total = sum(
        calc_exercise_estimate_kcal(name, sets, weight_kg) for name, sets in exercises
    )
    logged_total = sum(
        estimate_workout_calories_session_model(
            exercise_name=name,
            sets=sets,
            user_weight_kg=weight_kg,
        )
        for name, sets in exercises
    )
    assert session_total == logged_total
    assert session_total >= 250
    assert session_total <= 320


def test_partial_completion_is_proportional():
    exercises = [
        ("Barbell Bench Press", 4),
        ("Overhead Press", 3),
        ("Incline Dumbbell Press", 3),
        ("Tricep Pushdown", 3),
        ("Cable Fly", 3),
        ("Dips", 3),
    ]
    weight_kg = 75.0
    full = sum(calc_exercise_estimate_kcal(n, s, weight_kg) for n, s in exercises)
    half = sum(
        calc_exercise_estimate_kcal(n, s, weight_kg) for n, s in exercises[:3]
    )
    assert half > full * 0.4
    assert half < full * 0.6


def test_guided_warmup_uses_duration_model():
    kcal = estimate_workout_calories_session_model(
        exercise_name="Guided Warm-up",
        sets=4,
        duration_minutes=15,
        user_weight_kg=75,
    )
    # 6 MET × 75 kg × 900s / 3600 ≈ 112.5 → 110 (round-to-nearest-5)
    assert kcal == 110


def test_saved_workout_recompute_uses_sets_from_row():
    from src.main import _estimate_saved_workout_calories

    workout = SimpleNamespace(
        exercise_id=None,
        type="compound",
        exercise_name="Dips",
        sets=3,
        reps=10,
        duration=5,
        notes="source=workout_planner",
    )
    assert _estimate_saved_workout_calories(workout, 75, None) == 42
