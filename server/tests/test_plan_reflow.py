"""Tests for Smart Reflow helpers."""

import json
from datetime import date, timedelta

from src.services.plan_reflow_service import (
    _day_needs_repair,
    _is_missed_plan_day,
    _repair_day_exercises,
    estimate_duration_min,
    is_planner_logged_workout,
    weekly_review_message,
    weekly_summary_enabled,
)


class _FakeEntry:
    def __init__(self, split_name: str, focus_muscles: list[str] | None = None):
        self.split_name = split_name
        self.focus_muscles_json = json.dumps(focus_muscles or ["Chest", "Shoulders", "Triceps"])


def test_is_missed_plan_day_excludes_today():
    today = date(2026, 8, 24)
    yesterday = today - timedelta(days=1)
    assert _is_missed_plan_day(today, today, has_workout_log=False) is False
    assert _is_missed_plan_day(today, today, has_workout_log=True) is False
    assert _is_missed_plan_day(yesterday, today, has_workout_log=False) is True
    assert _is_missed_plan_day(yesterday, today, has_workout_log=True) is False


def test_repair_preserves_valid_reflow_tags():
    entry = _FakeEntry("Push Day", ["Chest", "Shoulders", "Triceps"])
    exercises = [
        {"name": "Bench Press", "muscle": "Chest", "sets": 4},
        {"name": "Overhead Press", "muscle": "Shoulders", "sets": 3},
        {"name": "Incline Dumbbell Press", "muscle": "Chest", "sets": 3, "reflow_source_day": 2},
    ]
    assert not _day_needs_repair(exercises, entry)
    repaired = _repair_day_exercises(exercises, entry)
    assert any(exercise.get("reflow_source_day") == 2 for exercise in repaired)


def test_repair_trims_over_cap_days():
    entry = _FakeEntry("Push Day", ["Chest", "Shoulders", "Triceps"])
    exercises = [
        {"name": f"Exercise {index}", "muscle": "Chest", "sets": 3}
        for index in range(9)
    ]
    assert _day_needs_repair(exercises, entry)
    repaired = _repair_day_exercises(exercises, entry)
    assert len(repaired) <= 8


class _FakeOnboarding:
    def __init__(self, onboarding_json):
        self.onboarding_json = onboarding_json


def test_is_planner_logged_workout():
    assert is_planner_logged_workout("source=workout_planner; body_part=Chest")
    assert not is_planner_logged_workout("manual log")


def test_estimate_duration_min():
    exercises = [{"name": "Bench", "sets": 4, "reps": "8", "rest_seconds": 90}]
    assert estimate_duration_min(exercises) >= 1
    assert estimate_duration_min([]) == 0


def test_weekly_summary_enabled_defaults_true():
    class FakeDb:
        def query(self, *_args):
            return self

        def filter(self, *_args):
            return self

        def first(self):
            return None

    assert weekly_summary_enabled(FakeDb(), 1) is True


def test_weekly_summary_respects_onboarding_toggle():
    class FakeDb:
        def query(self, *_args):
            return self

        def filter(self, *_args):
            return self

        def first(self):
            return _FakeOnboarding(
                {"app_setup": {"notifications": {"weekly_summary": False}}},
            )

    assert weekly_summary_enabled(FakeDb(), 1) is False


def test_weekly_review_message_includes_adherence():
    message = weekly_review_message(
        {
            "planned_training_days": 4,
            "completed_training_days": 3,
            "adherence_pct": 75,
            "workouts_logged": 5,
            "missed_training_days": [12],
            "top_muscles": [{"muscle": "Chest", "count": 2}],
            "low_volume_muscles": [],
            "compensation_target_day": None,
        }
    )
    assert "3 of 4 planned workouts completed" in message
    assert "Chest" not in message or "Top muscles" in message
