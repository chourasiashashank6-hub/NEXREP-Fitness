"""
NexRep — Body Type Images Router

Endpoints:
  GET    /body-type-images                → all slot URLs (public)
  POST   /admin/body-type-image           → upload photo   (admin only)
  DELETE /admin/body-type-image/{key}     → reset to SVG   (admin only)
"""
import os
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Header

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads" / "body_types"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_KEY = os.getenv("NEXREP_ADMIN_KEY", "change-me")

VALID_SLOTS = {
    "male_current_sk",
    "male_current_sf",
    "male_current_av",
    "male_current_ow",
    "male_current_ob",
    "male_current_mu",
    "male_goal_ln",
    "male_goal_at",
    "male_goal_mu",
    "male_goal_bk",
    "female_current_sk",
    "female_current_sf",
    "female_current_av",
    "female_current_cv",
    "female_current_ow",
    "female_current_ob",
    "female_goal_to",
    "female_goal_ln",
    "female_goal_at",
    "female_goal_sc",
}

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024

router = APIRouter()


def _admin(x_admin_key: str = Header(default="")):
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(403, "Admin access required")


@router.get("/body-type-images")
async def get_body_type_images() -> Dict[str, Optional[str]]:
    result: Dict[str, Optional[str]] = {}
    for slot in VALID_SLOTS:
        for ext in ("jpg", "png", "webp"):
            if (UPLOAD_DIR / f"{slot}.{ext}").exists():
                result[slot] = f"/uploads/body_types/{slot}.{ext}"
                break
        else:
            result[slot] = None
    return result


@router.post("/admin/body-type-image")
async def upload_body_type_image(
    file: UploadFile = File(...),
    slot_key: str = Form(...),
    x_admin_key: str = Header(default=""),
):
    _admin(x_admin_key)
    if slot_key not in VALID_SLOTS:
        raise HTTPException(400, f"Invalid slot_key '{slot_key}'")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Unsupported type. Use JPEG/PNG/WebP.")
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "File too large. Max 5 MB.")
    for ext in ("jpg", "png", "webp"):
        old = UPLOAD_DIR / f"{slot_key}.{ext}"
        if old.exists():
            old.unlink()
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[file.content_type]
    dest = UPLOAD_DIR / f"{slot_key}.{ext}"
    dest.write_bytes(content)
    return {
        "success": True,
        "slot_key": slot_key,
        "url": f"/uploads/body_types/{slot_key}.{ext}",
    }


@router.delete("/admin/body-type-image/{slot_key}")
async def delete_body_type_image(slot_key: str, x_admin_key: str = Header(default="")):
    _admin(x_admin_key)
    if slot_key not in VALID_SLOTS:
        raise HTTPException(400, f"Invalid slot_key '{slot_key}'")
    deleted = False
    for ext in ("jpg", "png", "webp"):
        p = UPLOAD_DIR / f"{slot_key}.{ext}"
        if p.exists():
            p.unlink()
            deleted = True
    if not deleted:
        raise HTTPException(404, "No custom image found.")
    return {"success": True, "slot_key": slot_key, "reverted_to": "svg_fallback"}
