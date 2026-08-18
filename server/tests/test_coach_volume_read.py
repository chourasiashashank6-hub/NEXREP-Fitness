"""Parity guard: coach_volume_read matches workout_coach_data volume math."""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.main import _infer_muscles_from_workout
from src.models.models import User, Workout
from src.services.coach_volume_read import read_weekly_muscle_volume


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _ensure_user(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return int(user.id)
    user = User(email=email, password_hash="test", name="Coach Volume Read Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def _expected_volume_from_coach_data_logic(
    rows: list[Workout],
    *,
    now: datetime,
    db: Session,
) -> dict[str, int]:
    """Volume slice copied from workout_coach_data() — must stay in sync with main.py."""
    base_muscles = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"]
    week_since = now - timedelta(days=7)
    by_muscle_sets: dict[str, int] = {m: 0 for m in base_muscles}
    for workout in rows:
        muscles = _infer_muscles_from_workout(workout, db)
        sets = max(0, int(workout.sets or 0))
        for muscle in muscles:
            if muscle not in by_muscle_sets:
                continue
            if workout.date >= week_since:
                by_muscle_sets[muscle] += sets
    return by_muscle_sets


def test_read_weekly_muscle_volume_matches_workout_coach_data(db: Session):
    user_id = _ensure_user(db, "coach_volume_read@test.local")
    db.query(Workout).filter(Workout.user_id == user_id).delete()
    db.commit()

    now = datetime(2026, 8, 18, 12, 0, 0)
    workouts = [
        Workout(
            user_id=user_id,
            type="strength",
            exercise_name="Bench Press",
            sets=4,
            reps=8,
            date=now - timedelta(days=1),
            notes="source=workout_planner; body_part=Chest",
        ),
        Workout(
            user_id=user_id,
            type="strength",
            exercise_name="Lat Pulldown",
            sets=3,
            reps=10,
            date=now - timedelta(days=3),
            notes="source=workout_planner; body_part=Back",
        ),
        Workout(
            user_id=user_id,
            type="strength",
            exercise_name="Squat",
            sets=5,
            reps=5,
            date=now - timedelta(days=10),
            notes="source=workout_planner; body_part=Legs",
        ),
    ]
    db.add_all(workouts)
    db.commit()

    rows = (
        db.query(Workout)
        .filter(Workout.user_id == user_id, Workout.date >= now - timedelta(days=14))
        .order_by(Workout.date.desc())
        .all()
    )
    expected = _expected_volume_from_coach_data_logic(rows, now=now, db=db)
    actual_payload = read_weekly_muscle_volume(db, user_id, days=14, now=now)
    actual = actual_payload["byMuscleSets"]

    assert actual == expected
    assert actual_payload["totalWeeklySets"] == sum(expected.values())
    for item in actual_payload["weeklyVolume"]:
        assert item["sets"] == expected[item["muscle"]]

    db.query(Workout).filter(Workout.user_id == user_id).delete()
    db.commit()
