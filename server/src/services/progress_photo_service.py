from __future__ import annotations

import base64
import re
import secrets
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.models.progress_photos import ProgressPhoto

PROGRESS_PHOTO_DIR = Path(__file__).resolve().parents[2] / "uploads" / "progress_photos"
PROGRESS_PHOTO_MAX_BYTES = 8 * 1024 * 1024
PROGRESS_PHOTO_LONG_EDGE = 1200
ALLOWED_ANGLES = {"front", "side"}


def ensure_progress_photo_dir() -> Path:
    PROGRESS_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    return PROGRESS_PHOTO_DIR


def decode_progress_photo(base64_data: str, mime_type: str) -> bytes:
    raw = (base64_data or "").strip()
    mime = (mime_type or "image/jpeg").strip().lower()
    data_uri = re.match(r"^data:(image/[\w.+-]+);base64,(.+)$", raw, flags=re.IGNORECASE)
    if data_uri:
        mime = data_uri.group(1).lower()
        raw = data_uri.group(2)
    raw = re.sub(r"\s+", "", raw)
    if mime not in ("image/jpeg", "image/jpg", "image/png", "image/webp"):
        raise HTTPException(status_code=422, detail="Unsupported image type. Use JPG or PNG.")
    try:
        data = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid image data.") from exc
    if len(data) > PROGRESS_PHOTO_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 8 MB).")
    if len(data) < 64:
        raise HTTPException(status_code=422, detail="Could not read this image.")
    return data


def save_progress_photo_file(user_id: int, data: bytes) -> str:
    try:
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Image processing is not available on this server.") from exc

    try:
        image = Image.open(BytesIO(data))
        image.verify()
        image = Image.open(BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not read this image. Please choose a JPG or PNG photo.") from exc

    w, h = image.size
    long_edge = max(w, h)
    if long_edge > PROGRESS_PHOTO_LONG_EDGE:
        scale = PROGRESS_PHOTO_LONG_EDGE / long_edge
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    filename = f"user_{user_id}_{secrets.token_hex(12)}.jpg"
    output_path = ensure_progress_photo_dir() / filename
    image.save(output_path, format="JPEG", quality=86, optimize=True)
    return f"/uploads/progress_photos/{filename}"


def remove_progress_photo_file(storage_path: str | None) -> None:
    if not storage_path or not storage_path.startswith("/uploads/progress_photos/"):
        return
    path = ensure_progress_photo_dir() / Path(storage_path).name
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def serialize_progress_photo(row: ProgressPhoto) -> dict[str, Any]:
    return {
        "id": row.id,
        "taken_at": row.taken_at.isoformat() if row.taken_at else None,
        "angle": row.angle,
        "storage_path": row.storage_path,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def create_progress_photo(
    db: Session,
    *,
    user_id: int,
    taken_at: datetime,
    angle: str,
    image_bytes: bytes,
) -> ProgressPhoto:
    angle_norm = (angle or "front").strip().lower()
    if angle_norm not in ALLOWED_ANGLES:
        raise HTTPException(status_code=400, detail="angle must be front or side")
    storage_path = save_progress_photo_file(user_id, image_bytes)
    row = ProgressPhoto(user_id=user_id, taken_at=taken_at, angle=angle_norm, storage_path=storage_path)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_progress_photos(db: Session, user_id: int) -> list[ProgressPhoto]:
    return (
        db.query(ProgressPhoto)
        .filter(ProgressPhoto.user_id == user_id)
        .order_by(ProgressPhoto.taken_at.desc(), ProgressPhoto.id.desc())
        .all()
    )


def delete_progress_photo(db: Session, user_id: int, photo_id: int) -> None:
    row = db.query(ProgressPhoto).filter(ProgressPhoto.id == photo_id, ProgressPhoto.user_id == user_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Progress photo not found")
    storage_path = row.storage_path
    db.delete(row)
    db.commit()
    remove_progress_photo_file(storage_path)
