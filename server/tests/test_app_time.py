from datetime import datetime, timezone

from src.utils.app_time import APP_TIMEZONE, today_ist


def test_app_timezone_is_ist():
    assert str(APP_TIMEZONE) == "Asia/Kolkata"


def test_ist_calendar_day_from_utc_evening():
    # 2026-08-28 20:00 UTC -> 2026-08-29 01:30 IST
    utc_evening = datetime(2026, 8, 28, 20, 0, tzinfo=timezone.utc)
    assert utc_evening.astimezone(APP_TIMEZONE).date().isoformat() == "2026-08-29"


def test_today_ist_returns_date():
    assert today_ist().isoformat()  # smoke
