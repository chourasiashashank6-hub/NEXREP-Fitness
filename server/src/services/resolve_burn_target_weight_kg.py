"""Resolve body weight for burn calorie estimates — mirrors mobile resolveBurnTargetWeightKg.ts."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from src.models.models import User, UserOnboarding
from src.models.weight_log import WeightLog

DEFAULT_FALLBACK_KG = 70.0


def _positive_kg(value: Any) -> float | None:
    try:
        kg = float(value)
        return kg if kg > 0 else None
    except (TypeError, ValueError):
        return None


def _onboarding_weight_kg(onboarding: dict[str, Any] | None) -> float | None:
    if not isinstance(onboarding, dict):
        return None
    personal = onboarding.get("personal")
    if isinstance(personal, dict):
        return _positive_kg(personal.get("weight_kg"))
    return None


def resolve_burn_target_weight_kg(db: Session, user: User) -> float:
    """
    Priority (same as mobile resolveBurnTargetWeightKg / goal-progress):
    1. Latest weight log when the user has logged weight
    2. Profile weight (users.weight)
    3. Onboarding personal.weight_kg
    4. Fallback (70 kg)
    """
    latest = (
        db.query(WeightLog)
        .filter(WeightLog.user_id == user.id)
        .order_by(WeightLog.log_date.desc())
        .first()
    )
    if latest is not None:
        log_kg = _positive_kg(latest.weight_kg)
        if log_kg is not None:
            return log_kg

    profile_kg = _positive_kg(user.weight)
    if profile_kg is not None:
        return profile_kg

    ob_row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    onboarding = ob_row.onboarding_json if ob_row and isinstance(ob_row.onboarding_json, dict) else {}
    onboarding_kg = _onboarding_weight_kg(onboarding)
    if onboarding_kg is not None:
        return onboarding_kg

    return DEFAULT_FALLBACK_KG
