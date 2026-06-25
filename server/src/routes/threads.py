from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import Friendship, Message, Thread, ThreadJoinRequest, ThreadMember, ThreadMute, User, UserSupplementStack
from src.services.activity_feed_service import emit_activity_event
from src.services.notification_service import send_push_to_user
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/social/threads", tags=["social-threads"])

ThreadStatus = Literal["active", "completed", "cancelled"]
ThreadMemberRole = Literal["host", "member"]
ThreadMemberStatus = Literal["invited", "joined", "declined"]
ThreadVisibility = Literal["public", "private"]
THREAD_CREATION_DAILY_LIMIT = 10


class ThreadGymPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    place_id: str | None = Field(default=None, max_length=255)


class ThreadCreatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    gym: ThreadGymPayload
    scheduled_time: datetime
    visibility: ThreadVisibility = "private"
    max_members: int = Field(default=20, ge=1, le=100)
    invite_user_ids: list[int] = Field(default_factory=list)


class ThreadUpdatePayload(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    gym: ThreadGymPayload | None = None
    scheduled_time: datetime | None = None
    visibility: ThreadVisibility | None = None


class ThreadInvitePayload(BaseModel):
    user_ids: list[int] = Field(..., min_length=1)


class ThreadReferralPayload(BaseModel):
    code: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=4000)
    discount_text: str | None = Field(default=None, max_length=160)


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _public_user(user: User) -> dict[str, Any]:
    return {"user_id": user.id, "name": user.name, "initials": _initials(user.name), "profile_photo_url": user.profile_photo_url}


def _thread_deep_link(thread_id: int) -> str:
    return f"nexrep://social/threads/{thread_id}"


def _notification_title_snippet(title: str, limit: int = 50) -> str:
    value = (title or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip()


def _expires_at(scheduled_time: datetime) -> datetime:
    return scheduled_time + timedelta(hours=3)


def _now_for(value: datetime | None = None) -> datetime:
    if value and value.tzinfo is not None:
        return datetime.now(value.tzinfo)
    return datetime.utcnow()


def _is_friend(db: Session, left_id: int, right_id: int) -> bool:
    return (
        db.query(Friendship)
        .filter(
            Friendship.status == "accepted",
            or_(
                and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
                and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
            ),
        )
        .first()
        is not None
    )


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


def _is_blocked_between(db: Session, left_id: int, right_id: int) -> bool:
    return (
        db.query(Friendship)
        .filter(
            Friendship.status == "blocked",
            or_(
                and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
                and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
            ),
        )
        .first()
        is not None
    )


def _blocked_user_ids(db: Session, user_id: int) -> set[int]:
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == "blocked",
            or_(Friendship.user_id == user_id, Friendship.friend_id == user_id),
        )
        .all()
    )
    return {row.friend_id if row.user_id == user_id else row.user_id for row in rows}


def _member_row(db: Session, thread_id: int, user_id: int) -> ThreadMember | None:
    return db.query(ThreadMember).filter(ThreadMember.thread_id == thread_id, ThreadMember.user_id == user_id).first()


def _require_thread(db: Session, thread_id: int) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    _complete_expired_thread(db, thread)
    return thread


def _require_visible_thread(db: Session, thread_id: int, user_id: int) -> Thread:
    thread = _require_thread(db, thread_id)
    membership = _member_row(db, thread.id, user_id)
    if not membership:
        raise HTTPException(status_code=404, detail="Thread not found")
    if not _has_visible_other_member(db, thread.id, user_id):
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def _is_discoverable_thread(db: Session, thread: Thread, user_id: int) -> bool:
    if thread.host_user_id == user_id:
        return True
    if _is_blocked_between(db, user_id, thread.host_user_id):
        return False
    if thread.visibility == "public":
        return True
    return _is_friend(db, user_id, thread.host_user_id)


def _require_viewable_thread(db: Session, thread_id: int, user_id: int) -> Thread:
    thread = _require_thread(db, thread_id)
    membership = _member_row(db, thread.id, user_id)
    if membership:
        if not _has_visible_other_member(db, thread.id, user_id):
            raise HTTPException(status_code=404, detail="Thread not found")
        return thread
    if thread.status == "active" and _is_discoverable_thread(db, thread, user_id):
        return thread
    raise HTTPException(status_code=404, detail="Thread not found")


def _require_host(thread: Thread, current_user: User) -> None:
    if thread.host_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the host can do this")


