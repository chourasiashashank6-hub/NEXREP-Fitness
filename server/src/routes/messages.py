from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import (
    DMConversation,
    DMConversationMember,
    Friendship,
    Message,
    Thread,
    ThreadMember,
    ThreadMute,
    User,
)
from src.services.notification_service import send_push_to_user
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/social/messages", tags=["social-messages"])

MessageType = Literal["text", "location", "referral", "workout_share", "stack_share", "system"]
MAX_MESSAGES_PER_HOUR = 200
PUSH_THROTTLE_SECONDS = 30


class SendMessagePayload(BaseModel):
    thread_id: int | None = Field(default=None, gt=0)
    dm_conversation_id: int | None = Field(default=None, gt=0)
    reply_to_message_id: int | None = Field(default=None, gt=0)
    type: MessageType = "text"
    body: str | None = Field(default=None, max_length=4000)
    metadata: dict[str, Any] | None = None


class MarkReadPayload(BaseModel):
    thread_id: int | None = Field(default=None, gt=0)
    dm_conversation_id: int | None = Field(default=None, gt=0)
    last_read_message_id: int = Field(..., gt=0)


class ConversationPayload(BaseModel):
    thread_id: int | None = Field(default=None, gt=0)
    dm_conversation_id: int | None = Field(default=None, gt=0)


class EditMessagePayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class DMStartPayload(BaseModel):
    user_id: int = Field(..., gt=0)


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _public_user(user: User) -> dict[str, Any]:
    return {"user_id": user.id, "name": user.name, "initials": _initials(user.name)}


def _relationship_between(db: Session, left_id: int, right_id: int) -> Friendship | None:
    return (
        db.query(Friendship)
        .filter(
            or_(
                and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
                and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
            )
        )
        .first()
    )


def _is_friend(db: Session, left_id: int, right_id: int) -> bool:
    row = _relationship_between(db, left_id, right_id)
    return bool(row and row.status == "accepted")


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


def _require_single_conversation(thread_id: int | None, dm_conversation_id: int | None) -> None:
    if bool(thread_id) == bool(dm_conversation_id):
        raise HTTPException(status_code=400, detail="Provide exactly one conversation")


def _thread_member(db: Session, thread_id: int, user_id: int) -> ThreadMember | None:
    return db.query(ThreadMember).filter(ThreadMember.thread_id == thread_id, ThreadMember.user_id == user_id).first()


def _dm_member(db: Session, conversation_id: int, user_id: int) -> DMConversationMember | None:
    return (
        db.query(DMConversationMember)
        .filter(DMConversationMember.dm_conversation_id == conversation_id, DMConversationMember.user_id == user_id)
        .first()
    )


def _require_thread_chat(db: Session, thread_id: int, user_id: int) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id).first()
    member = _thread_member(db, thread_id, user_id)
    if not thread or not member or member.status != "joined":
        raise HTTPException(status_code=404, detail="Thread chat not found")
    return thread


def _require_dm(db: Session, conversation_id: int, user_id: int) -> DMConversation:
    conversation = db.query(DMConversation).filter(DMConversation.id == conversation_id).first()
    member = _dm_member(db, conversation_id, user_id)
    if not conversation or not member:
        raise HTTPException(status_code=404, detail="DM conversation not found")
    return conversation


def _dm_other_member(db: Session, conversation_id: int, user_id: int) -> User | None:
    return (
        db.query(User)
        .join(DMConversationMember, DMConversationMember.user_id == User.id)
        .filter(DMConversationMember.dm_conversation_id == conversation_id, DMConversationMember.user_id != user_id)
        .first()
    )


def _ensure_can_message_participants(db: Session, sender_id: int, *, thread_id: int | None, dm_conversation_id: int | None) -> None:
    if dm_conversation_id:
        other = _dm_other_member(db, dm_conversation_id, sender_id)
        if not other or not _is_friend(db, sender_id, other.id) or _is_blocked_between(db, sender_id, other.id):
            raise HTTPException(status_code=403, detail="Cannot message this user")
        return
    if thread_id:
        participants = (
            db.query(ThreadMember.user_id)
            .filter(ThreadMember.thread_id == thread_id, ThreadMember.status == "joined", ThreadMember.user_id != sender_id)
            .all()
        )
        if any(_is_blocked_between(db, sender_id, row.user_id) for row in participants):
            raise HTTPException(status_code=403, detail="Cannot message blocked users")


def _check_message_rate_limit(db: Session, user_id: int) -> None:
    since = datetime.utcnow() - timedelta(hours=1)
    count = db.query(Message).filter(Message.sender_id == user_id, Message.created_at >= since).count()
    if count >= MAX_MESSAGES_PER_HOUR:
        raise HTTPException(status_code=429, detail="Message rate limit reached")


