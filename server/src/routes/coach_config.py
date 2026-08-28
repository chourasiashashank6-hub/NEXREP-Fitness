"""Coach feature flags and config exposed to the mobile client."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from src.db.session import get_db
from src.models.models import User
from src.services.coach_history_service import coach_history_meta
from src.services.coach_redesign_config import coach_redesign_enabled
from src.services.coach_summary_service import build_coach_summary
from src.services.health_tips_service import select_health_tips
from src.utils.auth import get_current_user
from src.utils.app_time import today_ist

router = APIRouter(prefix="/api/coach", tags=["coach"])


@router.get("/config")
def get_coach_config() -> dict:
    """Public config for coach UI gating. Safe to call without auth."""
    return {
        "redesign_enabled": coach_redesign_enabled(),
    }


@router.get("/config/me")
def get_coach_config_me(
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Authenticated coach config including history depth for yearly unlock."""
    return {
        "redesign_enabled": coach_redesign_enabled(),
        **coach_history_meta(db, current_user.id),
    }


@router.get("/summary")
def get_coach_summary(
    domain: str = Query(default="nutrition", pattern="^(nutrition|workout)$"),
    cadence: str = Query(default="daily", pattern="^(daily|weekly|monthly|yearly)$"),
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    if not coach_redesign_enabled():
        raise HTTPException(status_code=404, detail="Coach redesign is not enabled")
    if cadence == "yearly":
        raise HTTPException(status_code=400, detail="Yearly summary is served by a dedicated endpoint in a later phase")
    try:
        anchor = date.fromisoformat(local_date) if local_date else today_ist()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid local_date") from exc

    return build_coach_summary(db, current_user, domain, cadence, anchor)


@router.get("/health-tips")
def get_health_tips(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    if not coach_redesign_enabled():
        raise HTTPException(status_code=404, detail="Coach redesign is not enabled")
    try:
        anchor = date.fromisoformat(local_date) if local_date else today_ist()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid local_date") from exc
    tips = select_health_tips(db, current_user, anchor)
    return {"tips": tips, "date": anchor.isoformat()}
