"""Resolve baseline external load (kg) for active-session calorie load multiplier."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.models import GlobalExercise, StrengthLift, WorkoutCatalog, WorkoutSession, WorkoutSessionSetLog

_BODYWEIGHT_TOKENS = frozenset({"bodyweight", "body weight", "bw", "none"})


def parse_recommended_weight_midpoint(value: Any) -> float | None:
    """Parse catalog strings like '10-20', '20-50', or 'Bodyweight' → midpoint or 0."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    lowered = text.lower()
    if lowered in _BODYWEIGHT_TOKENS:
        return 0.0
    nums = [float(part) for part in re.findall(r"[\d.]+", text)]
    if not nums:
        return None
    if len(nums) == 1:
        return nums[0]
    return (nums[0] + nums[-1]) / 2.0


def _normalize_name(value: str) -> str:
    return str(value or "").strip().lower()


def _catalog_midpoint(db: Session, exercise_name: str) -> float | None:
    key = _normalize_name(exercise_name)
    if not key:
        return None
    catalog = (
        db.query(WorkoutCatalog)
        .filter(func.lower(WorkoutCatalog.exercise_name) == key)
        .first()
    )
    if catalog is None:
        return None
    return parse_recommended_weight_midpoint(catalog.recommended_weight_kg)


def is_bodyweight_exercise(db: Session, exercise_name: str) -> bool:
    """True when exercise is bodyweight-only (skip load prompt)."""
    key = _normalize_name(exercise_name)
    if not key:
        return False

    catalog_mid = _catalog_midpoint(db, exercise_name)
    if catalog_mid is not None and catalog_mid <= 0:
        return True

    exact = (
        db.query(GlobalExercise)
        .filter(func.lower(GlobalExercise.name) == key)
        .first()
    )
    if exact is not None:
        equipment = str(exact.equipment or "").strip().lower()
        if equipment in _BODYWEIGHT_TOKENS or equipment == "body weight":
            return True

    alias_rows = db.query(GlobalExercise).filter(GlobalExercise.aliases.isnot(None)).all()
    for row in alias_rows:
        aliases = row.aliases or []
        if any(_normalize_name(alias) == key for alias in aliases):
            equipment = str(row.equipment or "").strip().lower()
            if equipment in _BODYWEIGHT_TOKENS or equipment == "body weight":
                return True
            break

    return False


def resolve_baseline_load_kg(db: Session, user_id: int, exercise_name: str) -> float | None:
    """
    Baseline external load for load-intensity multiplier.

    Priority: latest WorkoutSessionSetLog → latest StrengthLift → catalog midpoint → null.
    Returns 0.0 for bodyweight catalog entries; null when unknown.
    """
    key = _normalize_name(exercise_name)
    if not key:
        return None

    session_row = (
        db.query(WorkoutSessionSetLog)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSessionSetLog.session_pk)
        .filter(
            WorkoutSession.user_id == user_id,
            func.lower(WorkoutSessionSetLog.exercise_name) == key,
            WorkoutSessionSetLog.weight_kg.isnot(None),
            WorkoutSessionSetLog.weight_kg > 0,
        )
        .order_by(WorkoutSessionSetLog.completed_at.desc())
        .first()
    )
    if session_row is not None:
        return float(session_row.weight_kg)

    lift = (
        db.query(StrengthLift)
        .filter(
            StrengthLift.user_id == user_id,
            func.lower(StrengthLift.exercise_name) == key,
            StrengthLift.weight_kg > 0,
        )
        .order_by(StrengthLift.date.desc())
        .first()
    )
    if lift is not None:
        return float(lift.weight_kg)

    return _catalog_midpoint(db, exercise_name)


def resolve_prefill_load_kg(db: Session, user_id: int, exercise_name: str) -> float | None:
    """Suggested pre-fill for weight entry — null for bodyweight / unknown."""
    if is_bodyweight_exercise(db, exercise_name):
        return None
    baseline = resolve_baseline_load_kg(db, user_id, exercise_name)
    if baseline is None or baseline <= 0:
        return None
    return baseline
