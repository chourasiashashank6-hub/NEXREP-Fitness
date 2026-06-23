from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import Friendship, Thread, ThreadMember, User, UserSupplementStack
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/social/supplement-stacks", tags=["social-supplement-stacks"])

SupplementCategory = Literal["protein", "creatine", "preworkout", "bcaa", "multivitamin", "other"]
TimingType = Literal["time_of_day", "relative_to_workout", "custom_text"]


class StackItemPayload(BaseModel):
    category: SupplementCategory
    product_name: str = Field(..., min_length=1, max_length=255)
    quantity_note: str | None = Field(default=None, max_length=255)
    timing_type: TimingType
    timing_value: str | None = Field(default=None, max_length=255)
    sort_order: int | None = None


class StackReorderPayload(BaseModel):
    item_ids: list[int] = Field(..., min_length=1)


class StackVisibilityPayload(BaseModel):
    visible: bool


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


def _require_stack_item(db: Session, item_id: int, user_id: int) -> UserSupplementStack:
    item = db.query(UserSupplementStack).filter(UserSupplementStack.id == item_id, UserSupplementStack.user_id == user_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Stack item not found")
    return item


def _stack_items(db: Session, user_id: int) -> list[UserSupplementStack]:
    return (
        db.query(UserSupplementStack)
        .filter(UserSupplementStack.user_id == user_id)
        .order_by(UserSupplementStack.sort_order.asc(), UserSupplementStack.id.asc())
        .all()
    )


def _serialize_item(item: UserSupplementStack) -> dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "category": item.category,
        "product_name": item.product_name,
        "quantity_note": item.quantity_note,
        "timing_type": item.timing_type,
        "timing_value": item.timing_value,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _apply_payload(item: UserSupplementStack, payload: StackItemPayload) -> None:
    item.category = payload.category
    item.product_name = payload.product_name.strip()
    item.quantity_note = payload.quantity_note.strip() if payload.quantity_note else None
    item.timing_type = payload.timing_type
    item.timing_value = payload.timing_value.strip() if payload.timing_value else None
    if payload.sort_order is not None:
        item.sort_order = payload.sort_order
    item.updated_at = datetime.utcnow()


def _require_visible_thread_member(db: Session, thread_id: int, user_id: int) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id).first()
    member = (
        db.query(ThreadMember)
        .filter(ThreadMember.thread_id == thread_id, ThreadMember.user_id == user_id, ThreadMember.status == "joined")
        .first()
    )
    if not thread or not member:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@router.get("/me")
def get_my_stack(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "visible": bool(current_user.stack_visibility),
        "items": [_serialize_item(item) for item in _stack_items(db, current_user.id)],
    }


@router.post("/items")
def add_stack_item(payload: StackItemPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sort_order = payload.sort_order
    if sort_order is None:
        max_order = db.query(func.max(UserSupplementStack.sort_order)).filter(UserSupplementStack.user_id == current_user.id).scalar()
        sort_order = int(max_order or 0) + 1
    item = UserSupplementStack(user_id=current_user.id, sort_order=sort_order)
    _apply_payload(item, payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"item": _serialize_item(item)}


@router.patch("/items/{item_id}")
def update_stack_item(
    item_id: int,
    payload: StackItemPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _require_stack_item(db, item_id, current_user.id)
    _apply_payload(item, payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"item": _serialize_item(item)}


@router.delete("/items/{item_id}")
def remove_stack_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = _require_stack_item(db, item_id, current_user.id)
    db.delete(item)
    db.commit()
    return {"deleted": True, "item_id": item_id}


@router.post("/reorder")
def reorder_stack(payload: StackReorderPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = _stack_items(db, current_user.id)
    by_id = {item.id: item for item in items}
    if set(payload.item_ids) != set(by_id):
        raise HTTPException(status_code=400, detail="Reorder payload must include all stack items")
    for index, item_id in enumerate(payload.item_ids):
        item = by_id[item_id]
        item.sort_order = index
        item.updated_at = datetime.utcnow()
        db.add(item)
    db.commit()
    return {"items": [_serialize_item(item) for item in _stack_items(db, current_user.id)]}


@router.patch("/visibility")
def toggle_visibility(
    payload: StackVisibilityPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.stack_visibility = payload.visible
    db.add(current_user)
    db.commit()
    return {"visible": bool(current_user.stack_visibility)}


@router.get("/users/{user_id}")
def get_friend_stack(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if _is_blocked_between(db, current_user.id, target.id):
        raise HTTPException(status_code=403, detail="Stack is not visible")
    visible = bool(target.stack_visibility) and _is_friend(db, current_user.id, target.id)
    return {
        "user": _public_user(target),
        "visible": visible,
        "items": [_serialize_item(item) for item in _stack_items(db, target.id)] if visible else [],
    }


@router.get("/threads/{thread_id}/summary")
def get_thread_stack_summary(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_visible_thread_member(db, thread_id, current_user.id)
    blocked_ids = _blocked_user_ids(db, current_user.id)
    query = (
        db.query(UserSupplementStack.category, func.count(UserSupplementStack.id))
        .join(ThreadMember, ThreadMember.user_id == UserSupplementStack.user_id)
        .join(User, User.id == UserSupplementStack.user_id)
        .filter(ThreadMember.thread_id == thread_id, ThreadMember.status == "joined", User.stack_visibility.is_(True))
    )
    if blocked_ids:
        query = query.filter(UserSupplementStack.user_id.notin_(blocked_ids))
    rows = query.group_by(UserSupplementStack.category).order_by(func.count(UserSupplementStack.id).desc(), UserSupplementStack.category.asc()).all()
    return {"thread_id": thread_id, "items": [{"category": category, "count": count} for category, count in rows]}


@router.get("/threads/{thread_id}/details")
def get_thread_stack_details(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_visible_thread_member(db, thread_id, current_user.id)
    blocked_ids = _blocked_user_ids(db, current_user.id)
    members = (
        db.query(ThreadMember, User)
        .join(User, User.id == ThreadMember.user_id)
        .filter(ThreadMember.thread_id == thread_id, ThreadMember.status == "joined")
        .order_by(ThreadMember.role.desc(), ThreadMember.joined_at.asc().nullslast(), ThreadMember.id.asc())
        .all()
    )
    result = []
    for member, user in members:
        if user.id != current_user.id and user.id in blocked_ids:
            continue
        shared = bool(user.stack_visibility)
        result.append(
            {
                "user": {**_public_user(user), "role": member.role},
                "shared": shared,
                "items": [_serialize_item(item) for item in _stack_items(db, user.id)] if shared else [],
            }
        )
    return {"thread_id": thread_id, "members": result}
