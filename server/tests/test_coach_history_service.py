"""Tests for coach history depth (yearly unlock)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User, Workout
from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.routes.calories import _get_or_create_daily_log
from src.services.coach_history_service import YEARLY_UNLOCK_DAYS, coach_history_meta


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _ensure_user(db: Session, email: str) -> User:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return user
    user = User(email=email, password_hash="test", name="Coach History Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_coach_history_meta_empty_user(db: Session):
    user = _ensure_user(db, "coach_history_empty@test.local")
    meta = coach_history_meta(db, user.id, anchor=date(2099, 12, 1))
    assert meta["history_days"] == 0
    assert meta["yearly_unlocked"] is False
    assert meta["days_until_yearly"] == YEARLY_UNLOCK_DAYS


def test_coach_history_meta_unlocks_after_90_days(db: Session):
    user = _ensure_user(db, "coach_history_unlock@test.local")
    anchor = date(2099, 12, 31)
    start = anchor - timedelta(days=YEARLY_UNLOCK_DAYS - 1)
    log = _get_or_create_daily_log(db, user, start)
    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    db.add(
        MealEntry(
            log_id=log.log_id,
            user_id=user.id,
            meal_type="lunch",
            source_type="database",
            food_name="Test",
            quantity_g=Decimal("100"),
            calories_per_100g=Decimal("100"),
            protein_per_100g=Decimal("10"),
            carbs_per_100g=Decimal("10"),
            fat_per_100g=Decimal("5"),
            fiber_per_100g=Decimal("1"),
            total_calories=Decimal("100"),
            total_protein_g=Decimal("10"),
            total_carbs_g=Decimal("10"),
            total_fat_g=Decimal("5"),
            total_fiber_g=Decimal("1"),
        )
    )
    db.commit()

    meta = coach_history_meta(db, user.id, anchor=anchor)
    assert meta["history_days_nutrition"] == YEARLY_UNLOCK_DAYS
    assert meta["yearly_unlocked"] is True
    assert meta["days_until_yearly"] == 0


def test_coach_history_uses_workout_dates(db: Session):
    user = _ensure_user(db, "coach_history_workout@test.local")
    anchor = date(2099, 11, 15)
    db.add(
        Workout(
            user_id=user.id,
            type="strength",
            exercise_name="Bench Press",
            sets=10,
            duration=45,
            date=datetime.combine(anchor - timedelta(days=2), datetime.min.time()),
        )
    )
    db.commit()
    meta = coach_history_meta(db, user.id, anchor=anchor)
    assert meta["history_days_workout"] == 3
    assert meta["history_days"] == 3
