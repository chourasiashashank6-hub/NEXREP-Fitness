from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

_SERVER_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JSON_PATH = _SERVER_ROOT / "workout_catalog_v2_clean.json"


def _normalize_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _row_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "exercise_name": str(item.get("exercise_name", "")).strip(),
        "body_part": str(item.get("body_part", "Unknown")).strip() or "Unknown",
        "type": str(item.get("type", "Unknown")).strip() or "Unknown",
        "equipment": str(item.get("equipment", "Unknown")).strip() or "Unknown",
        "difficulty": str(item.get("difficulty", "Unknown")).strip() or "Unknown",
        "met_value": _normalize_float(item.get("met_value")),
        "goal_tag": str(item.get("goal_tag", "General")).strip() or "General",
        "sets_recommended": str(item.get("sets_recommended", "")).strip() or None,
        "reps_recommended": str(item.get("reps_recommended", "")).strip() or None,
        "rest_time_sec": _normalize_int(item.get("rest_time_sec")),
        "recommended_weight_kg": str(item.get("recommended_weight_kg", "")).strip() or None,
        "video_url": str(item.get("video_url", "")).strip() or None,
    }


def load_workout_catalog_if_empty(engine: Engine, json_path: str | Path | None = None) -> int:
    """
    Seed workout_catalog_v2 from bundled JSON when the table has no rows.
    Returns number of rows inserted/updated.
    """
    path = Path(json_path or os.getenv("WORKOUT_CATALOG_JSON") or DEFAULT_JSON_PATH)
    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM workout_catalog_v2")).scalar() or 0
    if count > 0:
        return 0
    if not path.is_file():
        return 0

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return 0

    payloads = [_row_payload(item) for item in raw if isinstance(item, dict)]
    payloads = [p for p in payloads if p["exercise_name"]]
    if not payloads:
        return 0

    insert_sql = text(
        """
        INSERT INTO workout_catalog_v2 (
          exercise_name, body_part, type, equipment, difficulty, met_value,
          goal_tag, sets_recommended, reps_recommended, rest_time_sec,
          recommended_weight_kg, video_url
        ) VALUES (
          :exercise_name, :body_part, :type, :equipment, :difficulty, :met_value,
          :goal_tag, :sets_recommended, :reps_recommended, :rest_time_sec,
          :recommended_weight_kg, :video_url
        )
        """
    )

    with engine.begin() as conn:
        conn.execute(insert_sql, payloads)

    return len(payloads)
