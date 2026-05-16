from __future__ import annotations

import calendar
import json
from datetime import date, datetime
from typing import Any


def parse_local_date(local_date: str | None) -> date:
    if local_date:
        try:
            return date.fromisoformat(local_date[:10])
        except ValueError:
            pass
    return date.today()


def days_in_month(month: int, year: int) -> int:
    return calendar.monthrange(year, month)[1]


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
