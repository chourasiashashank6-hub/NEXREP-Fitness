"""Tests for coach summary i18n label keys."""

from src.services.coach_summary_labels import (
    score_label_key,
    weekly_workout_hero_label_key,
    workout_readiness_label_key,
)


def test_score_label_keys():
    assert score_label_key(95) == "coach.summary.label.perfect"
    assert score_label_key(85) == "coach.summary.label.excellent"
    assert score_label_key(70) == "coach.summary.label.solidDay"
    assert score_label_key(40) == "coach.summary.label.gettingThere"
    assert score_label_key(10) == "coach.summary.label.needsWork"


def test_workout_readiness_label_keys():
    assert workout_readiness_label_key(90) == "coach.summary.label.peakReadiness"
    assert workout_readiness_label_key(80) == "coach.summary.label.readyToPush"
    assert workout_readiness_label_key(60) == "coach.summary.label.trainModerately"
    assert workout_readiness_label_key(40) == "coach.summary.label.lightActivityOnly"
    assert workout_readiness_label_key(10) == "coach.summary.label.restDayRecommended"


def test_weekly_workout_hero_label_keys():
    assert weekly_workout_hero_label_key(80) == "coach.summary.workout.weekly.heroStrong"
    assert weekly_workout_hero_label_key(50) == "coach.summary.workout.weekly.heroBuilding"
    assert weekly_workout_hero_label_key(20) == "coach.summary.workout.weekly.heroLight"
