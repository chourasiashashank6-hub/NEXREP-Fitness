from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.models.squads import Squad, SquadMember
from src.services.social_challenge_service import is_friend
from src.services.squad_service import (
    DEFAULT_MAX_MEMBERS,
    ensure_visible_squad,
    notify_squad_invite,
    parse_log_date,
    serialize_squad,
)
from src.utils.auth import get_current_user
from src.utils.plan_check import require_feature

router = APIRouter(prefix="/api/social/squads", tags=["gym-squads"])


class SquadCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    invite_user_ids: list[int] = Field(default_factory=list)
    max_members: int = Field(default=DEFAULT_MAX_MEMBERS, ge=2, le=12)


class SquadInvitePayload(BaseModel):
    user_ids: list[int] = Field(..., min_length=1)


class SquadSharePayload(BaseModel):
    share_status: bool


def _get_user(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _squad_or_404(db: Session, squad_id: int, current_user: User) -> Squad:
    squad = ensure_visible_squad(db, squad_id, current_user.id)
    if not squad:
        raise HTTPException(status_code=404, detail="Squad not found")
    return squad


def _member_or_404(db: Session, squad_id: int, user_id: int) -> SquadMember:
    member = (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad_id, SquadMember.user_id == user_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Squad membership not found")
    return member


def _invite_users(db: Session, squad: Squad, inviter: User, user_ids: list[int]) -> None:
    joined_count = (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad.id, SquadMember.status.in_(("invited", "joined")))
        .count()
    )
    unique_ids: list[int] = []
    for user_id in user_ids:
        if user_id == inviter.id or user_id in unique_ids:
            continue
        unique_ids.append(user_id)
    if joined_count + len(unique_ids) > int(squad.max_members or DEFAULT_MAX_MEMBERS):
        raise HTTPException(status_code=409, detail="Squad is full")
    for user_id in unique_ids:
        invitee = _get_user(db, user_id)
        if not is_friend(db, inviter.id, user_id):
            raise HTTPException(status_code=403, detail=f"User {user_id} is not your friend")
        member = (
            db.query(SquadMember)
            .filter(SquadMember.squad_id == squad.id, SquadMember.user_id == invitee.id)
            .first()
        )
        if member and member.status in {"invited", "joined"}:
            continue
        if member:
            member.status = "invited"
            member.joined_at = None
            member.role = "member"
        else:
            member = SquadMember(squad_id=squad.id, user_id=invitee.id, status="invited", role="member")
            db.add(member)
        db.flush()
        notify_squad_invite(db, squad, inviter, invitee)


@router.post("")
def create_squad(
    payload: SquadCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "gym_squads_create", db)
    squad = Squad(
        name=payload.name.strip(),
        creator_id=current_user.id,
        max_members=payload.max_members,
        status="active",
    )
    db.add(squad)
    db.flush()
    db.add(
        SquadMember(
            squad_id=squad.id,
            user_id=current_user.id,
            role="creator",
            status="joined",
            joined_at=datetime.utcnow(),
            share_status=False,
        )
    )
    db.flush()
    if payload.invite_user_ids:
        _invite_users(db, squad, current_user, payload.invite_user_ids)
    db.commit()
    db.refresh(squad)
    return {"squad": serialize_squad(db, squad, current_user.id, include_members=True)}


@router.get("")
def list_squads(
    bucket: Literal["active", "invited"] = Query(default="active"),
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = parse_log_date(local_date)
    query = (
        db.query(Squad)
        .join(SquadMember, SquadMember.squad_id == Squad.id)
        .filter(SquadMember.user_id == current_user.id, Squad.status == "active")
    )
    if bucket == "invited":
        query = query.filter(SquadMember.status == "invited")
    else:
        query = query.filter(SquadMember.status == "joined")
    rows = query.order_by(Squad.created_at.desc()).all()
    return {
        "items": [
            serialize_squad(db, squad, current_user.id, log_date=log_date, include_members=False)
            for squad in rows
        ],
        "log_date": log_date.isoformat(),
    }


@router.get("/{squad_id}")
def get_squad(
    squad_id: int,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    squad = _squad_or_404(db, squad_id, current_user)
    log_date = parse_log_date(local_date)
    return {"squad": serialize_squad(db, squad, current_user.id, log_date=log_date, include_members=True)}


@router.post("/{squad_id}/invite")
def invite_squad_friends(
    squad_id: int,
    payload: SquadInvitePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "gym_squads_create", db)
    squad = _squad_or_404(db, squad_id, current_user)
    if squad.status != "active":
        raise HTTPException(status_code=409, detail="Squad is not active")
    member = _member_or_404(db, squad.id, current_user.id)
    if member.status != "joined":
        raise HTTPException(status_code=403, detail="Join the squad before inviting friends")
    _invite_users(db, squad, current_user, payload.user_ids)
    db.commit()
    db.refresh(squad)
    return {"squad": serialize_squad(db, squad, current_user.id, include_members=True)}


@router.post("/{squad_id}/accept")
def accept_squad_invite(
    squad_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "gym_squads_join", db)
    squad = _squad_or_404(db, squad_id, current_user)
    if squad.status != "active":
        raise HTTPException(status_code=409, detail="Squad is not active")
    member = _member_or_404(db, squad.id, current_user.id)
    if member.status != "invited":
        raise HTTPException(status_code=409, detail="Squad invite is not pending")
    joined_count = (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad.id, SquadMember.status == "joined")
        .count()
    )
    if joined_count >= int(squad.max_members or DEFAULT_MAX_MEMBERS):
        raise HTTPException(status_code=409, detail="Squad is full")
    member.status = "joined"
    member.joined_at = datetime.utcnow()
    db.add(member)
    db.commit()
    db.refresh(squad)
    return {"squad": serialize_squad(db, squad, current_user.id, include_members=True)}


@router.post("/{squad_id}/decline")
def decline_squad_invite(
    squad_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    squad = _squad_or_404(db, squad_id, current_user)
    member = _member_or_404(db, squad.id, current_user.id)
    if member.status != "invited":
        raise HTTPException(status_code=409, detail="Squad invite is not pending")
    member.status = "declined"
    db.add(member)
    db.commit()
    return {"declined": True, "squad_id": squad.id}


@router.post("/{squad_id}/leave")
def leave_squad(
    squad_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    squad = _squad_or_404(db, squad_id, current_user)
    if squad.creator_id == current_user.id:
        raise HTTPException(status_code=409, detail="Creator cannot leave — cancel the squad instead")
    member = _member_or_404(db, squad.id, current_user.id)
    if member.status != "joined":
        raise HTTPException(status_code=409, detail="You are not in this squad")
    member.status = "left"
    member.share_status = False
    db.add(member)
    db.commit()
    return {"left": True, "squad_id": squad.id}


@router.put("/{squad_id}/share")
def update_squad_share_status(
    squad_id: int,
    payload: SquadSharePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    squad = _squad_or_404(db, squad_id, current_user)
    member = _member_or_404(db, squad.id, current_user.id)
    if member.status != "joined":
        raise HTTPException(status_code=409, detail="Join the squad before changing share status")
    member.share_status = bool(payload.share_status)
    db.add(member)
    db.commit()
    db.refresh(squad)
    return {"squad": serialize_squad(db, squad, current_user.id, include_members=True)}


@router.post("/{squad_id}/cancel")
def cancel_squad(
    squad_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    squad = _squad_or_404(db, squad_id, current_user)
    if squad.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creator can cancel this squad")
    if squad.status != "active":
        raise HTTPException(status_code=409, detail="Squad is not active")
    squad.status = "cancelled"
    db.add(squad)
    db.commit()
    db.refresh(squad)
    return {"squad": serialize_squad(db, squad, current_user.id, include_members=True)}
