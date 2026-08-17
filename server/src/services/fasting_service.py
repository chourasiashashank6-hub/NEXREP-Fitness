from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from src.models.recipes import UserFastingPreference
from src.services.planner_common import parse_local_date

PERIOD_TYPE_TAGS: dict[str, str] = {
    "navratri": "fasting_navratri",
    "ramadan": "fasting_ramadan",
    "ekadashi": "fasting_ekadashi",
    "custom": "fasting_custom",
}


def fasting_tag_for_period(period_type: str) -> str:
    return PERIOD_TYPE_TAGS.get(period_type.strip().lower(), "fasting_custom")


def get_active_fasting_period(db: Session, user_id: int, local_date: str | None = None) -> UserFastingPreference | None:
    today = parse_local_date(local_date)
    return (
        db.query(UserFastingPreference)
        .filter(
            UserFastingPreference.user_id == user_id,
            UserFastingPreference.active.is_(True),
            UserFastingPreference.start_date <= today,
            UserFastingPreference.end_date >= today,
        )
        .order_by(UserFastingPreference.start_date.desc())
        .first()
    )


def get_active_fasting_tag(db: Session, user_id: int, local_date: str | None = None) -> str | None:
    row = get_active_fasting_period(db, user_id, local_date)
    if not row:
        return None
    return fasting_tag_for_period(str(row.period_type))


def list_fasting_preferences(db: Session, user_id: int) -> list[UserFastingPreference]:
    return (
        db.query(UserFastingPreference)
        .filter(UserFastingPreference.user_id == user_id)
        .order_by(UserFastingPreference.start_date.desc())
        .all()
    )


def serialize_fasting_preference(row: UserFastingPreference) -> dict[str, Any]:
    return {
        "id": row.id,
        "period_type": row.period_type,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "active": bool(row.active),
        "fasting_tag": fasting_tag_for_period(str(row.period_type)),
    }


def upsert_fasting_preference(
    db: Session,
    user_id: int,
    *,
    period_type: str,
    start_date: date,
    end_date: date,
    active: bool = True,
    preference_id: int | None = None,
) -> UserFastingPreference:
    period = period_type.strip().lower()
    if period not in PERIOD_TYPE_TAGS:
        raise ValueError(f"Invalid period_type: {period_type}")
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")

    row: UserFastingPreference | None = None
    if preference_id:
        row = (
            db.query(UserFastingPreference)
            .filter(UserFastingPreference.id == preference_id, UserFastingPreference.user_id == user_id)
            .first()
        )
    if row is None:
        row = UserFastingPreference(user_id=user_id)
        db.add(row)

    row.period_type = period
    row.start_date = start_date
    row.end_date = end_date
    row.active = active
    db.commit()
    db.refresh(row)
    return row


def deactivate_fasting_preference(db: Session, user_id: int, preference_id: int) -> UserFastingPreference:
    row = (
        db.query(UserFastingPreference)
        .filter(UserFastingPreference.id == preference_id, UserFastingPreference.user_id == user_id)
        .first()
    )
    if not row:
        raise LookupError("Fasting preference not found")
    row.active = False
    db.commit()
    db.refresh(row)
    return row