def _active_member_count(db: Session, thread_id: int) -> int:
    return (
        db.query(ThreadMember)
        .filter(ThreadMember.thread_id == thread_id, ThreadMember.status.in_(["invited", "joined"]))
        .count()
    )


def _join_request_for_user(db: Session, thread_id: int, user_id: int) -> ThreadJoinRequest | None:
    return (
        db.query(ThreadJoinRequest)
        .filter(ThreadJoinRequest.thread_id == thread_id, ThreadJoinRequest.requester_user_id == user_id)
        .first()
    )


def _public_join_request(db: Session, request: ThreadJoinRequest, viewer_id: int) -> dict[str, Any]:
    user = request.requester
    return {
        "id": request.id,
        "thread_id": request.thread_id,
        "status": request.status,
        "created_at": request.created_at.isoformat() if request.created_at else None,
        "responded_at": request.responded_at.isoformat() if request.responded_at else None,
        "requester": {
            **_public_user(user),
            "mutual_friends_count": _mutual_friends_count(db, viewer_id, user.id),
        },
    }


def _check_thread_creation_rate_limit(db: Session, user_id: int) -> None:
    since = datetime.utcnow() - timedelta(days=1)
    count = db.query(Thread).filter(Thread.host_user_id == user_id, Thread.created_at >= since).count()
    if count >= THREAD_CREATION_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="Daily thread creation limit reached")


def _complete_expired_thread(db: Session, thread: Thread) -> None:
    if thread.status == "active" and thread.expires_at <= _now_for(thread.expires_at):
        thread.status = "completed"
        db.add(thread)
        db.commit()
        db.refresh(thread)


def _complete_expired_threads_for_user(db: Session, user_id: int) -> None:
    rows = (
        db.query(Thread)
        .join(ThreadMember, ThreadMember.thread_id == Thread.id)
        .filter(
            ThreadMember.user_id == user_id,
            Thread.status == "active",
            Thread.expires_at <= datetime.utcnow(),
        )
        .all()
    )
    if not rows:
        return
    for thread in rows:
        thread.status = "completed"
        db.add(thread)
    db.commit()


def _thread_users(db: Session, thread_id: int, statuses: list[str] | None = None) -> list[User]:
    query = db.query(User).join(ThreadMember, ThreadMember.user_id == User.id).filter(ThreadMember.thread_id == thread_id)
    if statuses:
        query = query.filter(ThreadMember.status.in_(statuses))
    return query.all()


def _has_visible_other_member(db: Session, thread_id: int, current_user_id: int) -> bool:
    members = (
        db.query(ThreadMember.user_id)
        .filter(
            ThreadMember.thread_id == thread_id,
            ThreadMember.user_id != current_user_id,
            ThreadMember.status.in_(["invited", "joined"]),
        )
        .all()
    )
    if not members:
        return True
    return any(not _is_blocked_between(db, current_user_id, row.user_id) for row in members)


def _notify_thread_user(
    db: Session,
    *,
    user_id: int,
    kind: str,
    title: str,
    body: str,
    thread: Thread,
    actor: User,
) -> None:
    send_push_to_user(
        db,
        user_id=user_id,
        category="social",
        title=title,
        body=body,
        event_key=f"thread:{kind}:{thread.id}:{user_id}:{int(datetime.utcnow().timestamp())}",
        data={
            "kind": kind,
            "thread_id": thread.id,
            "sender_id": actor.id,
            "sender_name": actor.name,
            "deep_link": _thread_deep_link(thread.id),
            "screen": "SocialThreadDetail",
        },
    )


def _notify_members(
    db: Session,
    *,
    thread: Thread,
    actor: User,
    kind: str,
    title: str,
    body: str,
    include_invited: bool = False,
    exclude_user_ids: set[int] | None = None,
) -> None:
    statuses = ["joined", "invited"] if include_invited else ["joined"]
    users = _thread_users(db, thread.id, statuses=statuses)
    excluded = exclude_user_ids or set()
    for user in users:
        if user.id in excluded:
            continue
        _notify_thread_user(db, user_id=user.id, kind=kind, title=title, body=body, thread=thread, actor=actor)


def _notify_join_request(db: Session, thread: Thread, requester: User) -> None:
    _notify_thread_user(
        db,
        user_id=thread.host_user_id,
        kind="thread_join_request",
        title="Join request",
        body=f"{requester.name} wants to join {_notification_title_snippet(thread.title)}.",
        thread=thread,
        actor=requester,
    )


