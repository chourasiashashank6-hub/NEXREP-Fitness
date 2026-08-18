"""Coach Journey Engine — migration, API gate, detector idempotency."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from alembic import command
from alembic.config import Config
from src.core.config import settings
from src.db.session import SessionLocal, engine
from src.models.journey_event import JourneyEvent
from src.models.models import User
from src.routes.journey import list_journey_events
from src.services.journey_detection_service import (
    detect_protein_gap_streak,
    resolve_active_event,
    upsert_active_event,
)
from src.services.journey_engine_config import journey_engine_enabled


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
    user = User(email=email, password_hash="test", name="Journey Engine Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_journey_engine_disabled_by_default():
    assert journey_engine_enabled() is False


def test_list_journey_events_empty_when_flag_off(db: Session):
    user = _ensure_user(db, "journey_api@test.local")
    with patch("src.routes.journey.journey_engine_enabled", return_value=False):
        result = list_journey_events(
            domain=None,
            status=None,
            limit=20,
            offset=0,
            current_user=user,
            db=db,
        )
    assert result == {"items": [], "total": 0, "limit": 20, "offset": 0}


def test_journey_events_upsert_and_resolve(db: Session):
    user = _ensure_user(db, "journey_upsert@test.local")
    db.query(JourneyEvent).filter(JourneyEvent.user_id == user.id).delete()
    db.commit()

    first = upsert_active_event(
        db,
        user_id=user.id,
        domain="nutrition",
        event_type="protein_gap_streak",
        pattern_key="protein_gap",
        payload={"streak_days": 3, "protein_g": 40, "target_protein_g": 120},
    )
    second = upsert_active_event(
        db,
        user_id=user.id,
        domain="nutrition",
        event_type="protein_gap_streak",
        pattern_key="protein_gap",
        payload={"streak_days": 4, "protein_g": 42, "target_protein_g": 120},
    )
    db.commit()
    assert first.id == second.id
    assert second.payload_json["streak_days"] == 4

    resolve_active_event(
        db,
        user_id=user.id,
        domain="nutrition",
        event_type="protein_gap_streak",
        pattern_key="protein_gap",
    )
    db.commit()
    row = db.query(JourneyEvent).filter(JourneyEvent.id == first.id).one()
    assert row.status == "resolved"
    assert row.resolved_at is not None

    db.query(JourneyEvent).filter(JourneyEvent.user_id == user.id).delete()
    db.commit()


def test_journey_events_migration_upgrade_and_downgrade():
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
    command.upgrade(cfg, "030_journey_events")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.journey_events')")).scalar() is not None
    command.downgrade(cfg, "029_progress_photos")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.journey_events')")).scalar() is None
    command.upgrade(cfg, "030_journey_events")


def test_protein_gap_detector_resolves_when_target_met(db: Session):
    user = _ensure_user(db, "journey_protein@test.local")
    db.query(JourneyEvent).filter(JourneyEvent.user_id == user.id).delete()
    db.commit()

    with patch("src.services.journey_detection_service.get_calorie_log_targets", return_value={"target_protein_g": 0}):
        detect_protein_gap_streak(db, user, date.today())
        db.commit()

    active = (
        db.query(JourneyEvent)
        .filter(JourneyEvent.user_id == user.id, JourneyEvent.event_type == "protein_gap_streak", JourneyEvent.status == "active")
        .count()
    )
    assert active == 0

    db.query(JourneyEvent).filter(JourneyEvent.user_id == user.id).delete()
    db.commit()
