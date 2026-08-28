"""Coach history depth for yearly unlock and partial-period labels."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.models import Workout
from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.utils.app_time import today_ist

YEARLY_UNLOCK_DAYS = 90


def _earliest_meal_log_date(db: Session, user_id: int) -> date | None:
    value = (
        db.query(func.min(DailyNutritionLog.log_date))
        .join(MealEntry, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id)
        .scalar()
    )
    return value if isinstance(value, date) else None


def _earliest_workout_date(db: Session, user_id: int) -> date | None:
    value = db.query(func.min(func.date(Workout.date))).filter(Workout.user_id == user_id).scalar()
    return value if isinstance(value, date) else None


def _span_days(earliest: date | None, anchor: date) -> int | None:
    if earliest is None:
        return None
    return max(0, (anchor - earliest).days + 1)


def coach_history_meta(db: Session, user_id: int, *, anchor: date | None = None) -> dict[str, int | bool | None]:
    anchor = anchor or today_ist()
    nutrition_start = _earliest_meal_log_date(db, user_id)
    workout_start = _earliest_workout_date(db, user_id)
    nutrition_days = _span_days(nutrition_start, anchor)
    workout_days = _span_days(workout_start, anchor)

    spans = [d for d in (nutrition_days, workout_days) if d is not None]
    history_days = max(spans) if spans else 0
    days_until = max(0, YEARLY_UNLOCK_DAYS - history_days)

    return {
        "history_days_nutrition": nutrition_days,
        "history_days_workout": workout_days,
        "history_days": history_days,
        "yearly_unlocked": history_days >= YEARLY_UNLOCK_DAYS,
        "days_until_yearly": days_until,
        "yearly_unlock_at_days": YEARLY_UNLOCK_DAYS,
    }
