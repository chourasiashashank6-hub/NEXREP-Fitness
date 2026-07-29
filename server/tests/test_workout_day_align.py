"""Tests for workout planner day-alignment and AI-attempt caps."""

from src.services import workout_planner_service as wps
from src.services.workout_planner_service import _align_chunk_days_to_calendar, _validate_workout_day


def test_align_chunk_days_remaps_renumbered_ai_days():
    # Mid-month regen asks for 27..31; model often returns 1..5.
    ai_days = [
        {"day": 1, "is_rest_day": False, "split_name": "Upper A", "focus_muscles": ["Chest"], "exercises": [], "estimated_duration_min": 60},
        {"day": 2, "is_rest_day": True, "split_name": "Rest Day", "focus_muscles": [], "exercises": [], "estimated_duration_min": 0},
        {"day": 3, "is_rest_day": False, "split_name": "Lower A", "focus_muscles": ["Legs"], "exercises": [], "estimated_duration_min": 70},
        {"day": 4, "is_rest_day": False, "split_name": "Upper B", "focus_muscles": ["Back"], "exercises": [], "estimated_duration_min": 65},
        {"day": 5, "is_rest_day": False, "split_name": "Lower B", "focus_muscles": ["Legs"], "exercises": [], "estimated_duration_min": 70},
    ]
    calendar = [27, 28, 29, 30, 31]
    aligned = _align_chunk_days_to_calendar(ai_days, calendar)
    assert [d["day"] for d in aligned] == calendar
    assert aligned[0]["split_name"] == "Upper A"
    assert aligned[1]["is_rest_day"] is True


def test_validate_workout_day_accepts_string_day():
    row = _validate_workout_day(
        {"day": "27", "is_rest_day": False, "split_name": "Push", "focus_muscles": [], "exercises": [], "estimated_duration_min": 50}
    )
    assert row is not None
    assert row["day"] == 27


def test_regenerate_day_ai_caps_total_attempts(monkeypatch):
    calls = {"groq": 0, "gemini": 0}

    def fake_groq(*args, **kwargs):
        calls["groq"] += 1
        raise RuntimeError("groq timeout")

    def fake_gemini(*args, **kwargs):
        calls["gemini"] += 1
        raise RuntimeError("gemini timeout")

    monkeypatch.setattr(wps, "_groq_workout_chunk", fake_groq)
    monkeypatch.setattr(wps, "_gemini_workout_chunk", fake_gemini)
    monkeypatch.setattr(wps, "AI_MAX_ATTEMPTS_PER_REQUEST", 2)
    monkeypatch.setattr(wps, "AI_TOTAL_BUDGET_SECONDS", 999)

    out = wps._regenerate_workout_day_ai(
        day=27,
        split_name="Upper A",
        focus_muscles=["Back"],
        exclude_exercises=[],
        target_duration=55,
        ctx={
            "workouts_per_week": 4,
            "exercises_per_session": 5,
            "goal_type": "fat_loss",
            "difficulty": "intermediate",
            "activity_level": "moderately_active",
            "workout_types": ["strength"],
            "user_weight_kg": 75.0,
        },
        user_id=2,
    )
    assert out is None
    assert calls == {"groq": 1, "gemini": 1}


def test_generate_chunk_falls_back_after_capped_attempts(monkeypatch):
    calls = {"groq": 0, "gemini": 0}

    def fake_groq(*args, **kwargs):
        calls["groq"] += 1
        raise RuntimeError("groq down")

    def fake_gemini(*args, **kwargs):
        calls["gemini"] += 1
        raise RuntimeError("gemini down")

    monkeypatch.setattr(wps, "_groq_workout_chunk", fake_groq)
    monkeypatch.setattr(wps, "_gemini_workout_chunk", fake_gemini)
    monkeypatch.setattr(wps, "AI_MAX_ATTEMPTS_PER_REQUEST", 2)
    monkeypatch.setattr(wps, "AI_TOTAL_BUDGET_SECONDS", 999)

    rows, source = wps._generate_workout_chunk(
        days=[27, 28, 29],
        chunk_index=0,
        ctx={
            "workouts_per_week": 4,
            "exercises_per_session": 5,
            "goal_type": "fat_loss",
            "difficulty": "intermediate",
            "activity_level": "moderately_active",
            "focus_muscles": ["Back"],
            "has_muscle_focus": True,
            "workout_types": ["strength"],
            "user_weight_kg": 75.0,
            "current_body_type": "",
            "goal_body_type": "",
            "problem_areas": [],
        },
        user_id=2,
    )
    assert source == "fallback"
    assert [row["day"] for row in rows] == [27, 28, 29]
    assert calls == {"groq": 1, "gemini": 1}
