"""Tests for per-exercise MET resolution from global_exercises."""

import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal, engine
from src.services.exercise_met_service import DEFAULT_MET, resolve_met_for_exercise
from src.services.global_exercises_service import load_global_exercises_if_empty

SEED_PATH = Path(__file__).resolve().parents[1] / "global_exercises_seed.json"


@pytest.fixture(scope="module")
def met_db() -> Session:
    load_global_exercises_if_empty(engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_bug_report_exercises_resolve_to_distinct_met_values(met_db):
    cases = {
        "Dips": 5.5,
        "Cable Fly": 4.0,
        "Tricep Pushdown": 3.5,
        "Incline Dumbbell Press": 5.0,
    }
    resolved = {name: resolve_met_for_exercise(met_db, exercise_name=name) for name in cases}
    assert resolved == cases
    assert len(set(resolved.values())) == 4


def test_alias_lookup_uses_catalog_entry(met_db):
    assert resolve_met_for_exercise(met_db, exercise_name="Cable Fly") == 4.0


def test_unknown_free_text_falls_back_to_default(met_db):
    assert resolve_met_for_exercise(met_db, exercise_name="Mystery Custom Move") == DEFAULT_MET


def test_seed_catalog_has_no_missing_met_values():
    rows = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    missing = [row["name"] for row in rows if row.get("met_value") in (None, 0, 0.0)]
    assert missing == []
