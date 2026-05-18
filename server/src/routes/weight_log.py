from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.weight_log import WeightLog
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/weight", tags=["weight"])


class WeightLogRequest(BaseModel):
    weight_kg: float
    log_date: str
    note: Optional[str] = None
    unit_system: Optional[str] = "metric"


class WeightLogResponse(BaseModel):
    id: int
    weight_kg: float
    weight_lb: float
    log_date: str
    note: Optional[str]
    logged_at: str
    change_kg: Optional[float]
    change_label: Optional[str]


@router.post("/log", response_model=WeightLogResponse)
async def log_weight(
    request: WeightLogRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Log or update today's weight. One entry per day — upsert behavior."""
    if request.weight_kg <= 0 or request.weight_kg > 500:
        raise HTTPException(status_code=400, detail="Invalid weight value")

    weight_lb = round(request.weight_kg * 2.20462, 1)

    existing = (
        db.query(WeightLog)
        .filter(
            WeightLog.user_id == current_user.id,
            WeightLog.log_date == request.log_date,
        )
        .first()
    )

    if existing:
        existing.weight_kg = request.weight_kg
        existing.weight_lb = weight_lb
        existing.note = request.note
        existing.unit_system = request.unit_system or "metric"
        entry = existing
    else:
        entry = WeightLog(
            user_id=current_user.id,
            weight_kg=request.weight_kg,
            weight_lb=weight_lb,
            unit_system=request.unit_system or "metric",
            note=request.note,
            log_date=request.log_date,
        )
        db.add(entry)

    current_user.weight = request.weight_kg
    db.commit()
    db.refresh(entry)

    prev = (
        db.query(WeightLog)
        .filter(
            WeightLog.user_id == current_user.id,
            WeightLog.log_date < request.log_date,
        )
        .order_by(WeightLog.log_date.desc())
        .first()
    )

    change_kg = None
    change_label = None
    if prev:
        change_kg = round(entry.weight_kg - prev.weight_kg, 1)
        if change_kg > 0:
            change_label = f"+{change_kg}kg since last log"
        elif change_kg < 0:
            change_label = f"{change_kg}kg since last log"
        else:
            change_label = "No change since last log"

    return {
        "id": entry.id,
        "weight_kg": entry.weight_kg,
        "weight_lb": entry.weight_lb,
        "log_date": entry.log_date,
        "note": entry.note,
        "logged_at": entry.logged_at.isoformat() if entry.logged_at else None,
        "change_kg": change_kg,
        "change_label": change_label,
    }


@router.get("/history")
async def get_weight_history(
    days: int = 90,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns weight log history for the past N days, most recent first."""
    since = (date.today() - timedelta(days=days)).isoformat()

    logs = (
        db.query(WeightLog)
        .filter(
            WeightLog.user_id == current_user.id,
            WeightLog.log_date >= since,
        )
        .order_by(WeightLog.log_date.asc())
        .all()
    )

    entries = [
        {
            "id": log.id,
            "weight_kg": log.weight_kg,
            "weight_lb": log.weight_lb,
            "log_date": log.log_date,
            "note": log.note,
        }
        for log in logs
    ]

    if entries:
        weights = [entry["weight_kg"] for entry in entries]
        first_weight = weights[0]
        latest_weight = weights[-1]
        total_change = round(latest_weight - first_weight, 1)
        lowest = min(weights)
        highest = max(weights)
    else:
        first_weight = latest_weight = total_change = lowest = highest = None

    return {
        "entries": entries,
        "total_entries": len(entries),
        "latest_weight_kg": latest_weight,
        "first_weight_kg": first_weight,
        "total_change_kg": total_change,
        "lowest_kg": lowest,
        "highest_kg": highest,
        "days_requested": days,
    }


@router.get("/latest")
async def get_latest_weight(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns the most recent weight log entry."""
    latest = (
        db.query(WeightLog)
        .filter(WeightLog.user_id == current_user.id)
        .order_by(WeightLog.log_date.desc())
        .first()
    )

    if not latest:
        return {
            "weight_kg": current_user.weight,
            "weight_lb": round(current_user.weight * 2.20462, 1) if current_user.weight else None,
            "log_date": None,
            "days_since_log": None,
            "has_logs": False,
        }

    days_since = (date.today() - date.fromisoformat(latest.log_date)).days

    return {
        "weight_kg": latest.weight_kg,
        "weight_lb": latest.weight_lb,
        "log_date": latest.log_date,
        "days_since_log": days_since,
        "has_logs": True,
        "note": latest.note,
    }


@router.delete("/log/{log_date}")
async def delete_weight_log(
    log_date: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a specific day's weight entry."""
    entry = (
        db.query(WeightLog)
        .filter(
            WeightLog.user_id == current_user.id,
            WeightLog.log_date == log_date,
        )
        .first()
    )

    if not entry:
        raise HTTPException(status_code=404, detail="No weight log found for this date")

    db.delete(entry)
    db.commit()
    return {"deleted": True, "log_date": log_date}