def _serialize_member(member: ThreadMember, user: User) -> dict[str, Any]:
    return {
        **_public_user(user),
        "role": member.role,
        "status": member.status,
        "joined_at": member.joined_at.isoformat() if member.joined_at else None,
    }


def _serialize_referral(thread: Thread) -> dict[str, Any] | None:
    if not thread.referral_code:
        return None
    return {
        "code": thread.referral_code,
        "description": thread.referral_description,
        "discount_text": thread.referral_discount_text,
        "viewed_count": int(thread.referral_viewed_count or 0),
        "copied_count": int(thread.referral_copied_count or 0),
    }


def _serialize_thread(db: Session, thread: Thread, current_user_id: int, include_members: bool = False) -> dict[str, Any]:
    membership = _member_row(db, thread.id, current_user_id)
    host = db.query(User).filter(User.id == thread.host_user_id).first()
    join_request = _join_request_for_user(db, thread.id, current_user_id)
    mute = (
        db.query(ThreadMute)
        .filter(ThreadMute.thread_id == thread.id, ThreadMute.user_id == current_user_id)
        .first()
    )
    members = (
        db.query(ThreadMember, User)
        .join(User, User.id == ThreadMember.user_id)
        .filter(ThreadMember.thread_id == thread.id)
        .order_by(ThreadMember.role.desc(), ThreadMember.joined_at.asc().nullslast(), ThreadMember.id.asc())
        .all()
    )
    blocked_ids = _blocked_user_ids(db, current_user_id)
    visible_members = [(member, user) for member, user in members if user.id == current_user_id or user.id not in blocked_ids]
    joined_members = [member for member, _user in visible_members if member.status == "joined"]
    pending_join_request_count = 0
    if thread.host_user_id == current_user_id:
        pending_join_request_count = (
            db.query(ThreadJoinRequest)
            .filter(ThreadJoinRequest.thread_id == thread.id, ThreadJoinRequest.status == "pending")
            .count()
        )
    payload: dict[str, Any] = {
        "id": thread.id,
        "host_user_id": thread.host_user_id,
        "title": thread.title,
        "gym_name": thread.gym_name,
        "gym_place_id": thread.gym_place_id,
        "scheduled_time": thread.scheduled_time.isoformat(),
        "status": thread.status,
        "visibility": thread.visibility,
        "max_members": thread.max_members,
        "created_at": thread.created_at.isoformat() if thread.created_at else None,
        "expires_at": thread.expires_at.isoformat(),
        "member_count": len(joined_members),
        "going_count": len(joined_members),
        "muted": bool(mute),
        "current_user_role": membership.role if membership else None,
        "current_user_status": membership.status if membership else None,
        "is_host": thread.host_user_id == current_user_id,
        "is_member": membership is not None and membership.status in {"invited", "joined"},
        "pending_join_request_count": pending_join_request_count,
        "can_request_join": membership is None and thread.status == "active" and join_request is None and _is_discoverable_thread(db, thread, current_user_id),
        "join_request_status": join_request.status if join_request else None,
        "host": _public_user(host) if host else None,
        "member_preview": [_serialize_member(member, user) for member, user in visible_members if member.status == "joined"][:5],
        "referral": _serialize_referral(thread),
    }
    if include_members and membership:
        payload["members"] = [_serialize_member(member, user) for member, user in visible_members]
    if include_members and thread.host_user_id == current_user_id:
        pending_requests = (
            db.query(ThreadJoinRequest)
            .join(User, User.id == ThreadJoinRequest.requester_user_id)
            .filter(ThreadJoinRequest.thread_id == thread.id, ThreadJoinRequest.status == "pending")
            .order_by(ThreadJoinRequest.created_at.asc(), ThreadJoinRequest.id.asc())
            .all()
        )
        payload["pending_join_requests"] = [_public_join_request(db, request, current_user_id) for request in pending_requests]
    if membership and membership.status == "joined":
        summary_query = (
            db.query(UserSupplementStack.category, func.count(UserSupplementStack.id))
            .join(ThreadMember, ThreadMember.user_id == UserSupplementStack.user_id)
            .join(User, User.id == UserSupplementStack.user_id)
            .filter(
                ThreadMember.thread_id == thread.id,
                ThreadMember.status == "joined",
                User.stack_visibility.is_(True),
            )
        )
        if blocked_ids:
            summary_query = summary_query.filter(UserSupplementStack.user_id.notin_(blocked_ids))
        rows = (
            summary_query.group_by(UserSupplementStack.category)
            .order_by(func.count(UserSupplementStack.id).desc(), UserSupplementStack.category.asc())
            .all()
        )
        payload["stack_summary"] = [{"category": category, "count": count} for category, count in rows]
    return payload


