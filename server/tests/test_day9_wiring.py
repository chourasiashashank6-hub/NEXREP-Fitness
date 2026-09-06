"""Day 9 wiring tests — trial, yearly summary, stale status, journey resolve."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.orm import Session

from src.models.models import User
from src.routes.journey import resolve_journey_event
from src.services.coach_summary_service import build_yearly_review
from src.services.journey_detection_service import upsert_active_event
from src.services.meal_planner_service import meal_plan_stale_status
from src.services.subscription_service import start_trial, user_can_start_trial


def _ensure_user(db: Session, email: str) -> User:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return user
    user = User(email=email, password_hash="test", name="Day9 Test", plan_id="free")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_user_can_start_trial_for_free_user(db: Session):
    user = _ensure_user(db, "day9_trial@test.local")
    user.plan_id = "free"
    db.commit()
    assert user_can_start_trial(db, user.id) is True


def test_start_trial_upgrades_plan(db: Session):
    user = _ensure_user(db, "day9_trial_start@test.local")
    user.plan_id = "free"
    db.commit()
    sub = start_trial(db, user.id, plan_id="pro")
    db.refresh(user)
    assert sub.billing_cycle == "trial"
    assert (user.plan_id or "").lower() == "pro"
    assert user_can_start_trial(db, user.id) is False


def test_build_yearly_review_shape(db: Session):
    user = _ensure_user(db, "day9_yearly@test.local")
    payload = build_yearly_review(db, user, date(2026, 8, 31))
    assert payload["cadence"] == "yearly"
    assert "yearly" in payload
    assert "nutrition" in payload["yearly"]
    assert "workout" in payload["yearly"]


def test_meal_plan_stale_status_shape(db: Session):
    user = _ensure_user(db, "day9_stale@test.local")
    payload = meal_plan_stale_status(db, user, "2026-08-31")
    assert "is_stale" in payload
    assert "stale_fields" in payload
    assert isinstance(payload["stale_fields"], list)


def test_resolve_journey_event_marks_resolved(db: Session):
    user = _ensure_user(db, "day9_journey_resolve@test.local")
    row = upsert_active_event(
        db,
        user_id=user.id,
        domain="nutrition",
        event_type="protein_gap_streak",
        pattern_key="day9_pattern",
        payload={"streak_days": 3},
    )
    db.commit()
    result = resolve_journey_event(row.id, current_user=user, db=db)
    assert result["ok"] is True
    assert result["event"]["status"] == "resolved"
