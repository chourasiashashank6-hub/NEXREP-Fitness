from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.services.progress_photo_service import (
    create_progress_photo,
    decode_progress_photo,
    delete_progress_photo,
    list_progress_photos,
    serialize_progress_photo,
)
from src.utils.auth import get_current_user
from src.utils.plan_check import require_feature

router = APIRouter(prefix="/api/progress-photos", tags=["progress-photos"])


class ProgressPhotoUploadRequest(BaseModel):
    base64: str
    mime_type: str = Field(default="image/jpeg")
    taken_at: datetime
    angle: str = Field(default="front", description="front | side")


@router.get("")
def get_progress_photos(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_feature(current_user, "progress_photos", db)
    items = [serialize_progress_photo(row) for row in list_progress_photos(db, current_user.id)]
    return {"items": items}


@router.post("")
def post_progress_photo(
    body: ProgressPhotoUploadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "progress_photos", db)
    data = decode_progress_photo(body.base64, body.mime_type)
    row = create_progress_photo(
        db,
        user_id=current_user.id,
        taken_at=body.taken_at,
        angle=body.angle,
        image_bytes=data,
    )
    return {"photo": serialize_progress_photo(row)}


@router.delete("/{photo_id}")
def remove_progress_photo(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "progress_photos", db)
    try:
        delete_progress_photo(db, current_user.id, photo_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not delete progress photo") from exc
    return {"deleted": True, "id": photo_id}
