"""Protein-gap detector uses recalculated nutrition actuals and log-local dates."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User
from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.routes.calories import _get_or_create_daily_log
from src.services.journey_detection_service import detect_protein_gap_streak
from src.services.nutrition_log_read import nutrition_day_actuals, resolve_user_log_today


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
    user = User(email=email, password_hash="test", name="Journey Protein Fix Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_nutrition_day_actuals_recalculates_from_meals(db: Session):
    user = _ensure_user(db, "journey_protein_recalc@test.local")
    day = date(2099, 6, 18)
    log = _get_or_create_daily_log(db, user, day)
    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    db.query(DailyNutritionLog).filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == day).delete()
    db.commit()

    log = _get_or_create_daily_log(db, user, day)
    log.total_protein_g = Decimal("0")
    db.add(
        MealEntry(
            log_id=log.log_id,
            user_id=user.id,
            meal_type="lunch",
            source_type="database",
            food_name="Tofu Miso Soup",
            quantity_g=Decimal("300"),
            calories_per_100g=Decimal("100"),
            protein_per_100g=Decimal("15.33"),
            carbs_per_100g=Decimal("10"),
            fat_per_100g=Decimal("5"),
            fiber_per_100g=Decimal("2"),
            total_calories=Decimal("300"),
            total_protein_g=Decimal("46"),
            total_carbs_g=Decimal("30"),
            total_fat_g=Decimal("15"),
            total_fiber_g=Decimal("6"),
        )
    )
    db.commit()

    actuals = nutrition_day_actuals(db, user, day)
    assert actuals["protein_g"] == 46.0


def test_resolve_user_log_today_prefers_latest_meal_log_date(db: Session):
    user = _ensure_user(db, "journey_log_today@test.local")
    day = date(2099, 7, 1)
    log = _get_or_create_daily_log(db, user, day)
    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    db.add(
        MealEntry(
            log_id=log.log_id,
            user_id=user.id,
            meal_type="dinner",
            source_type="database",
            food_name="Paneer",
            quantity_g=Decimal("100"),
            calories_per_100g=Decimal("200"),
            protein_per_100g=Decimal("20"),
            carbs_per_100g=Decimal("5"),
            fat_per_100g=Decimal("12"),
            fiber_per_100g=Decimal("1"),
            total_calories=Decimal("200"),
            total_protein_g=Decimal("20"),
            total_carbs_g=Decimal("5"),
            total_fat_g=Decimal("12"),
            total_fiber_g=Decimal("1"),
        )
    )
    db.commit()

    resolved = resolve_user_log_today(db, user.id, datetime(2099, 6, 30, 22, 0, 0))
    assert resolved == day


def test_protein_gap_resolves_when_recalculated_protein_meets_target(db: Session):
    user = _ensure_user(db, "journey_protein_resolve@test.local")
    day = date(2099, 8, 1)
    log = _get_or_create_daily_log(db, user, day)
    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    log.total_protein_g = Decimal("0")
    db.add(
        MealEntry(
            log_id=log.log_id,
            user_id=user.id,
            meal_type="lunch",
            source_type="database",
            food_name="High-Protein Chicken Biryani",
            quantity_g=Decimal("400"),
            calories_per_100g=Decimal("180"),
            protein_per_100g=Decimal("18.25"),
            carbs_per_100g=Decimal("20"),
            fat_per_100g=Decimal("8"),
            fiber_per_100g=Decimal("2"),
            total_calories=Decimal("720"),
            total_protein_g=Decimal("140"),
            total_carbs_g=Decimal("80"),
            total_fat_g=Decimal("32"),
            total_fiber_g=Decimal("8"),
        )
    )
    db.commit()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "src.services.journey_detection_service.get_calorie_log_targets",
            lambda _db, _user: {"target_protein_g": 165},
        )
        detect_protein_gap_streak(db, user, day)
        db.commit()

    from src.models.journey_event import JourneyEvent

    active = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user.id,
            JourneyEvent.event_type == "protein_gap_streak",
            JourneyEvent.status == "active",
        )
        .count()
    )
    assert active == 0
