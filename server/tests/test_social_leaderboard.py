"""Weekly friends leaderboard correctness."""

from __future__ import annotations

from datetime import date

from src.services.social_challenge_service import week_window


def test_week_window_uses_ist_monday():
    start, next_start, reset_at = week_window(date(2026, 8, 29))
    assert start == date(2026, 8, 24)
    assert next_start == date(2026, 8, 31)
    assert reset_at.tzinfo is not None
    assert reset_at.hour == 0
