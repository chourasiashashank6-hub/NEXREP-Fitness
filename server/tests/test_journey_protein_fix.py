"""Protein-gap detector uses recalculated nutrition actuals and log-local dates."""

from __future__ import annotations

from datetime import date, datetime, timedelta
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


def test_protein_gap_payload_uses_today_protein_not_oldest_streak_day(db: Session):
    user = _ensure_user(db, "journey_protein_today_display@test.local")
    today = date(2099, 9, 10)
    targets = {"target_protein_g": 165}

    # Three prior days with logged meals but under target, plus today — streak of 4.
    for offset, protein_g in [(0, 119.0), (1, 100.0), (2, 110.0), (3, 105.0)]:
        day = today - timedelta(days=offset)
        log = _get_or_create_daily_log(db, user, day)
        db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
        db.add(
            MealEntry(
                log_id=log.log_id,
                user_id=user.id,
                meal_type="lunch",
                source_type="database",
                food_name="Protein meal",
                quantity_g=Decimal("100"),
                calories_per_100g=Decimal("200"),
                protein_per_100g=Decimal(str(protein_g)),
                carbs_per_100g=Decimal("10"),
                fat_per_100g=Decimal("5"),
                fiber_per_100g=Decimal("1"),
                total_calories=Decimal("200"),
                total_protein_g=Decimal(str(protein_g)),
                total_carbs_g=Decimal("10"),
                total_fat_g=Decimal("5"),
                total_fiber_g=Decimal("1"),
            )
        )
        db.commit()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "src.services.journey_detection_service.get_calorie_log_targets",
            lambda _db, _user: targets,
        )
        detect_protein_gap_streak(db, user, today)
        db.commit()

    from src.models.journey_event import JourneyEvent

    row = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user.id,
            JourneyEvent.event_type == "protein_gap_streak",
            JourneyEvent.status == "active",
        )
        .one()
    )
    assert row.payload_json["protein_g"] == 119.0
    assert row.payload_json["streak_days"] >= 3


def test_protein_gap_ignores_days_without_meals(db: Session):
    """Three no-log days + one under-target logged day must not trigger a 5-day gap."""
    user = _ensure_user(db, "journey_protein_skip_empty@test.local")
    today = date(2099, 10, 5)
    targets = {"target_protein_g": 165}

    # Today: logged meal, under target (119g = 72% of 165).
    log_today = _get_or_create_daily_log(db, user, today)
    db.query(MealEntry).filter(MealEntry.log_id == log_today.log_id).delete()
    db.add(
        MealEntry(
            log_id=log_today.log_id,
            user_id=user.id,
            meal_type="lunch",
            source_type="database",
            food_name="Gap meal",
            quantity_g=Decimal("100"),
            calories_per_100g=Decimal("200"),
            protein_per_100g=Decimal("119"),
            carbs_per_100g=Decimal("10"),
            fat_per_100g=Decimal("5"),
            fiber_per_100g=Decimal("1"),
            total_calories=Decimal("200"),
            total_protein_g=Decimal("119"),
            total_carbs_g=Decimal("10"),
            total_fat_g=Decimal("5"),
            total_fiber_g=Decimal("1"),
        )
    )
    # Prior three days: daily log exists but zero meals (disengagement, not protein gap).
    for offset in (1, 2, 3):
        day = today - timedelta(days=offset)
        log = _get_or_create_daily_log(db, user, day)
        db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
        log.total_protein_g = Decimal("0")
    db.commit()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "src.services.journey_detection_service.get_calorie_log_targets",
            lambda _db, _user: targets,
        )
        detect_protein_gap_streak(db, user, today)
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
