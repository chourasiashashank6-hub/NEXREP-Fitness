"""Canonical nutrition actuals for journey detection (matches Calorie Log display)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.nutrition_calories import DailyNutritionLog, MealEntry


def _last_meal_log_date(db: Session, user_id: int) -> date | None:
    value = (
        db.query(func.max(DailyNutritionLog.log_date))
        .join(MealEntry, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id)
        .scalar()
    )
    return value if isinstance(value, date) else None


def resolve_user_log_today(db: Session, user_id: int, now_utc: datetime) -> date:
    """Best-effort user-local log day when timezone is not stored on the user.

    Calorie Log keys rows by the client's local date. For cron runs we anchor on the
    latest meal-log date when UTC midnight has not caught up yet (common UTC+ offsets),
    or when the user is still on the previous local day relative to UTC.
    """
    utc_today = now_utc.date()
    latest = _last_meal_log_date(db, user_id)
    if latest is None:
        return utc_today
    if latest >= utc_today:
        return latest
    if (utc_today - latest).days == 1:
        return latest
    return utc_today


def nutrition_day_has_meals(db: Session, user, log_date: date) -> bool:
    """True when the user logged at least one meal on this log date."""
    from src.routes.calories import _get_or_create_daily_log

    log = _get_or_create_daily_log(db, user, log_date)
    return db.query(MealEntry).filter(MealEntry.log_id == log.log_id).count() > 0


def nutrition_day_actuals(db: Session, user, log_date: date) -> dict[str, float]:
    """Return recalculated day totals — same path as GET /api/calories/daily-log."""
    from src.routes.calories import _get_or_create_daily_log, recalculate_daily_log

    log = _get_or_create_daily_log(db, user, log_date)
    recalculate_daily_log(db, log)
    db.flush()
    return {
        "protein_g": float(log.total_protein_g or 0),
        "calories": float(log.total_calories or 0),
        "target_protein_g": float(log.target_protein_g or 0),
        "target_calories": float(log.target_calories or 0),
    }
