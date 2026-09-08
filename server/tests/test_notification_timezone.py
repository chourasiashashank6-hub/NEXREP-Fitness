"""Notification timezone and catch-up gate tests."""

from datetime import datetime, timezone
from types import SimpleNamespace

from src.services.notification_service import (
    CHECKPOINTS,
    QUOTE_OF_THE_DAY_HOUR,
    STREAK_LOST_HOUR,
    STREAK_RISK_HOUR,
    WEEKLY_DIGEST_HOUR,
    _normalize_timezone_name,
    _user_local_now,
)


def test_normalize_timezone_name_defaults_invalid():
    assert _normalize_timezone_name(None) == "UTC"
    assert _normalize_timezone_name("Asia/Kolkata") == "Asia/Kolkata"
    assert _normalize_timezone_name("Not/A_Real_Zone") == "UTC"


def test_user_local_now_converts_utc_to_ist():
    user = SimpleNamespace(timezone="Asia/Kolkata")
    utc_now = datetime(2026, 9, 8, 10, 0, 0, tzinfo=timezone.utc)
    local = _user_local_now(user, utc_now.replace(tzinfo=None))
    assert local.hour == 15
    assert local.date().isoformat() == "2026-09-08"


def test_catch_up_gates_use_at_or_after_hours():
    assert STREAK_RISK_HOUR == 19
    assert QUOTE_OF_THE_DAY_HOUR == 8
    assert STREAK_LOST_HOUR == 9
    assert WEEKLY_DIGEST_HOUR == 18
    assert min(CHECKPOINTS) == 14

    # Late server wake at hour 22 should still pass quote/streak-risk gates.
    late_local = datetime(2026, 9, 8, 22, 5, 0)
    assert late_local.hour >= QUOTE_OF_THE_DAY_HOUR
    assert late_local.hour >= STREAK_RISK_HOUR
    assert late_local.hour >= min(CHECKPOINTS)
