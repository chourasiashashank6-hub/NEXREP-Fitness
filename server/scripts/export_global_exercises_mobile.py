#!/usr/bin/env python3
"""Export global_exercises DB rows to mobile/src/constants/GlobalExercisesData.ts.

Run after catalog migrations or seed changes to keep the mobile bundle in sync:

    cd server && python scripts/export_global_exercises_mobile.py

The mobile app uses this file for offline MET lookup, compound detection, and
exercise search when the API is unavailable.
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import text

from src.db.session import engine

_SERVER_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _SERVER_ROOT.parent
OUTPUT_PATH = _REPO_ROOT / "mobile" / "src" / "constants" / "GlobalExercisesData.ts"


def _ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _ts_string_list(values: list[str]) -> str:
    inner = ",".join(_ts_string(v) for v in values)
    return f"[{inner}]"


def main() -> None:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, name, aliases, body_part, category, equipment,
                       muscles_primary, muscles_secondary, met_value,
                       difficulty, is_compound, catalog_id, cues
                FROM global_exercises
                ORDER BY id
                """
            )
        ).mappings().all()

    if not rows:
        raise SystemExit("global_exercises is empty — run migrations/seed first")

    lines: list[str] = [
        "export type GlobalExercise = {",
        "  id?: number;",
        "  name: string;",
        "  aliases: string[];",
        "  body_part: string;",
        "  category: string;",
        "  equipment: string;",
        "  muscles_primary: string[];",
        "  muscles_secondary: string[];",
        "  met_value: number;",
        '  difficulty: "Beginner" | "Intermediate" | "Advanced";',
        "  is_compound: boolean;",
        "  catalog_id: number | null;",
        "  cues?: string[];",
        "};",
        "",
        "/** Auto-generated from global_exercises — run server/scripts/export_global_exercises_mobile.py */",
        "export const GLOBAL_EXERCISES: GlobalExercise[] = [",
    ]

    for row in rows:
        aliases = row["aliases"] if isinstance(row["aliases"], list) else []
        primary = row["muscles_primary"] if isinstance(row["muscles_primary"], list) else []
        secondary = row["muscles_secondary"] if isinstance(row["muscles_secondary"], list) else []
        cues_raw = row.get("cues")
        cues = cues_raw if isinstance(cues_raw, list) else []
        difficulty = str(row["difficulty"] or "Beginner")
        if difficulty not in {"Beginner", "Intermediate", "Advanced"}:
            difficulty = "Intermediate"
        catalog_id = row["catalog_id"]
        catalog_literal = "null" if catalog_id is None else str(int(catalog_id))
        cues_part = ""
        if cues:
            cues_part = f", cues: {_ts_string_list([str(c) for c in cues])}"

        lines.append(
            "  { "
            f"id: {int(row['id'])}, "
            f"name: {_ts_string(str(row['name']))}, "
            f"aliases: {_ts_string_list([str(a) for a in aliases])}, "
            f"body_part: {_ts_string(str(row['body_part'] or ''))}, "
            f"category: {_ts_string(str(row['category'] or 'Strength'))}, "
            f"equipment: {_ts_string(str(row['equipment'] or ''))}, "
            f"muscles_primary: {_ts_string_list([str(m) for m in primary])}, "
            f"muscles_secondary: {_ts_string_list([str(m) for m in secondary])}, "
            f"met_value: {float(row['met_value'] or 4.0)}, "
            f'difficulty: "{difficulty}", '
            f"is_compound: {'true' if row['is_compound'] else 'false'}, "
            f"catalog_id: {catalog_literal}"
            f"{cues_part} "
            "},"
        )

    lines.append("];")
    lines.append("")

    OUTPUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(rows)} exercises to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
