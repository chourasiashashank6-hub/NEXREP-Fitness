"""Tests for progress photo backup service."""

from __future__ import annotations

import base64
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User
from src.models.progress_photos import ProgressPhoto
from src.services.progress_photo_service import create_progress_photo, delete_progress_photo, list_progress_photos


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _ensure_user(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return int(user.id)
    user = User(email=email, password_hash="test", name="Progress Photo Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def _tiny_jpeg() -> bytes:
    return base64.b64decode(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q=="
    )


def test_create_list_delete_progress_photo(db: Session):
    user_id = _ensure_user(db, "progress_photo_svc@test.local")
    db.query(ProgressPhoto).filter(ProgressPhoto.user_id == user_id).delete()
    db.commit()
    row = create_progress_photo(
        db,
        user_id=user_id,
        taken_at=datetime(2026, 8, 1, 12, 0, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        angle="front",
        image_bytes=_tiny_jpeg(),
    )
    assert row.id
    assert row.storage_path.startswith("/uploads/progress_photos/")
    items = list_progress_photos(db, user_id)
    assert any(item.id == row.id for item in items)
    delete_progress_photo(db, user_id, row.id)
    items_after = list_progress_photos(db, user_id)
    assert all(item.id != row.id for item in items_after)
