from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import ActivityEvent, FeedReaction, User
from src.services.activity_feed_service import (
    accepted_friend_ids,
    get_feed_auto_share_settings,
    react_to_event,
    serialize_event,
    set_feed_auto_share_settings,
)
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/social/feed", tags=["social-feed"])

ReactionType = Literal["flame", "clap"]
REACTIONS_PER_HOUR_LIMIT = 100


class ReactionPayload(BaseModel):
    type: ReactionType


class FeedAutoSharePayload(BaseModel):
    share_prs: bool | None = None
    share_streak_milestones: bool | None = None
    share_thread_joins: bool | None = None


def _check_reaction_rate_limit(db: Session, user_id: int) -> None:
    since = datetime.utcnow() - timedelta(hours=1)
    count = db.query(FeedReaction).filter(FeedReaction.user_id == user_id, FeedReaction.created_at >= since).count()
    if count >= REACTIONS_PER_HOUR_LIMIT:
        raise HTTPException(status_code=429, detail="Reaction rate limit reached")


@router.get("")
def list_feed(
    before_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    friend_ids = accepted_friend_ids(db, current_user.id)
    if not friend_ids:
        return {"items": [], "next_before_id": None}
    query = (
        db.query(ActivityEvent)
        .filter(
            ActivityEvent.user_id.in_(friend_ids),
            ActivityEvent.visibility == "friends",
            ActivityEvent.deleted_at.is_(None),
        )
        .order_by(ActivityEvent.id.desc())
    )
    if before_id:
        query = query.filter(ActivityEvent.id < before_id)
    rows = query.limit(limit).all()
    return {
        "items": [serialize_event(db, event, current_user.id) for event in rows],
        "next_before_id": rows[-1].id if len(rows) == limit else None,
    }


@router.post("/{event_id}/reactions")
def create_reaction(
    event_id: int,
    payload: ReactionPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(ActivityEvent).filter(ActivityEvent.id == event_id, ActivityEvent.deleted_at.is_(None)).first()
    if not event:
        raise HTTPException(status_code=404, detail="Feed event not found")
    can_view = event.user_id == current_user.id or (
        event.visibility == "friends" and event.user_id in accepted_friend_ids(db, current_user.id)
    )
    if not can_view:
        raise HTTPException(status_code=404, detail="Feed event not found")
    _check_reaction_rate_limit(db, current_user.id)
    reaction = react_to_event(db, event=event, actor=current_user, reaction_type=payload.type)
    return {
        "reaction": {
            "event_id": reaction.event_id,
            "user_id": reaction.user_id,
            "type": reaction.type,
            "created_at": reaction.created_at.isoformat() if reaction.created_at else None,
        },
        "event": serialize_event(db, event, current_user.id),
    }


@router.delete("/{event_id}")
def delete_event(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(ActivityEvent).filter(ActivityEvent.id == event_id, ActivityEvent.user_id == current_user.id).first()
    if not event or event.deleted_at:
        raise HTTPException(status_code=404, detail="Feed event not found")
    event.deleted_at = datetime.utcnow()
    db.add(event)
    db.commit()
    return {"deleted": True, "event_id": event.id}


@router.get("/settings")
def get_feed_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"feed_auto_share": get_feed_auto_share_settings(db, current_user.id)}


@router.put("/settings")
def put_feed_settings(
    payload: FeedAutoSharePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current = get_feed_auto_share_settings(db, current_user.id)
    updates = payload.model_dump(exclude_none=True)
    return {"feed_auto_share": set_feed_auto_share_settings(db, current_user.id, {**current, **updates})}
