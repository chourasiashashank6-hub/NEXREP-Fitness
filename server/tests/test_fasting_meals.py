"""Tests for fasting-aware meal preferences."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User
from src.models.recipes import UserFastingPreference
from src.services.fasting_service import get_active_fasting_tag, upsert_fasting_preference


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
    user = User(email=email, password_hash="test", name="Fasting Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def test_active_fasting_tag(db: Session):
    user_id = _ensure_user(db, "fasting_svc@test.local")
    db.query(UserFastingPreference).filter(UserFastingPreference.user_id == user_id).delete()
    db.commit()

    upsert_fasting_preference(
        db,
        user_id,
        period_type="navratri",
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 9),
        active=True,
    )
    assert get_active_fasting_tag(db, user_id, "2026-03-05") == "fasting_navratri"
    assert get_active_fasting_tag(db, user_id, "2026-03-15") is None

    db.query(UserFastingPreference).filter(UserFastingPreference.user_id == user_id).delete()
    db.commit()
