"""Progress XP level math, reversal events, and calorie-target checks."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User, UserOnboarding, Workout
from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.models.xp import UserXpTotal, XpEvent
from src.services.xp_service import (
    XP_ALL_MEALS_LOGGED,
    XP_CALORIE_TARGET_HIT,
    XP_EXERCISE_LOGGED,
    XP_STREAK_DAY_BONUS,
    _calorie_target_hit,
    _reverse_xp_for_idempotency_key,
    award_xp_for_workout_log,
    level_for_total_xp,
    reevaluate_xp_after_meal_change,
    reverse_xp_for_workout_delete,
    xp_to_next_level,
)


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _db_rollback(db: Session):
    yield
    db.rollback()


def _ensure_user(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return int(user.id)
    user = User(email=email, password_hash="test", name="XP Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def _reset_user_xp(db: Session, user_id: int) -> None:
    db.query(XpEvent).filter(XpEvent.user_id == user_id).delete()
    db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).delete()
    db.commit()


def _seed_xp_award(
    db: Session,
    *,
    user_id: int,
    event_type: str,
    xp_amount: int,
    idempotency_key: str,
) -> None:
    totals = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).first()
    if totals is None:
        totals = UserXpTotal(user_id=user_id, total_xp=0, level=1, comeback_sessions_remaining=0)
        db.add(totals)
    db.add(
        XpEvent(
            user_id=user_id,
            event_type=event_type,
            xp_amount=xp_amount,
            metadata_json={"idempotency_key": idempotency_key},
        )
    )
    totals.total_xp = int(totals.total_xp or 0) + xp_amount
    totals.level = level_for_total_xp(int(totals.total_xp))
    db.commit()


def _get_or_create_daily_log(
    db: Session,
    *,
    user_id: int,
    log_date: date,
    target_calories: int = 2000,
    total_calories: float = 0,
) -> DailyNutritionLog:
    log = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date == log_date)
        .first()
    )
    if log:
        log.target_calories = target_calories
        log.total_calories = total_calories
        return log
    log = DailyNutritionLog(
        user_id=user_id,
        log_date=log_date,
        target_calories=target_calories,
        total_calories=total_calories,
    )
    db.add(log)
    return log


def _make_meal_entry(
    *,
    user_id: int,
    log_id: int,
    meal_type: str,
    food_name: str,
    quantity_g: float,
    total_calories: float,
) -> MealEntry:
    per100 = (total_calories / quantity_g) * 100 if quantity_g else 0
    return MealEntry(
        user_id=user_id,
        log_id=log_id,
        meal_type=meal_type,
        food_name=food_name,
        quantity_g=quantity_g,
        calories_per_100g=per100,
        protein_per_100g=10,
        carbs_per_100g=10,
        fat_per_100g=5,
        fiber_per_100g=1,
        total_calories=total_calories,
        total_protein_g=10,
        total_carbs_g=10,
        total_fat_g=5,
        total_fiber_g=1,
    )


def test_level_for_total_xp_boundaries():
    assert level_for_total_xp(0) == 1
    assert level_for_total_xp(149) == 1
    assert level_for_total_xp(150) == 2
    assert level_for_total_xp(4499) == 9
    assert level_for_total_xp(4500) == 10
    assert level_for_total_xp(99999) == 10


def test_xp_to_next_level_mid_level():
    into, needed = xp_to_next_level(200)
    assert into == 50
    assert needed == 200


def test_xp_to_next_level_max_level():
    into, needed = xp_to_next_level(5000)
    assert needed is None
    assert into >= 0


def test_calorie_target_hit_within_five_percent():
    class Log:
        target_calories = 2000
        total_calories = 2040

    assert _calorie_target_hit(Log()) is True


def test_calorie_target_hit_outside_five_percent():
    class Log:
        target_calories = 2000
        total_calories = 2110

    assert _calorie_target_hit(Log()) is False


def test_xp_constants_match_spec():
    assert XP_EXERCISE_LOGGED == 10
    assert XP_CALORIE_TARGET_HIT == 30
    assert XP_STREAK_DAY_BONUS == 15


def test_workout_xp_reversal_on_delete(db: Session):
    user_id = _ensure_user(db, "xp_reversal_workout@test.local")
    _reset_user_xp(db, user_id)

    workout = Workout(
        user_id=user_id,
        type="compound",
        exercise_name="Bench Press",
        sets=3,
        reps=10,
        date=datetime.utcnow(),
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)

    award_xp_for_workout_log(db, user_id=user_id, workout_id=workout.id)
    totals = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).one()
    assert int(totals.total_xp) == XP_EXERCISE_LOGGED

    reverse_xp_for_workout_delete(db, user_id=user_id, workout_id=workout.id)
    db.commit()
    db.refresh(totals)
    assert int(totals.total_xp) == 0

    events = (
        db.query(XpEvent)
        .filter(XpEvent.user_id == user_id)
        .order_by(XpEvent.id.asc())
        .all()
    )
    assert len(events) == 2
    assert events[0].xp_amount == XP_EXERCISE_LOGGED
    assert events[1].xp_amount == -XP_EXERCISE_LOGGED
    assert events[1].metadata_json["reverses_idempotency_key"] == f"workout:{workout.id}"


def test_workout_xp_reversal_is_idempotent(db: Session):
    user_id = _ensure_user(db, "xp_reversal_idempotent@test.local")
    _reset_user_xp(db, user_id)

    workout = Workout(
        user_id=user_id,
        type="compound",
        exercise_name="Squat",
        sets=3,
        reps=8,
        date=datetime.utcnow(),
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)

    award_xp_for_workout_log(db, user_id=user_id, workout_id=workout.id)
    reverse_xp_for_workout_delete(db, user_id=user_id, workout_id=workout.id)
    reverse_xp_for_workout_delete(db, user_id=user_id, workout_id=workout.id)
    db.commit()

    reversal_count = (
        db.query(XpEvent)
        .filter(
            XpEvent.user_id == user_id,
            XpEvent.xp_amount < 0,
        )
        .count()
    )
    assert reversal_count == 1


def test_level_stays_sticky_after_xp_reversal(db: Session):
    user_id = _ensure_user(db, "xp_sticky_level@test.local")
    _reset_user_xp(db, user_id)

    totals = UserXpTotal(user_id=user_id, total_xp=0, level=1, comeback_sessions_remaining=0)
    db.add(totals)
    db.commit()

    _reverse_xp_for_idempotency_key(db, user_id=user_id, idempotency_key="missing:key")
    award_event = XpEvent(
        user_id=user_id,
        event_type="exercise_logged",
        xp_amount=200,
        metadata_json={"idempotency_key": "workout:sticky-test"},
    )
    db.add(award_event)
    totals.total_xp = 200
    totals.level = level_for_total_xp(200)
    db.commit()
    assert int(totals.level) == 2

    _reverse_xp_for_idempotency_key(db, user_id=user_id, idempotency_key="workout:sticky-test")
    db.commit()
    db.refresh(totals)
    assert int(totals.total_xp) == 0
    assert int(totals.level) == 2


def test_meal_bonus_reversal_after_delete(db: Session):
    user_id = _ensure_user(db, "xp_reversal_meals@test.local")
    _reset_user_xp(db, user_id)

    log_date = date(2099, 3, 1)
    day_key = log_date.isoformat()
    _seed_xp_award(
        db,
        user_id=user_id,
        event_type="all_meals_logged",
        xp_amount=XP_ALL_MEALS_LOGGED,
        idempotency_key=f"daily:{day_key}:all_meals_logged",
    )

    _get_or_create_daily_log(db, user_id=user_id, log_date=log_date, total_calories=0)

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    if ob is None:
        ob = UserOnboarding(
            user_id=user_id,
            onboarding_json={"dietary": {"meals_per_day": 2}},
            targets_json={},
        )
        db.add(ob)
        db.commit()

    reevaluate_xp_after_meal_change(db, user_id=user_id, log_date=log_date)
    db.commit()

    totals = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).one()
    assert int(totals.total_xp) == 0
    reversed_types = {
        row.event_type
        for row in db.query(XpEvent).filter(XpEvent.user_id == user_id, XpEvent.xp_amount < 0).all()
    }
    assert "all_meals_logged_reversed" in reversed_types


def test_calorie_target_reversal_only_when_target_missed(db: Session):
    user_id = _ensure_user(db, "xp_reversal_calories@test.local")
    _reset_user_xp(db, user_id)

    log_date = date(2099, 3, 2)
    day_key = log_date.isoformat()
    _seed_xp_award(
        db,
        user_id=user_id,
        event_type="calorie_target_hit",
        xp_amount=XP_CALORIE_TARGET_HIT,
        idempotency_key=f"daily:{day_key}:calorie_target_hit",
    )

    _get_or_create_daily_log(db, user_id=user_id, log_date=log_date, total_calories=1800)
    db.commit()

    reevaluate_xp_after_meal_change(db, user_id=user_id, log_date=log_date)
    db.commit()

    totals = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).one()
    assert int(totals.total_xp) == 0


def test_streak_bonus_reversal_only_when_no_meals_left(db: Session):
    user_id = _ensure_user(db, "xp_reversal_streak@test.local")
    _reset_user_xp(db, user_id)

    log_date = date(2099, 3, 3)
    day_key = log_date.isoformat()
    _seed_xp_award(
        db,
        user_id=user_id,
        event_type="streak_day_bonus",
        xp_amount=XP_STREAK_DAY_BONUS,
        idempotency_key=f"daily:{day_key}:streak_day_bonus",
    )

    log = _get_or_create_daily_log(db, user_id=user_id, log_date=log_date, total_calories=200)
    db.flush()
    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    db.add(
        _make_meal_entry(
            user_id=user_id,
            log_id=log.log_id,
            meal_type="lunch",
            food_name="Salad",
            quantity_g=200,
            total_calories=200,
        )
    )
    db.commit()

    totals = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).one()
    before = int(totals.total_xp)
    reevaluate_xp_after_meal_change(db, user_id=user_id, log_date=log_date)
    db.commit()
    db.refresh(totals)
    assert int(totals.total_xp) == before

    db.query(MealEntry).filter(MealEntry.log_id == log.log_id).delete()
    log.total_calories = 0
    db.commit()
    reevaluate_xp_after_meal_change(db, user_id=user_id, log_date=log_date)
    db.commit()
    db.refresh(totals)
    assert int(totals.total_xp) == 0
    streak_reversed = (
        db.query(XpEvent)
        .filter(
            XpEvent.user_id == user_id,
            XpEvent.event_type == "streak_day_bonus_reversed",
        )
        .count()
    )
    assert streak_reversed == 1
