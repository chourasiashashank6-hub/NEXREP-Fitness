"""App calendar time — IST (Asia/Kolkata) for all day-boundary logic."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo("Asia/Kolkata")


def now_ist() -> datetime:
    return datetime.now(APP_TIMEZONE)


def today_ist() -> date:
    return now_ist().date()


def ist_day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Inclusive start of IST calendar day and exclusive start of the next day."""
    current = now or now_ist()
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def next_midnight_ist(now: datetime | None = None) -> datetime:
    _, end = ist_day_window(now)
    return end
