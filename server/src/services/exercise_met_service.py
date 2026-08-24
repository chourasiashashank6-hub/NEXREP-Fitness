"""Resolve per-exercise MET from global_exercises / workout_catalog_v2."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.models import GlobalExercise, WorkoutCatalog

DEFAULT_MET = 5.0


def _clean_exercise_name(value: Any) -> str:
    return str(value or "").strip()


def _normalize_key(value: str) -> str:
    return _clean_exercise_name(value).lower()


def resolve_met_for_exercise(
    db: Session | None,
    *,
    exercise_id: int | None = None,
    exercise_name: str | None = None,
) -> float:
    """
    DB-stored MET for a catalog exercise, else DEFAULT_MET for unknown free-text names.
    Lookup order: exercise_id → exact global name → global alias → catalog name → partial global name.
    """
    if db is None:
        return DEFAULT_MET

    if exercise_id is not None:
        row = db.query(GlobalExercise).filter(GlobalExercise.id == exercise_id).first()
        met = _met_from_global_row(row)
        if met is not None:
            return met

    name = _clean_exercise_name(exercise_name)
    if not name:
        return DEFAULT_MET

    key = _normalize_key(name)

    exact = (
        db.query(GlobalExercise)
        .filter(func.lower(GlobalExercise.name) == key)
        .first()
    )
    met = _met_from_global_row(exact)
    if met is not None:
        return met

    alias_rows = db.query(GlobalExercise).filter(GlobalExercise.aliases.isnot(None)).all()
    alias_matches: list[GlobalExercise] = []
    for row in alias_rows:
        aliases = row.aliases or []
        if any(_normalize_key(alias) == key for alias in aliases):
            alias_matches.append(row)
    if len(alias_matches) == 1:
        met = _met_from_global_row(alias_matches[0])
        if met is not None:
            return met

    catalog = (
        db.query(WorkoutCatalog)
        .filter(func.lower(WorkoutCatalog.exercise_name) == key)
        .first()
    )
    if catalog and catalog.met_value is not None and float(catalog.met_value) > 0:
        return float(catalog.met_value)

    partial_rows = (
        db.query(GlobalExercise)
        .filter(func.lower(GlobalExercise.name).contains(key))
        .limit(5)
        .all()
    )
    for row in partial_rows:
        met = _met_from_global_row(row)
        if met is not None:
            return met

    return DEFAULT_MET


def _met_from_global_row(row: GlobalExercise | None) -> float | None:
    if row is None or row.met_value is None:
        return None
    value = float(row.met_value)
    return value if value > 0 else None
