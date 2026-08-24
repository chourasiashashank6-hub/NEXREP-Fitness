from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.services.fasting_service import (
    deactivate_fasting_preference,
    get_active_fasting_period,
    list_fasting_preferences,
    serialize_fasting_preference,
    upsert_fasting_preference,
)
from src.services.planner_common import parse_local_date
from src.utils.auth import get_current_user
from src.utils.plan_check import require_feature

router = APIRouter(prefix="/api/fasting", tags=["fasting-meals"])


class FastingPreferencePayload(BaseModel):
    period_type: str = Field(
        ...,
        description="navratri | ramadan | ekadashi | custom | karva_chauth | sawan_somwar | maha_shivratri | janmashtami | vat_savitri | chhath_puja",
    )
    start_date: date
    end_date: date
    active: bool = True


class FastingPreferenceUpdatePayload(FastingPreferencePayload):
    id: int | None = None


@router.get("/preferences")
def get_preferences(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "fasting_aware_meals", db)
    active = get_active_fasting_period(db, current_user.id, local_date)
    items = [serialize_fasting_preference(row) for row in list_fasting_preferences(db, current_user.id)]
    return {
        "items": items,
        "active": serialize_fasting_preference(active) if active else None,
        "log_date": parse_local_date(local_date).isoformat(),
    }


@router.post("/preferences")
def post_preference(
    body: FastingPreferenceUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "fasting_aware_meals", db)
    try:
        row = upsert_fasting_preference(
            db,
            current_user.id,
            period_type=body.period_type,
            start_date=body.start_date,
            end_date=body.end_date,
            active=body.active,
            preference_id=body.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"preference": serialize_fasting_preference(row)}


@router.post("/preferences/{preference_id}/deactivate")
def post_deactivate(
    preference_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_feature(current_user, "fasting_aware_meals", db)
    try:
        row = deactivate_fasting_preference(db, current_user.id, preference_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"preference": serialize_fasting_preference(row)}
