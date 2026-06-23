from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import FriendRequestDailyCount, Friendship, User, UserReport
from src.services.notification_service import send_push_to_user
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/social", tags=["social"])

FRIEND_REQUEST_DAILY_LIMIT = 20
REPORT_DAILY_LIMIT = 5
FriendshipStatus = Literal["none", "pending_sent", "pending_received", "friends"]
ReportReason = Literal["harassment", "spam", "inappropriate_content", "fake_profile", "other"]
ReportContext = Literal["profile", "message", "thread"]


class TargetUserRequest(BaseModel):
    user_id: int = Field(..., gt=0)


class ReportUserRequest(BaseModel):
    reported_user_id: int = Field(..., gt=0)
    reason: ReportReason
    context: ReportContext
    reference_id: int | None = Field(default=None, gt=0)
    details: str | None = Field(default=None, max_length=4000)


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _relationship_query(db: Session, left_id: int, right_id: int):
    return db.query(Friendship).filter(
        or_(
            and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
            and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
        )
    )


def _relationship_between(db: Session, left_id: int, right_id: int) -> Friendship | None:
    return _relationship_query(db, left_id, right_id).first()


def _is_blocked_between(db: Session, left_id: int, right_id: int) -> bool:
    row = _relationship_between(db, left_id, right_id)
    return bool(row and row.status == "blocked")


def _accepted_friend_ids(db: Session, user_id: int) -> set[int]:
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == "accepted",
            or_(Friendship.user_id == user_id, Friendship.friend_id == user_id),
        )
        .all()
    )
    return {row.friend_id if row.user_id == user_id else row.user_id for row in rows}


def _mutual_friends_count(db: Session, viewer_id: int, target_id: int) -> int:
    return len(_accepted_friend_ids(db, viewer_id) & _accepted_friend_ids(db, target_id))


def _friendship_status_for_viewer(row: Friendship | None, viewer_id: int) -> FriendshipStatus:
    if not row:
        return "none"
    if row.status == "accepted":
        return "friends"
    if row.status == "pending":
        return "pending_sent" if row.user_id == viewer_id else "pending_received"
    return "none"


def _public_profile(db: Session, user: User, viewer_id: int) -> dict[str, Any]:
    row = _relationship_between(db, viewer_id, user.id)
    return {
        "user_id": user.id,
        "name": user.name,
        "initials": _initials(user.name),
        "friendship_status": _friendship_status_for_viewer(row, viewer_id),
        "mutual_friends_count": _mutual_friends_count(db, viewer_id, user.id),
    }


def _get_target_user(db: Session, target_user_id: int) -> User:
    user = db.query(User).filter(User.id == target_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _ensure_not_self(current_user: User, target_user_id: int) -> None:
    if current_user.id == target_user_id:
        raise HTTPException(status_code=400, detail="You cannot perform this action on yourself")


def _increment_friend_request_count(db: Session, user_id: int) -> None:
    today = datetime.utcnow().date()
    row = (
        db.query(FriendRequestDailyCount)
        .filter(
            FriendRequestDailyCount.user_id == user_id,
            FriendRequestDailyCount.request_date == today,
        )
        .first()
    )
    if not row:
        row = FriendRequestDailyCount(user_id=user_id, request_date=today, count=0)
        db.add(row)
        db.flush()
    if row.count >= FRIEND_REQUEST_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily friend request limit reached",
        )
    row.count += 1
    row.updated_at = datetime.utcnow()


def _check_report_rate_limit(db: Session, user_id: int) -> None:
    since = datetime.utcnow() - timedelta(days=1)
    count = db.query(UserReport).filter(UserReport.reporter_id == user_id, UserReport.created_at >= since).count()
    if count >= REPORT_DAILY_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Daily report limit reached")


def _send_friend_request_notification(db: Session, sender: User, receiver: User) -> None:
    send_push_to_user(
        db,
        user_id=receiver.id,
        category="social",
        title="New friend request",
        body=f"{sender.name} sent you a friend request.",
        event_key=f"friend-request:{sender.id}:{receiver.id}",
        data={
            "kind": "friend_request_received",
            "sender_id": sender.id,
            "sender_name": sender.name,
            "deep_link": "nexrep://social/pending-requests",
            "screen": "SocialPendingRequests",
        },
    )


def _send_friend_accept_notification(db: Session, accepter: User, requester: User) -> None:
    send_push_to_user(
        db,
        user_id=requester.id,
        category="social",
        title="Friend request accepted",
        body=f"{accepter.name} accepted your friend request.",
        event_key=f"friend-accepted:{requester.id}:{accepter.id}",
        data={
            "kind": "friend_request_accepted",
            "sender_id": accepter.id,
            "sender_name": accepter.name,
            "deep_link": "nexrep://social/pending-requests",
            "screen": "SocialPendingRequests",
        },
    )


@router.get("/users/search")
def search_users(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = q.strip()
    if not query:
        return {"items": []}
    blocked_rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == "blocked",
            or_(Friendship.user_id == current_user.id, Friendship.friend_id == current_user.id),
        )
        .all()
    )
    blocked_ids = {row.friend_id if row.user_id == current_user.id else row.user_id for row in blocked_rows}
    users = (
        db.query(User)
        .filter(User.id != current_user.id, User.id.notin_(blocked_ids or [-1]), User.name.ilike(f"%{query}%"))
        .order_by(User.name.asc(), User.id.asc())
        .limit(limit)
        .all()
    )
    return {"items": [_public_profile(db, user, current_user.id) for user in users]}


