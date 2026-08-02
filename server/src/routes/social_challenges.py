from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import Challenge, ChallengeParticipant, User
from src.services.social_challenge_service import (
    complete_expired_challenges,
    ensure_visible_challenge,
    is_challenge_visible_to_user,
    is_friend,
    leaderboard_for_user,
    notify_challenge_invite,
    refresh_challenge_progress,
    serialize_challenge,
    set_leaderboard_settings,
)
from src.utils.auth import get_current_user

leaderboard_router = APIRouter(prefix="/api/social/leaderboard", tags=["social-leaderboard"])
challenges_router = APIRouter(prefix="/api/social/challenges", tags=["social-challenges"])

ChallengeType = Literal["streak_battle", "workout_count"]


class LeaderboardSettingsPayload(BaseModel):
    opted_in: bool


class ChallengeCreatePayload(BaseModel):
    type: ChallengeType
    title: str = Field(..., min_length=1, max_length=160)
    target: int = Field(..., ge=1, le=365)
    duration_days: int = Field(..., ge=1, le=30)
    invite_user_ids: list[int] = Field(default_factory=list)


class ChallengeInvitePayload(BaseModel):
    user_ids: list[int] = Field(..., min_length=1)


def _get_user(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _challenge_or_404(db: Session, challenge_id: int, current_user: User) -> Challenge:
    challenge = ensure_visible_challenge(db, challenge_id, current_user.id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    return challenge


def _participant_or_404(db: Session, challenge_id: int, user_id: int) -> ChallengeParticipant:
    participant = (
        db.query(ChallengeParticipant)
        .filter(ChallengeParticipant.challenge_id == challenge_id, ChallengeParticipant.user_id == user_id)
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Challenge invite not found")
    return participant


def _invite_users(db: Session, challenge: Challenge, inviter: User, user_ids: list[int]) -> None:
    unique_ids: list[int] = []
    for user_id in user_ids:
        if user_id == inviter.id or user_id in unique_ids:
            continue
        unique_ids.append(user_id)
    invitees: list[User] = []
    for user_id in unique_ids:
        invitee = _get_user(db, user_id)
        if not is_friend(db, inviter.id, user_id):
            raise HTTPException(status_code=403, detail=f"User {user_id} is not your friend")
        invitees.append(invitee)
    for invitee in invitees:
        participant = (
            db.query(ChallengeParticipant)
            .filter(ChallengeParticipant.challenge_id == challenge.id, ChallengeParticipant.user_id == invitee.id)
            .first()
        )
        if participant and participant.status in {"invited", "joined"}:
            continue
        if participant:
            participant.status = "invited"
            participant.progress = 0
            participant.joined_at = None
            participant.target_reached_at = None
        else:
            participant = ChallengeParticipant(challenge_id=challenge.id, user_id=invitee.id, status="invited", progress=0)
            db.add(participant)
        db.flush()
        notify_challenge_invite(db, challenge, inviter, invitee)


@leaderboard_router.get("")
def get_leaderboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    complete_expired_challenges(db)
    return leaderboard_for_user(db, current_user.id)


@leaderboard_router.put("/settings")
def put_leaderboard_settings(
    payload: LeaderboardSettingsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"leaderboard": set_leaderboard_settings(db, current_user.id, payload.model_dump())}


@challenges_router.post("")
def create_challenge(
    payload: ChallengeCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = datetime.utcnow().date()
    challenge = Challenge(
        creator_id=current_user.id,
        type=payload.type,
        title=payload.title.strip(),
        target=payload.target,
        start_date=start,
        end_date=start + timedelta(days=payload.duration_days - 1),
        status="active",
    )
    db.add(challenge)
    db.flush()
    db.add(
        ChallengeParticipant(
            challenge_id=challenge.id,
            user_id=current_user.id,
            progress=0,
            status="joined",
            joined_at=datetime.utcnow(),
        )
    )
    db.flush()
    if payload.invite_user_ids:
        _invite_users(db, challenge, current_user, payload.invite_user_ids)
    db.commit()
    db.refresh(challenge)
    return {"challenge": serialize_challenge(db, challenge, current_user.id, include_standings=True)}


@challenges_router.get("")
def list_challenges(
    bucket: Literal["active", "invited"] = Query(default="active"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    complete_expired_challenges(db)
    query = db.query(Challenge).join(ChallengeParticipant, ChallengeParticipant.challenge_id == Challenge.id).filter(
        ChallengeParticipant.user_id == current_user.id,
        Challenge.status == "active",
    )
    if bucket == "invited":
        query = query.filter(ChallengeParticipant.status == "invited")
    else:
        query = query.filter(ChallengeParticipant.status == "joined")
    rows = query.order_by(Challenge.end_date.asc(), Challenge.created_at.desc()).all()
    rows = [challenge for challenge in rows if is_challenge_visible_to_user(db, challenge, current_user.id)]
    return {"items": [serialize_challenge(db, challenge, current_user.id) for challenge in rows]}


@challenges_router.get("/history")
def get_challenge_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    complete_expired_challenges(db)
    rows = (
        db.query(Challenge)
        .join(ChallengeParticipant, ChallengeParticipant.challenge_id == Challenge.id)
        .filter(
            ChallengeParticipant.user_id == current_user.id,
            ChallengeParticipant.status == "joined",
            Challenge.status == "completed",
        )
        .order_by(Challenge.end_date.desc(), Challenge.created_at.desc())
        .limit(50)
        .all()
    )
    rows = [challenge for challenge in rows if is_challenge_visible_to_user(db, challenge, current_user.id)]
    return {"items": [serialize_challenge(db, challenge, current_user.id) for challenge in rows]}


@challenges_router.get("/{challenge_id}/standings")
def get_challenge_standings(
    challenge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    refresh_challenge_progress(db, challenge)
    db.commit()
    db.refresh(challenge)
    return {"challenge": serialize_challenge(db, challenge, current_user.id, include_standings=True)}


@challenges_router.post("/{challenge_id}/invite")
def invite_challenge_friends(
    challenge_id: int,
    payload: ChallengeInvitePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    if challenge.status != "active":
        raise HTTPException(status_code=409, detail="Challenge is not active")
    participant = _participant_or_404(db, challenge.id, current_user.id)
    if participant.status != "joined":
        raise HTTPException(status_code=403, detail="Join the challenge before inviting friends")
    _invite_users(db, challenge, current_user, payload.user_ids)
    db.commit()
    db.refresh(challenge)
    return {"challenge": serialize_challenge(db, challenge, current_user.id, include_standings=True)}


@challenges_router.post("/{challenge_id}/accept")
def accept_challenge_invite(
    challenge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    if challenge.status != "active":
        raise HTTPException(status_code=409, detail="Challenge is not active")
    participant = _participant_or_404(db, challenge.id, current_user.id)
    if participant.status != "invited":
        raise HTTPException(status_code=409, detail="Challenge invite is not pending")
    participant.status = "joined"
    participant.joined_at = datetime.utcnow()
    db.add(participant)
    db.commit()
    db.refresh(challenge)
    return {"challenge": serialize_challenge(db, challenge, current_user.id, include_standings=True)}


@challenges_router.post("/{challenge_id}/decline")
def decline_challenge_invite(
    challenge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    participant = _participant_or_404(db, challenge.id, current_user.id)
    if participant.status != "invited":
        raise HTTPException(status_code=409, detail="Challenge invite is not pending")
    participant.status = "declined"
    db.add(participant)
    db.commit()
    return {"declined": True, "challenge_id": challenge.id}


@challenges_router.post("/{challenge_id}/leave")
def leave_challenge(
    challenge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    if challenge.creator_id == current_user.id:
        raise HTTPException(status_code=409, detail="Creator cannot leave their own challenge")
    participant = _participant_or_404(db, challenge.id, current_user.id)
    if participant.status != "joined":
        raise HTTPException(status_code=409, detail="You are not in this challenge")
    participant.status = "left"
    db.add(participant)
    db.commit()
    return {"left": True, "challenge_id": challenge.id}


@challenges_router.post("/{challenge_id}/cancel")
def cancel_challenge(
    challenge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _challenge_or_404(db, challenge_id, current_user)
    if challenge.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creator can cancel this challenge")
    if challenge.status != "active":
        raise HTTPException(status_code=409, detail="Challenge is not active")
    challenge.status = "cancelled"
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return {"challenge": serialize_challenge(db, challenge, current_user.id)}