def _add_system_message(db: Session, thread: Thread, actor: User, body: str, metadata: dict[str, Any] | None = None) -> None:
    db.add(
        Message(
            thread_id=thread.id,
            sender_id=actor.id,
            type="system",
            body=body,
            metadata_json=metadata or {},
        )
    )


def _ensure_invite_capacity(db: Session, thread: Thread, count: int) -> None:
    if _active_member_count(db, thread.id) + count > thread.max_members:
        raise HTTPException(status_code=409, detail="Thread is at max members")


def _apply_private_visibility_cascade(db: Session, thread: Thread, owner_id: int) -> None:
    friend_ids = _accepted_friend_ids(db, owner_id)
    keep_ids = friend_ids | {owner_id}
    non_friend_members = (
        db.query(ThreadMember)
        .filter(
            ThreadMember.thread_id == thread.id,
            ThreadMember.user_id != owner_id,
            ThreadMember.user_id.notin_(keep_ids or {-1}),
            ThreadMember.status.in_(["invited", "joined"]),
        )
        .all()
    )
    for member in non_friend_members:
        db.delete(member)

    pending_requests = (
        db.query(ThreadJoinRequest)
        .filter(
            ThreadJoinRequest.thread_id == thread.id,
            ThreadJoinRequest.status == "pending",
            ThreadJoinRequest.requester_user_id.notin_(keep_ids or {-1}),
        )
        .all()
    )
    for request in pending_requests:
        request.status = "declined"
        request.responded_at = datetime.utcnow()
        db.add(request)


def _invite_users(db: Session, thread: Thread, host: User, user_ids: list[int]) -> list[dict[str, Any]]:
    unique_ids = []
    seen = set()
    for user_id in user_ids:
        if user_id == host.id or user_id in seen:
            continue
        seen.add(user_id)
        unique_ids.append(user_id)
    _ensure_invite_capacity(db, thread, len(unique_ids))
    invited: list[dict[str, Any]] = []
    for user_id in unique_ids:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {user_id} not found")
        if not _is_friend(db, host.id, user_id):
            raise HTTPException(status_code=403, detail=f"User {user_id} is not your friend")
        existing = _member_row(db, thread.id, user_id)
        if existing and existing.status in {"invited", "joined"}:
            continue
        if existing:
            existing.status = "invited"
            existing.role = "member"
            existing.joined_at = None
            member = existing
        else:
            member = ThreadMember(thread_id=thread.id, user_id=user_id, role="member", status="invited")
            db.add(member)
        db.flush()
        invited.append(_serialize_member(member, user))
        _notify_thread_user(
            db,
            user_id=user_id,
            kind="thread_invite",
            title="Thread invite",
            body=f"{host.name} invited you to {_notification_title_snippet(thread.title)}.",
            thread=thread,
            actor=host,
        )
    return invited


