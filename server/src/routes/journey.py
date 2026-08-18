"""Coach Journey Engine read API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.journey_event import JourneyEvent
from src.models.models import User
from src.services.journey_engine_config import journey_engine_enabled
from src.services.journey_recommendations import recommendation_for_event
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/journey", tags=["journey"])


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
