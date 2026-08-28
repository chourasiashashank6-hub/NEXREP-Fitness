"""Canonical nutrition actuals for journey detection (matches Calorie Log display)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.utils.app_time import today_ist


def _last_meal_log_date(db: Session, user_id: int) -> date | None:
    value = (
        db.query(func.max(DailyNutritionLog.log_date))
        .join(MealEntry, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id)
        .scalar()
    )
    return value if isinstance(value, date) else None


def resolve_user_log_today(db: Session, user_id: int, now_utc: datetime | None = None) -> date:
    """Best-effort log day for cron/background jobs — anchored on IST calendar date.

    Calorie Log keys rows by the client's IST date. When no client date is present,
    use today's IST date, with a fallback to the latest meal-log date when it is still
    ahead of the IST calendar (e.g. late-night logging edge cases).
    """
    _ = now_utc  # kept for call-site compatibility; IST is the app default
    ist_today = today_ist()
    latest = _last_meal_log_date(db, user_id)
    if latest is None:
        return ist_today
    if latest >= ist_today:
        return latest
    if (ist_today - latest).days == 1:
        return latest
    return ist_today


def nutrition_day_has_meals(db: Session, user, log_date: date) -> bool:
    """True when the user logged at least one meal on this log date."""
    from src.routes.calories import _get_or_create_daily_log

    log = _get_or_create_daily_log(db, user, log_date)
    return db.query(MealEntry).filter(MealEntry.log_id == log.log_id).count() > 0


def nutrition_day_actuals(db: Session, user, log_date: date) -> dict[str, float]:
    """Return recalculated day totals — same path as GET /api/calories/daily-log."""
    from src.routes.calories import _get_or_create_daily_log, _serialize_day

    day = _serialize_day(db, user, log_date)
    log = day.get("log") or {}
    water = day.get("water") or {}
    return {
        "calories": float(log.get("total_calories") or 0),
        "protein_g": float(log.get("total_protein_g") or 0),
        "carbs_g": float(log.get("total_carbs_g") or 0),
        "fat_g": float(log.get("total_fat_g") or 0),
        "water_l": float(water.get("total_water_l") or 0),
    }