@router.post("/friend-requests")
def send_friend_request(
    payload: TargetUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, payload.user_id)
    target = _get_target_user(db, payload.user_id)
    row = _relationship_between(db, current_user.id, target.id)
    if row:
        if row.status == "blocked":
            raise HTTPException(status_code=403, detail="Cannot send a friend request")
        if row.status == "accepted":
            raise HTTPException(status_code=409, detail="Already friends")
        if row.status == "pending" and row.user_id == current_user.id:
            raise HTTPException(status_code=409, detail="Friend request already sent")
        raise HTTPException(status_code=409, detail="This user already sent you a friend request")

    _increment_friend_request_count(db, current_user.id)
    row = Friendship(user_id=current_user.id, friend_id=target.id, status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)
    _send_friend_request_notification(db, current_user, target)
    return {"request": _public_profile(db, target, current_user.id), "status": "pending_sent"}


@router.delete("/friend-requests/{target_user_id}")
def cancel_friend_request(
    target_user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, target_user_id)
    row = (
        db.query(Friendship)
        .filter(
            Friendship.user_id == current_user.id,
            Friendship.friend_id == target_user_id,
            Friendship.status == "pending",
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Pending sent request not found")
    db.delete(row)
    db.commit()
    return {"cancelled": True, "user_id": target_user_id}


@router.post("/friend-requests/{requester_user_id}/accept")
def accept_friend_request(
    requester_user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, requester_user_id)
    requester = _get_target_user(db, requester_user_id)
    row = (
        db.query(Friendship)
        .filter(
            Friendship.user_id == requester_user_id,
            Friendship.friend_id == current_user.id,
            Friendship.status == "pending",
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Incoming friend request not found")
    row.status = "accepted"
    row.accepted_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    _send_friend_accept_notification(db, current_user, requester)
    return {"friend": _public_profile(db, requester, current_user.id), "status": "friends"}


@router.post("/friend-requests/{requester_user_id}/decline")
def decline_friend_request(
    requester_user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, requester_user_id)
    row = (
        db.query(Friendship)
        .filter(
            Friendship.user_id == requester_user_id,
            Friendship.friend_id == current_user.id,
            Friendship.status == "pending",
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Incoming friend request not found")
    db.delete(row)
    db.commit()
    return {"declined": True, "user_id": requester_user_id}


@router.delete("/friends/{friend_user_id}")
def remove_friend(
    friend_user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, friend_user_id)
    row = _relationship_between(db, current_user.id, friend_user_id)
    if not row or row.status != "accepted":
        raise HTTPException(status_code=404, detail="Friendship not found")
    db.delete(row)
    db.commit()
    return {"removed": True, "user_id": friend_user_id}


@router.post("/block")
def block_user(
    payload: TargetUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, payload.user_id)
    target = _get_target_user(db, payload.user_id)
    row = _relationship_between(db, current_user.id, target.id)
    if row and row.status == "blocked" and row.user_id != current_user.id:
        return {"blocked": True, "user_id": target.id}
    if row:
        row.user_id = current_user.id
        row.friend_id = target.id
        row.status = "blocked"
        row.accepted_at = None
        row.updated_at = datetime.utcnow()
    else:
        row = Friendship(user_id=current_user.id, friend_id=target.id, status="blocked")
        db.add(row)
    db.commit()
    return {"blocked": True, "user_id": target.id}


@router.post("/reports")
def submit_report(
    payload: ReportUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_not_self(current_user, payload.reported_user_id)
    target = _get_target_user(db, payload.reported_user_id)
    _check_report_rate_limit(db, current_user.id)
    report = UserReport(
        reporter_id=current_user.id,
        reported_user_id=target.id,
        reason=payload.reason,
        context=payload.context,
        reference_id=payload.reference_id,
        details=(payload.details or "").strip() or None,
        status="open",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return {
        "report": {
            "id": report.id,
            "reported_user_id": report.reported_user_id,
            "reason": report.reason,
            "context": report.context,
            "reference_id": report.reference_id,
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "status": report.status,
        },
        "also_block": {
            "prompt": True,
            "user_id": target.id,
            "message": "Also block this user?",
        },
    }


@router.get("/friends")
def list_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == "accepted",
            or_(Friendship.user_id == current_user.id, Friendship.friend_id == current_user.id),
        )
        .order_by(Friendship.accepted_at.desc().nullslast(), Friendship.updated_at.desc())
        .all()
    )
    friend_ids = [row.friend_id if row.user_id == current_user.id else row.user_id for row in rows]
    users = db.query(User).filter(User.id.in_(friend_ids or [-1])).all()
    by_id = {user.id: user for user in users}
    return {"items": [_public_profile(db, by_id[user_id], current_user.id) for user_id in friend_ids if user_id in by_id]}


@router.get("/friend-requests")
def list_friend_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incoming_rows = (
        db.query(Friendship)
        .filter(Friendship.friend_id == current_user.id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    outgoing_rows = (
        db.query(Friendship)
        .filter(Friendship.user_id == current_user.id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    incoming_users = db.query(User).filter(User.id.in_([row.user_id for row in incoming_rows] or [-1])).all()
    outgoing_users = db.query(User).filter(User.id.in_([row.friend_id for row in outgoing_rows] or [-1])).all()
    incoming_by_id = {user.id: user for user in incoming_users}
    outgoing_by_id = {user.id: user for user in outgoing_users}
    return {
        "incoming": [
            {
                **_public_profile(db, incoming_by_id[row.user_id], current_user.id),
                "requested_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in incoming_rows
            if row.user_id in incoming_by_id
        ],
        "outgoing": [
            {
                **_public_profile(db, outgoing_by_id[row.friend_id], current_user.id),
                "requested_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in outgoing_rows
            if row.friend_id in outgoing_by_id
        ],
    }
