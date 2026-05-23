from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

_SERVER_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JSON_PATH = _SERVER_ROOT / "global_exercises_seed.json"


def _normalize_name(value: str) -> str:
    return " ".join(value.strip().lower().split())


def load_global_exercises_if_empty(engine: Engine, json_path: str | Path | None = None) -> int:
    """Create global_exercises table if needed and seed from bundled JSON when empty."""
    path = Path(json_path or DEFAULT_JSON_PATH)
    schema_path = _SERVER_ROOT / "sql" / "global_exercises_schema.sql"
    if schema_path.is_file():
        schema_sql = schema_path.read_text(encoding="utf-8")
        statements = [
            s.strip()
            for s in schema_sql.split(";")
            if s.strip() and not s.strip().upper().startswith("BEGIN") and not s.strip().upper().startswith("COMMIT")
        ]
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))

    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM global_exercises")).scalar() or 0
    if count > 0:
        return 0

    if not path.is_file():
        return 0

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return 0

    catalog_by_name: dict[str, int] = {}
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, exercise_name
                FROM workout_catalog_v2
                """
            )
        ).mappings()
        for row in rows:
            key = _normalize_name(str(row["exercise_name"]))
            if key and key not in catalog_by_name:
                catalog_by_name[key] = int(row["id"])

    payloads: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        catalog_id = catalog_by_name.get(_normalize_name(name))
        payloads.append(
            {
                "name": name,
                "aliases": item.get("aliases") if isinstance(item.get("aliases"), list) else [],
                "body_part": str(item.get("body_part", "Unknown")).strip() or "Unknown",
                "category": str(item.get("category", "Strength")).strip() or "Strength",
                "equipment": str(item.get("equipment", "Other")).strip() or "Other",
                "muscles_primary": item.get("muscles_primary")
                if isinstance(item.get("muscles_primary"), list)
                else [],
                "muscles_secondary": item.get("muscles_secondary")
                if isinstance(item.get("muscles_secondary"), list)
                else [],
                "met_value": float(item.get("met_value") or 4.0),
                "difficulty": str(item.get("difficulty", "Beginner")).strip() or "Beginner",
                "is_compound": bool(item.get("is_compound")),
                "catalog_id": catalog_id,
            }
        )

    if not payloads:
        return 0

    insert_sql = text(
        """
        INSERT INTO global_exercises (
          name, aliases, body_part, category, equipment,
          muscles_primary, muscles_secondary, met_value, difficulty, is_compound, catalog_id
        ) VALUES (
          :name, :aliases, :body_part, :category, :equipment,
          :muscles_primary, :muscles_secondary, :met_value, :difficulty, :is_compound, :catalog_id
        )
        """
    )

    batch_size = 50
    with engine.begin() as conn:
        for i in range(0, len(payloads), batch_size):
            conn.execute(insert_sql, payloads[i : i + batch_size])

    return len(payloads)
