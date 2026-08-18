"""Coach Journey Engine read API."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.db.session import get_db
from src.models.journey_event import JourneyEvent
from src.models.models import User
from src.services.journey_detection_service import run_journey_detection, run_journey_detection_for_user
from src.services.journey_engine_config import journey_engine_enabled
from src.services.journey_recommendations import recommendation_for_event
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/journey", tags=["journey"])


def _journey_table_ready(db: Session) -> bool:
    row = db.execute(
        text("SELECT to_regclass('public.journey_events') IS NOT NULL AS ready")
    ).mappings().first()
    return bool(row and row.get("ready"))


def _active_event_count(db: Session, user_id: int) -> int:
    return (
        db.query(JourneyEvent)
        .filter(JourneyEvent.user_id == user_id, JourneyEvent.status == "active")
        .count()
    )


def _serialize_event(row: JourneyEvent) -> dict:
    payload = row.payload_json if isinstance(row.payload_json, dict) else {}
    rec_key, rec_params = recommendation_for_event(row.event_type, payload)
    return {
        "id": row.id,
        "domain": row.domain,
        "event_type": row.event_type,
        "status": row.status,
        "detected_at": row.detected_at.isoformat() if row.detected_at else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "payload_json": payload,
        "recommendation_key": rec_key,
        "recommendation_params": rec_params,
    }


@router.get("/events")
def list_journey_events(
    domain: str | None = Query(default=None, max_length=32),
    status: str | None = Query(default=None, pattern="^(active|resolved)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not journey_engine_enabled():
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    query = db.query(JourneyEvent).filter(JourneyEvent.user_id == current_user.id)
    if domain:
        query = query.filter(JourneyEvent.domain == domain.strip().lower())
    if status:
        query = query.filter(JourneyEvent.status == status)
    total = query.count()
    rows = query.order_by(JourneyEvent.detected_at.desc()).offset(offset).limit(limit).all()
    return {
        "items": [_serialize_event(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/run-detection")
def run_journey_detection_now(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not journey_engine_enabled():
        raise HTTPException(status_code=503, detail="Journey engine is disabled")
    if not _journey_table_ready(db):
        raise HTTPException(status_code=503, detail="journey_events table missing — run alembic upgrade head")

    run_journey_detection_for_user(db, current_user, datetime.utcnow())
    db.commit()
    return {
        "ok": True,
        "user_id": current_user.id,
        "active_events": _active_event_count(db, current_user.id),
    }


@router.post("/run-detection-all")
def run_journey_detection_all(
    request: Request,
    db: Session = Depends(get_db),
):
    secret = request.headers.get("X-Dev-Secret", "")
    if secret != settings.DEV_TOGGLE_SECRET:
        raise HTTPException(status_code=403, detail="Not allowed")
    if not journey_engine_enabled():
        raise HTTPException(status_code=503, detail="Journey engine is disabled")
    if not _journey_table_ready(db):
        raise HTTPException(status_code=503, detail="journey_events table missing — run alembic upgrade head")

    run_journey_detection(db, datetime.utcnow())
    total_active = db.query(JourneyEvent).filter(JourneyEvent.status == "active").count()
    return {"ok": True, "active_events_total": total_active}
