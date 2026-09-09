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


def infer_meal_type_ist(now: datetime | None = None) -> str:
    """Match mobile CalorieLog mealTypeFromLocalTime (IST wall clock)."""
    h = (now or now_ist()).hour
    if 5 <= h < 10:
        return "Breakfast"
    if 10 <= h < 12:
        return "Snack"
    if 12 <= h < 15:
        return "Lunch"
    if 15 <= h < 18:
        return "Snack"
    if 18 <= h < 22:
        return "Dinner"
    return "Snack"