def _message_preview(message: Message) -> str:
    if message.deleted_at:
        return "Message deleted"
    if message.type == "text":
        return (message.body or "").strip()[:120]
    return message.type.replace("_", " ").title()


def _conversation_key(message: Message) -> str:
    if message.thread_id:
        return f"thread:{message.thread_id}"
    return f"dm:{message.dm_conversation_id}"


def _message_deep_link(message: Message) -> str:
    if message.thread_id:
        return f"nexrep://social/threads/{message.thread_id}/chat"
    return f"nexrep://social/messages/{message.dm_conversation_id}"


def _notify_message_recipients(db: Session, message: Message, sender: User) -> None:
    preview = _message_preview(message)
    window = int(datetime.utcnow().timestamp() // PUSH_THROTTLE_SECONDS)
    recipients: list[tuple[int, bool]] = []
    if message.thread_id:
        rows = (
            db.query(ThreadMember)
            .filter(ThreadMember.thread_id == message.thread_id, ThreadMember.status == "joined", ThreadMember.user_id != sender.id)
            .all()
        )
        muted_ids = {
            row.user_id
            for row in db.query(ThreadMute).filter(ThreadMute.thread_id == message.thread_id).all()
        }
        recipients = [(row.user_id, row.user_id in muted_ids) for row in rows]
    elif message.dm_conversation_id:
        rows = (
            db.query(DMConversationMember)
            .filter(DMConversationMember.dm_conversation_id == message.dm_conversation_id, DMConversationMember.user_id != sender.id)
            .all()
        )
        recipients = [(row.user_id, row.muted_at is not None) for row in rows]

    for user_id, muted in recipients:
        if muted:
            continue
        send_push_to_user(
            db,
            user_id=user_id,
            category="social",
            title=sender.name,
            body=preview,
            event_key=f"message:{_conversation_key(message)}:{user_id}:{window}",
            data={
                "kind": "message",
                "message_id": message.id,
                "thread_id": message.thread_id,
                "dm_conversation_id": message.dm_conversation_id,
                "sender_id": sender.id,
                "sender_name": sender.name,
                "screen": "SocialChat",
                "deep_link": _message_deep_link(message),
            },
        )


def _reply_preview(db: Session, message: Message, current_user_id: int) -> dict[str, Any] | None:
    if not message.reply_to_message_id:
        return None
    reply = db.query(Message).filter(Message.id == message.reply_to_message_id).first()
    if not reply:
        return None
    if _is_blocked_between(db, current_user_id, reply.sender_id):
        return None
    sender = db.query(User).filter(User.id == reply.sender_id).first()
    return {
        "id": reply.id,
        "sender": _public_user(sender) if sender else None,
        "type": reply.type,
        "body": None if reply.deleted_at else reply.body,
        "deleted": bool(reply.deleted_at),
    }


def _serialize_message(db: Session, message: Message, current_user_id: int) -> dict[str, Any]:
    sender = db.query(User).filter(User.id == message.sender_id).first()
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "dm_conversation_id": message.dm_conversation_id,
        "sender": _public_user(sender) if sender else {"user_id": message.sender_id, "name": "User", "initials": "U"},
        "reply_to_message_id": message.reply_to_message_id,
        "reply_to": _reply_preview(db, message, current_user_id),
        "type": message.type,
        "body": None if message.deleted_at else message.body,
        "metadata": message.metadata_json or {},
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
        "deleted": bool(message.deleted_at),
        "is_own": message.sender_id == current_user_id,
        "read_by_me": True,
    }


def _conversation_last_message(db: Session, *, thread_id: int | None = None, dm_conversation_id: int | None = None) -> Message | None:
    query = db.query(Message).filter(Message.deleted_at.is_(None))
    if thread_id:
        query = query.filter(Message.thread_id == thread_id)
    else:
        query = query.filter(Message.dm_conversation_id == dm_conversation_id)
    return query.order_by(Message.id.desc()).first()


def _unread_for_member(db: Session, *, user_id: int, thread_id: int | None = None, dm_conversation_id: int | None = None) -> int:
    if thread_id:
        member = _thread_member(db, thread_id, user_id)
        last_read = member.last_read_message_id if member else None
        query = db.query(Message).filter(Message.thread_id == thread_id)
    else:
        member = _dm_member(db, int(dm_conversation_id or 0), user_id)
        last_read = member.last_read_message_id if member else None
        query = db.query(Message).filter(Message.dm_conversation_id == dm_conversation_id)
    query = query.filter(Message.deleted_at.is_(None), Message.sender_id != user_id)
    if last_read:
        query = query.filter(Message.id > last_read)
    return query.count()


