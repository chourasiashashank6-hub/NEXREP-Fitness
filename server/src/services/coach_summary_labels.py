"""i18n key helpers for coach summary responses (no display text on the wire)."""

from __future__ import annotations

# Shared nutrition + workout daily score bands
SCORE_LABEL_KEYS = (
    (90, "coach.summary.label.perfect"),
    (81, "coach.summary.label.excellent"),
    (61, "coach.summary.label.solidDay"),
    (31, "coach.summary.label.gettingThere"),
    (0, "coach.summary.label.needsWork"),
)


def score_label_key(score: int) -> str:
    for threshold, key in SCORE_LABEL_KEYS:
        if score >= threshold:
            return key
    return "coach.summary.label.needsWork"


def workout_readiness_label_key(score: int) -> str:
    if score >= 85:
        return "coach.summary.label.peakReadiness"
    if score >= 76:
        return "coach.summary.label.readyToPush"
    if score >= 51:
        return "coach.summary.label.trainModerately"
    if score >= 31:
        return "coach.summary.label.lightActivityOnly"
    return "coach.summary.label.restDayRecommended"


def weekly_workout_hero_label_key(percent_complete: int) -> str:
    if percent_complete >= 75:
        return "coach.summary.workout.weekly.heroStrong"
    if percent_complete >= 40:
        return "coach.summary.workout.weekly.heroBuilding"
    return "coach.summary.workout.weekly.heroLight"