@router.post("")
def create_thread(payload: ThreadCreatePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_thread_creation_rate_limit(db, current_user.id)
    thread = Thread(
        host_user_id=current_user.id,
        title=payload.title.strip(),
        gym_name=payload.gym.name.strip(),
        gym_place_id=(payload.gym.place_id or None),
        scheduled_time=payload.scheduled_time,
        status="active",
        visibility=payload.visibility,
        max_members=payload.max_members,
        expires_at=_expires_at(payload.scheduled_time),
    )
    db.add(thread)
    db.flush()
    db.add(
        ThreadMember(
            thread_id=thread.id,
            user_id=current_user.id,
            role="host",
            status="joined",
            joined_at=datetime.utcnow(),
        )
    )
    _add_system_message(db, thread, current_user, f"{current_user.name} created this thread.", {"event": "created"})
    db.flush()
    if payload.invite_user_ids:
        _invite_users(db, thread, current_user, payload.invite_user_ids)
    db.commit()
    db.refresh(thread)
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.put("/{thread_id}/referral")
def upsert_thread_referral(
    thread_id: int,
    payload: ThreadReferralPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    thread.referral_code = payload.code.strip()
    thread.referral_description = (payload.description or "").strip() or None
    thread.referral_discount_text = (payload.discount_text or "").strip() or None
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.delete("/{thread_id}/referral")
def remove_thread_referral(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    thread.referral_code = None
    thread.referral_description = None
    thread.referral_discount_text = None
    thread.referral_viewed_count = 0
    thread.referral_copied_count = 0
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/referral/view")
def increment_referral_view(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    if not thread.referral_code:
        raise HTTPException(status_code=404, detail="Referral not found")
    thread.referral_viewed_count = int(thread.referral_viewed_count or 0) + 1
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return {"referral": _serialize_referral(thread)}


@router.post("/{thread_id}/referral/copy")
def increment_referral_copy(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    if not thread.referral_code:
        raise HTTPException(status_code=404, detail="Referral not found")
    thread.referral_copied_count = int(thread.referral_copied_count or 0) + 1
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return {"referral": _serialize_referral(thread)}


@router.post("/{thread_id}/referral/share")
def share_thread_referral(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    membership = _member_row(db, thread.id, current_user.id)
    if not membership or membership.status != "joined":
        raise HTTPException(status_code=403, detail="Join the thread before sharing referrals")
    referral = _serialize_referral(thread)
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    message = Message(
        thread_id=thread.id,
        sender_id=current_user.id,
        type="referral",
        body=referral["discount_text"] or referral["code"],
        metadata_json={
            "thread_id": thread.id,
            "thread_title": thread.title,
            "code": referral["code"],
            "description": referral["description"],
            "discount_text": referral["discount_text"],
        },
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return {
        "message": {
            "id": message.id,
            "thread_id": message.thread_id,
            "dm_conversation_id": None,
            "sender": _public_user(current_user),
            "reply_to_message_id": None,
            "reply_to": None,
            "type": message.type,
            "body": message.body,
            "metadata": message.metadata_json or {},
            "created_at": message.created_at.isoformat() if message.created_at else None,
            "edited_at": None,
            "deleted_at": None,
            "deleted": False,
            "is_own": True,
            "read_by_me": True,
        }
    }


@router.get("")
def list_my_threads(
    bucket: Literal["active", "invited", "past", "all"] = Query(default="active"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _complete_expired_threads_for_user(db, current_user.id)
    query = (
        db.query(Thread)
        .join(ThreadMember, ThreadMember.thread_id == Thread.id)
        .filter(ThreadMember.user_id == current_user.id)
    )
    if bucket == "active":
        query = query.filter(Thread.status == "active", ThreadMember.status == "joined")
    elif bucket == "invited":
        query = query.filter(Thread.status == "active", ThreadMember.status == "invited")
    elif bucket == "past":
        query = query.filter(or_(Thread.status.in_(["completed", "cancelled"]), ThreadMember.status.in_(["declined"])))
    threads = query.order_by(Thread.scheduled_time.asc()).all()
    threads = [thread for thread in threads if _has_visible_other_member(db, thread.id, current_user.id)]
    return {"items": [_serialize_thread(db, thread, current_user.id) for thread in threads]}


@router.get("/discover")
def discover_threads(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    friend_ids = _accepted_friend_ids(db, current_user.id)
    blocked_ids = _blocked_user_ids(db, current_user.id)
    member_thread_ids = db.query(ThreadMember.thread_id).filter(ThreadMember.user_id == current_user.id)
    query = (
        db.query(Thread)
        .filter(
            Thread.status == "active",
            Thread.expires_at > datetime.utcnow(),
            Thread.id.notin_(member_thread_ids),
            Thread.host_user_id != current_user.id,
            or_(Thread.visibility == "public", and_(Thread.visibility == "private", Thread.host_user_id.in_(friend_ids or [-1]))),
        )
    )
    if blocked_ids:
        query = query.filter(Thread.host_user_id.notin_(blocked_ids))
    threads = query.order_by(Thread.scheduled_time.asc(), Thread.id.asc()).all()
    return {"items": [_serialize_thread(db, thread, current_user.id) for thread in threads]}


@router.get("/{thread_id}")
def get_thread_detail(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_viewable_thread(db, thread_id, current_user.id)
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/join-requests")
def request_to_join_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_viewable_thread(db, thread_id, current_user.id)
    if thread.status != "active":
        raise HTTPException(status_code=409, detail="Thread is not active")
    if thread.host_user_id == current_user.id or _member_row(db, thread.id, current_user.id):
        raise HTTPException(status_code=409, detail="Already in this thread")
    if not _is_discoverable_thread(db, thread, current_user.id):
        raise HTTPException(status_code=404, detail="Thread not found")
    existing = _join_request_for_user(db, thread.id, current_user.id)
    if existing:
        if existing.status == "pending":
            return {"request": _public_join_request(db, existing, current_user.id), "thread": _serialize_thread(db, thread, current_user.id)}
        raise HTTPException(status_code=409, detail="Join request already resolved")
    request = ThreadJoinRequest(thread_id=thread.id, requester_user_id=current_user.id, status="pending")
    db.add(request)
    db.commit()
    db.refresh(request)
    _notify_join_request(db, thread, current_user)
    return {"request": _public_join_request(db, request, current_user.id), "thread": _serialize_thread(db, thread, current_user.id)}


@router.post("/{thread_id}/join-requests/{request_id}/approve")
def approve_join_request(
    thread_id: int,
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    request = (
        db.query(ThreadJoinRequest)
        .filter(ThreadJoinRequest.id == request_id, ThreadJoinRequest.thread_id == thread.id, ThreadJoinRequest.status == "pending")
        .first()
    )
    if not request:
        raise HTTPException(status_code=404, detail="Join request not found")
    _ensure_invite_capacity(db, thread, 1)
    existing_member = _member_row(db, thread.id, request.requester_user_id)
    if existing_member:
        existing_member.status = "invited"
        existing_member.role = "member"
        existing_member.joined_at = None
        db.add(existing_member)
    else:
        db.add(ThreadMember(thread_id=thread.id, user_id=request.requester_user_id, role="member", status="invited"))
    request.status = "approved"
    request.responded_at = datetime.utcnow()
    db.add(request)
    db.commit()
    db.refresh(thread)
    requester = db.query(User).filter(User.id == request.requester_user_id).first()
    if requester:
        _notify_thread_user(
            db,
            user_id=requester.id,
            kind="thread_join_request_approved",
            title="Join request approved",
            body=f"{current_user.name} approved your request to join {_notification_title_snippet(thread.title)}.",
            thread=thread,
            actor=current_user,
        )
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/join-requests/{request_id}/decline")
def decline_join_request(
    thread_id: int,
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    request = (
        db.query(ThreadJoinRequest)
        .filter(ThreadJoinRequest.id == request_id, ThreadJoinRequest.thread_id == thread.id, ThreadJoinRequest.status == "pending")
        .first()
    )
    if not request:
        raise HTTPException(status_code=404, detail="Join request not found")
    request.status = "declined"
    request.responded_at = datetime.utcnow()
    db.add(request)
    db.commit()
    db.refresh(thread)
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.patch("/{thread_id}")
def edit_thread(
    thread_id: int,
    payload: ThreadUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    if thread.status != "active":
        raise HTTPException(status_code=409, detail="Thread is not active")
    old_visibility = thread.visibility
    if payload.title is not None:
        thread.title = payload.title.strip()
    if payload.gym is not None:
        thread.gym_name = payload.gym.name.strip()
        thread.gym_place_id = payload.gym.place_id or None
    if payload.visibility is not None:
        thread.visibility = payload.visibility
        if old_visibility == "public" and payload.visibility == "private":
            _apply_private_visibility_cascade(db, thread, current_user.id)
    if payload.scheduled_time is not None:
        old_time = thread.scheduled_time.isoformat() if thread.scheduled_time else None
        thread.scheduled_time = payload.scheduled_time
        thread.expires_at = _expires_at(payload.scheduled_time)
        _add_system_message(
            db,
            thread,
            current_user,
            f"{current_user.name} changed the thread time.",
            {"event": "time_changed", "old_time": old_time, "new_time": payload.scheduled_time.isoformat()},
        )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    _notify_members(
        db,
        thread=thread,
        actor=current_user,
        kind="thread_updated",
        title="Thread updated",
        body=f"{current_user.name} updated {_notification_title_snippet(thread.title)}.",
        include_invited=True,
        exclude_user_ids={current_user.id},
    )
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/cancel")
def cancel_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    if thread.status == "cancelled":
        return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}
    thread.status = "cancelled"
    db.add(thread)
    db.commit()
    db.refresh(thread)
    _notify_members(
        db,
        thread=thread,
        actor=current_user,
        kind="thread_cancelled",
        title="Thread cancelled",
        body=f"{current_user.name} cancelled {_notification_title_snippet(thread.title)}.",
        include_invited=True,
        exclude_user_ids={current_user.id},
    )
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/invite")
def invite_thread_friends(
    thread_id: int,
    payload: ThreadInvitePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    membership = _member_row(db, thread.id, current_user.id)
    if not membership or membership.status != "joined":
        raise HTTPException(status_code=403, detail="Join the thread before inviting friends")
    if thread.status != "active":
        raise HTTPException(status_code=409, detail="Thread is not active")
    invited = _invite_users(db, thread, current_user, payload.user_ids)
    db.commit()
    return {"invited": invited, "thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/accept")
def accept_thread_invite(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    if thread.status != "active":
        raise HTTPException(status_code=409, detail="Thread is not active")
    member = _member_row(db, thread.id, current_user.id)
    if not member or member.status != "invited":
        raise HTTPException(status_code=404, detail="Invite not found")
    _ensure_invite_capacity(db, thread, 0)
    member.status = "joined"
    member.joined_at = datetime.utcnow()
    db.add(member)
    _add_system_message(db, thread, current_user, f"{current_user.name} joined.", {"event": "joined"})
    db.commit()
    db.refresh(thread)
    emit_activity_event(
        db,
        user_id=current_user.id,
        event_type="thread_joined",
        payload={
            "thread_id": thread.id,
            "thread_title": thread.title,
            "gym_name": thread.gym_name,
            "scheduled_time": thread.scheduled_time.isoformat() if thread.scheduled_time else None,
        },
        identity_payload={"thread_id": thread.id},
    )
    return {"thread": _serialize_thread(db, thread, current_user.id, include_members=True)}


@router.post("/{thread_id}/decline")
def decline_thread_invite(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    member = _member_row(db, thread.id, current_user.id)
    if not member or member.status != "invited":
        raise HTTPException(status_code=404, detail="Invite not found")
    member.status = "declined"
    db.add(member)
    db.commit()
    return {"declined": True, "thread_id": thread.id}


@router.post("/{thread_id}/leave")
def leave_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    member = _member_row(db, thread.id, current_user.id)
    if not member or member.status != "joined":
        raise HTTPException(status_code=404, detail="Thread membership not found")
    was_host = member.role == "host"
    member.status = "declined"
    member.role = "member"
    member.joined_at = None
    db.add(member)
    db.flush()
    if was_host:
        next_host = (
            db.query(ThreadMember)
            .filter(ThreadMember.thread_id == thread.id, ThreadMember.status == "joined")
            .order_by(ThreadMember.joined_at.asc().nullslast(), ThreadMember.id.asc())
            .first()
        )
        if next_host:
            next_host.role = "host"
            thread.host_user_id = next_host.user_id
            db.add(next_host)
            db.add(thread)
            promoted = db.query(User).filter(User.id == next_host.user_id).first()
            if promoted:
                _notify_thread_user(
                    db,
                    user_id=promoted.id,
                    kind="thread_host_promoted",
                    title="You're now hosting",
                    body=f"You're now the host of {_notification_title_snippet(thread.title)}.",
                    thread=thread,
                    actor=current_user,
                )
        else:
            thread.status = "cancelled"
            db.add(thread)
    db.commit()
    return {"left": True, "thread_id": thread.id}


@router.delete("/{thread_id}/members/{user_id}")
def remove_thread_member(
    thread_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _require_thread(db, thread_id)
    _require_host(thread, current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Host cannot remove themselves")
    member = _member_row(db, thread.id, user_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
    return {"removed": True, "thread_id": thread.id, "user_id": user_id}


@router.post("/{thread_id}/mute")
def mute_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    existing = db.query(ThreadMute).filter(ThreadMute.thread_id == thread.id, ThreadMute.user_id == current_user.id).first()
    if not existing:
        db.add(ThreadMute(thread_id=thread.id, user_id=current_user.id))
        db.commit()
    return {"muted": True, "thread_id": thread.id}


@router.delete("/{thread_id}/mute")
def unmute_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = _require_visible_thread(db, thread_id, current_user.id)
    existing = db.query(ThreadMute).filter(ThreadMute.thread_id == thread.id, ThreadMute.user_id == current_user.id).first()
    if existing:
        db.delete(existing)
        db.commit()
    return {"muted": False, "thread_id": thread.id}