@router.post("")
def send_message(payload: SendMessagePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_single_conversation(payload.thread_id, payload.dm_conversation_id)
    if payload.thread_id:
        _require_thread_chat(db, payload.thread_id, current_user.id)
    if payload.dm_conversation_id:
        _require_dm(db, payload.dm_conversation_id, current_user.id)
    _ensure_can_message_participants(db, current_user.id, thread_id=payload.thread_id, dm_conversation_id=payload.dm_conversation_id)
    _check_message_rate_limit(db, current_user.id)
    body = (payload.body or "").strip()
    if payload.type == "text" and not body:
        raise HTTPException(status_code=400, detail="Message body is required")
    if payload.reply_to_message_id:
        reply = db.query(Message).filter(Message.id == payload.reply_to_message_id).first()
        if not reply or reply.thread_id != payload.thread_id or reply.dm_conversation_id != payload.dm_conversation_id:
            raise HTTPException(status_code=404, detail="Reply target not found")
    message = Message(
        thread_id=payload.thread_id,
        dm_conversation_id=payload.dm_conversation_id,
        sender_id=current_user.id,
        reply_to_message_id=payload.reply_to_message_id,
        type=payload.type,
        body=body or None,
        metadata_json=payload.metadata or {},
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    _notify_message_recipients(db, message, current_user)
    return {"message": _serialize_message(db, message, current_user.id)}


@router.get("")
def fetch_messages(
    thread_id: int | None = Query(default=None, gt=0),
    dm_conversation_id: int | None = Query(default=None, gt=0),
    before_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=40, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_single_conversation(thread_id, dm_conversation_id)
    if thread_id:
        _require_thread_chat(db, thread_id, current_user.id)
        query = db.query(Message).filter(Message.thread_id == thread_id)
    else:
        _require_dm(db, int(dm_conversation_id), current_user.id)
        other = _dm_other_member(db, int(dm_conversation_id), current_user.id)
        if other and _is_blocked_between(db, current_user.id, other.id):
            raise HTTPException(status_code=404, detail="DM conversation not found")
        query = db.query(Message).filter(Message.dm_conversation_id == dm_conversation_id)
    blocked_ids = _blocked_user_ids(db, current_user.id)
    if blocked_ids:
        query = query.filter(Message.sender_id.notin_(blocked_ids))
    if before_id:
        query = query.filter(Message.id < before_id)
    rows = query.order_by(Message.id.desc()).limit(limit).all()
    return {"items": [_serialize_message(db, message, current_user.id) for message in reversed(rows)]}


@router.post("/read")
def mark_read(payload: MarkReadPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_single_conversation(payload.thread_id, payload.dm_conversation_id)
    if payload.thread_id:
        _require_thread_chat(db, payload.thread_id, current_user.id)
        member = _thread_member(db, payload.thread_id, current_user.id)
    else:
        _require_dm(db, int(payload.dm_conversation_id), current_user.id)
        member = _dm_member(db, int(payload.dm_conversation_id), current_user.id)
    if not member:
        raise HTTPException(status_code=404, detail="Membership not found")
    member.last_read_message_id = max(int(member.last_read_message_id or 0), payload.last_read_message_id)
    db.add(member)
    db.commit()
    return {"read": True, "last_read_message_id": member.last_read_message_id}


@router.get("/unread-counts")
def unread_counts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    thread_rows = (
        db.query(ThreadMember)
        .filter(ThreadMember.user_id == current_user.id, ThreadMember.status == "joined")
        .all()
    )
    dm_rows = db.query(DMConversationMember).filter(DMConversationMember.user_id == current_user.id).all()
    threads = [
        {"thread_id": row.thread_id, "unread_count": _unread_for_member(db, user_id=current_user.id, thread_id=row.thread_id)}
        for row in thread_rows
    ]
    dms = [
        {
            "dm_conversation_id": row.dm_conversation_id,
            "unread_count": _unread_for_member(db, user_id=current_user.id, dm_conversation_id=row.dm_conversation_id),
        }
        for row in dm_rows
    ]
    total = sum(item["unread_count"] for item in threads) + sum(item["unread_count"] for item in dms)
    return {"total": total, "threads": threads, "dms": dms}


@router.patch("/{message_id}")
def edit_message(message_id: int, payload: EditMessagePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message or message.deleted_at:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the sender can edit this message")
    if message.type != "text":
        raise HTTPException(status_code=400, detail="Only text messages can be edited")
    if message.created_at < datetime.utcnow() - timedelta(minutes=15):
        raise HTTPException(status_code=403, detail="Edit window has expired")
    message.body = payload.body.strip()
    message.edited_at = datetime.utcnow()
    db.add(message)
    db.commit()
    db.refresh(message)
    return {"message": _serialize_message(db, message, current_user.id)}


@router.delete("/{message_id}")
def delete_message(message_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message or message.deleted_at:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the sender can delete this message")
    message.deleted_at = datetime.utcnow()
    message.body = None
    db.add(message)
    db.commit()
    return {"deleted": True, "message_id": message.id}


@router.post("/mute")
def mute_conversation(payload: ConversationPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_single_conversation(payload.thread_id, payload.dm_conversation_id)
    if payload.thread_id:
        _require_thread_chat(db, payload.thread_id, current_user.id)
        existing = db.query(ThreadMute).filter(ThreadMute.thread_id == payload.thread_id, ThreadMute.user_id == current_user.id).first()
        if not existing:
            db.add(ThreadMute(thread_id=payload.thread_id, user_id=current_user.id))
            db.commit()
        return {"muted": True, "thread_id": payload.thread_id}
    _require_dm(db, int(payload.dm_conversation_id), current_user.id)
    member = _dm_member(db, int(payload.dm_conversation_id), current_user.id)
    member.muted_at = datetime.utcnow()
    db.add(member)
    db.commit()
    return {"muted": True, "dm_conversation_id": payload.dm_conversation_id}


@router.delete("/mute")
def unmute_conversation(
    thread_id: int | None = Query(default=None, gt=0),
    dm_conversation_id: int | None = Query(default=None, gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_single_conversation(thread_id, dm_conversation_id)
    if thread_id:
        _require_thread_chat(db, thread_id, current_user.id)
        existing = db.query(ThreadMute).filter(ThreadMute.thread_id == thread_id, ThreadMute.user_id == current_user.id).first()
        if existing:
            db.delete(existing)
            db.commit()
        return {"muted": False, "thread_id": thread_id}
    _require_dm(db, int(dm_conversation_id), current_user.id)
    member = _dm_member(db, int(dm_conversation_id), current_user.id)
    member.muted_at = None
    db.add(member)
    db.commit()
    return {"muted": False, "dm_conversation_id": dm_conversation_id}


@router.post("/dm-conversations")
def start_or_get_dm(payload: DMStartPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    target = db.query(User).filter(User.id == payload.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_friend(db, current_user.id, target.id) or _is_blocked_between(db, current_user.id, target.id):
        raise HTTPException(status_code=403, detail="Can only DM friends")

    current_conversations = {
        row.dm_conversation_id
        for row in db.query(DMConversationMember).filter(DMConversationMember.user_id == current_user.id).all()
    }
    target_conversations = {
        row.dm_conversation_id
        for row in db.query(DMConversationMember).filter(DMConversationMember.user_id == target.id).all()
    }
    existing_ids = current_conversations & target_conversations
    if existing_ids:
        conversation = db.query(DMConversation).filter(DMConversation.id.in_(existing_ids)).order_by(DMConversation.id.asc()).first()
    else:
        conversation = DMConversation()
        db.add(conversation)
        db.flush()
        db.add_all(
            [
                DMConversationMember(dm_conversation_id=conversation.id, user_id=current_user.id),
                DMConversationMember(dm_conversation_id=conversation.id, user_id=target.id),
            ]
        )
        db.commit()
        db.refresh(conversation)
    return {"conversation": _serialize_dm_conversation(db, conversation, current_user.id)}


def _serialize_dm_conversation(db: Session, conversation: DMConversation, current_user_id: int) -> dict[str, Any]:
    member = _dm_member(db, conversation.id, current_user_id)
    other = _dm_other_member(db, conversation.id, current_user_id)
    last = _conversation_last_message(db, dm_conversation_id=conversation.id)
    return {
        "id": conversation.id,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
        "other_user": _public_user(other) if other else None,
        "muted": bool(member and member.muted_at),
        "last_read_message_id": member.last_read_message_id if member else None,
        "unread_count": _unread_for_member(db, user_id=current_user_id, dm_conversation_id=conversation.id),
        "last_message": _serialize_message(db, last, current_user_id) if last else None,
    }


@router.get("/dm-conversations")
def list_dm_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(DMConversation)
        .join(DMConversationMember, DMConversationMember.dm_conversation_id == DMConversation.id)
        .filter(DMConversationMember.user_id == current_user.id)
        .all()
    )
    rows = [
        conversation
        for conversation in rows
        if (other := _dm_other_member(db, conversation.id, current_user.id))
        and not _is_blocked_between(db, current_user.id, other.id)
    ]
    rows.sort(
        key=lambda conversation: (
            _conversation_last_message(db, dm_conversation_id=conversation.id).created_at
            if _conversation_last_message(db, dm_conversation_id=conversation.id)
            else conversation.created_at
        ),
        reverse=True,
    )
    return {"items": [_serialize_dm_conversation(db, conversation, current_user.id) for conversation in rows]}
