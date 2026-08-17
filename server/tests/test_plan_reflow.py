"""Tests for Smart Reflow helpers."""

from src.services.plan_reflow_service import (
    estimate_duration_min,
    is_planner_logged_workout,
    weekly_review_message,
    weekly_summary_enabled,
)


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
