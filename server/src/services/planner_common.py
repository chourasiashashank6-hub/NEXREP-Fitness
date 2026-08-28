from __future__ import annotations

import calendar
import json
from datetime import date, datetime
from typing import Any, TypedDict


from src.utils.app_time import today_ist


def parse_local_date(local_date: str | None) -> date:
    if local_date:
        try:
            return date.fromisoformat(local_date[:10])
        except ValueError:
            pass
    return today_ist()


def days_in_month(month: int, year: int) -> int:
    return calendar.monthrange(year, month)[1]


class MonthWeekBlock(TypedDict):
    week_number: int
    start_day: int
    end_day: int
    days: list[int]
    label: str


def month_abbr(month: int) -> str:
    return calendar.month_abbr[month]


def get_month_weeks(year: int, month: int) -> list[MonthWeekBlock]:
    """
    Split a month into week blocks aligned to calendar weeks (Mon–Sun).
    First/last week may be partial if the month does not start/end on Sunday.
    """
    last_day = calendar.monthrange(year, month)[1]
    weeks: list[MonthWeekBlock] = []
    week_num = 1
    current_day = 1

    while current_day <= last_day:
        current_date = date(year, month, current_day)
        days_until_sunday = 6 - current_date.weekday()
        end_day = min(current_day + days_until_sunday, last_day)
        days = list(range(current_day, end_day + 1))
        weeks.append(
            {
                "week_number": week_num,
                "start_day": current_day,
                "end_day": end_day,
                "days": days,
                "label": f"Week {week_num}: {month_abbr(month)} {current_day}–{end_day}",
            }
        )
        current_day = end_day + 1
        week_num += 1

    return weeks


def get_current_week(year: int, month: int, today_day: int) -> MonthWeekBlock:
    weeks = get_month_weeks(year, month)
    for w in weeks:
        if w["start_day"] <= today_day <= w["end_day"]:
            return w
    return weeks[-1]


def get_next_week(year: int, month: int, today_day: int) -> MonthWeekBlock | None:
    weeks = get_month_weeks(year, month)
    for i, w in enumerate(weeks):
        if w["start_day"] <= today_day <= w["end_day"]:
            if i + 1 < len(weeks):
                return weeks[i + 1]
            return None
    return None


def month_chunks(month: int, year: int, chunk_size: int = 7) -> list[list[int]]:
    total = days_in_month(month, year)
    days = list(range(1, total + 1))
    chunks: list[list[int]] = []
    for i in range(0, len(days), chunk_size):
        chunks.append(days[i : i + chunk_size])
    return chunks


def days_chunks_from_range(from_day: int, last_day: int, chunk_size: int = 7) -> list[list[int]]:
    """Build 7-day chunks for a subset of month days (e.g. partial regeneration)."""
    if from_day > last_day:
        return []
    remaining = list(range(from_day, last_day + 1))
    chunks: list[list[int]] = []
    for i in range(0, len(remaining), chunk_size):
        chunks.append(remaining[i : i + chunk_size])
    return chunks


def day_flags(day: int, today: date, month: int, year: int) -> dict[str, bool]:
    if today.month != month or today.year != year:
        return {"is_past": False, "is_today": False, "is_future": True}
    if day < today.day:
        return {"is_past": True, "is_today": False, "is_future": False}
    if day == today.day:
        return {"is_past": False, "is_today": True, "is_future": False}
    return {"is_past": False, "is_today": False, "is_future": True}


def month_label(month: int, year: int) -> str:
    return date(year, month, 1).strftime("%B %Y")


def safe_json_loads(raw: str) -> Any:
    return json.loads(raw or "[]")


def safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj)


def parse_groq_json_array(content: str) -> list[dict[str, Any]]:
    clean = (content or "").replace("```json", "").replace("```", "").strip()
    parsed = json.loads(clean)
    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict)]
    if isinstance(parsed, dict):
        for key in ("days", "plan", "meals", "workouts", "data"):
            val = parsed.get(key)
            if isinstance(val, list):
                return [x for x in val if isinstance(x, dict)]
    raise ValueError("Expected JSON array of day objects")


def iso_dt(dt: datetime | None) -> str:
    if not dt:
        return datetime.utcnow().isoformat()
    return dt.isoformat()
