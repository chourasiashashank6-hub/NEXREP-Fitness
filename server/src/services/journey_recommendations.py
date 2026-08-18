"""Static recommendation keys + params for journey events (client i18n)."""

from __future__ import annotations

from typing import Any


def recommendation_for_event(event_type: str, payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    key_root = "coach.journey.recommendations"
    if event_type == "protein_gap_streak":
        return (
            f"{key_root}.proteinGapStreak",
            {
                "days": payload.get("streak_days", 0),
                "proteinG": payload.get("protein_g", 0),
                "targetProteinG": payload.get("target_protein_g", 0),
            },
        )
    if event_type == "adherence_trend":
        return (
            f"{key_root}.adherenceTrend",
            {"daysOnTarget": payload.get("days_on_target", 0), "windowDays": payload.get("window_days", 7)},
        )
    if event_type == "volume_spike":
        return (
            f"{key_root}.volumeSpike",
            {
                "muscle": payload.get("muscle", ""),
                "percentIncrease": payload.get("percent_increase", 0),
                "currentSets": payload.get("current_sets", 0),
                "previousSets": payload.get("previous_sets", 0),
            },
        )
    if event_type == "plateau":
        return (
            f"{key_root}.plateau",
            {
                "exerciseName": payload.get("exercise_name", ""),
                "weeksFlat": payload.get("weeks_flat", 0),
                "bestWeightKg": payload.get("best_weight_kg", 0),
            },
        )
    if event_type == "disengagement":
        return (
            f"{key_root}.disengagement",
            {"domain": payload.get("disengagement_domain", payload.get("domain_label", "")), "daysSince": payload.get("days_since", 0)},
        )
    return f"{key_root}.generic", {}
