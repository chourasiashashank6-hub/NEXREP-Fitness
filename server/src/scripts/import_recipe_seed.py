"""Idempotent upsert of nexrep_recipes_seed.json into the recipes table.

Run from server/:
  python -m src.scripts.import_recipe_seed --file nexrep_recipes_seed.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.recipes import Recipe

_SERVER_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RECIPE_SEED_PATH = _SERVER_ROOT / "nexrep_recipes_seed.json"

CATEGORY_SLOTS: dict[str, list[str]] = {
    "Cottage Cheese & Breakfast": ["breakfast"],
    "Baked & Pancakes": ["breakfast", "snack"],
    "Shakes & Quick Bites": ["breakfast", "snack"],
    "Sandwiches": ["lunch", "snack"],
    "Rolls & Wraps": ["lunch", "dinner"],
    "Rice & Pulao": ["lunch", "dinner"],
    "Paneer & Soya Mains": ["lunch", "dinner"],
    "Vegan Mains & Bowls": ["breakfast", "lunch", "dinner"],
    "Protein Bowls": ["lunch", "dinner"],
    "Global Bowls": ["lunch", "dinner"],
    "Non-Veg Mains": ["lunch", "dinner"],
    "Extra Non-Veg": ["lunch", "dinner"],
    "Boiled & Steamed": ["lunch", "dinner", "snack"],
    "Soups": ["lunch", "dinner"],
    "Protein Salads": ["lunch", "dinner", "snack"],
}

RECIPE_SLOT_ADD: dict[str, list[str]] = {
    "Tofu Miso Soup": ["breakfast"],
}


def compute_slots(category: str, name: str) -> list[str]:
    base = list(CATEGORY_SLOTS.get(category) or [])
    extra = RECIPE_SLOT_ADD.get(name) or []
    # Preserve order, unique
    seen: set[str] = set()
    out: list[str] = []
    for s in base + extra:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def load_seed(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Seed file must be a JSON array of recipes")
    return raw


def upsert_recipes(db: Session, rows: list[dict[str, Any]]) -> dict[str, Any]:
    existing = {r.external_id: r for r in db.query(Recipe).all()}
    inserted = 0
    updated = 0
    unchanged = 0
    now = datetime.utcnow()

    by_category: Counter[str] = Counter()
    by_diet: Counter[str] = Counter()
    by_slot: Counter[str] = Counter()

    for row in rows:
        external_id = int(row["id"])
        name = str(row["name"])
        category = str(row["category"])
        slots = compute_slots(category, name)
        if not slots:
            raise ValueError(f"No slot mapping for category={category!r} recipe={name!r}")

        payload = {
            "name": name,
            "category": category,
            "diet": str(row["diet"]),
            "servings": float(row["servings"]),
            "serving_grams": float(row["serving_grams"]),
            "kcal": float(row["kcal"]),
            "protein_g": float(row["protein_g"]),
            "fat_g": float(row["fat_g"]),
            "carbs_g": float(row["carbs_g"]),
            "fibre_g": float(row.get("fibre_g") or 0),
            "protein_pct_kcal": float(row["protein_pct_kcal"]),
            "prep_min": int(row["prep_min"]),
            "items": row["items"],
            "steps": row["steps"],
            "slots": slots,
            "updated_at": now,
        }

        by_category[category] += 1
        by_diet[payload["diet"]] += 1
        for s in slots:
            by_slot[s] += 1

        cur = existing.get(external_id)
        if cur is None:
            db.add(Recipe(external_id=external_id, created_at=now, **payload))
            inserted += 1
            continue

        changed = False
        for key, val in payload.items():
            if key == "updated_at":
                continue
            cur_val = getattr(cur, key)
            if key in ("items", "steps", "slots"):
                if json.dumps(cur_val, sort_keys=True, default=str) != json.dumps(val, sort_keys=True, default=str):
                    setattr(cur, key, val)
                    changed = True
            elif cur_val != val:
                setattr(cur, key, val)
                changed = True
        if changed:
            cur.updated_at = now
            updated += 1
        else:
            unchanged += 1

    db.commit()
    return {
        "total_seed": len(rows),
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "by_category": dict(sorted(by_category.items())),
        "by_diet": dict(sorted(by_diet.items())),
        "by_slot": dict(sorted(by_slot.items())),
    }


def load_recipe_seed_if_empty(engine: Engine, json_path: str | Path | None = None) -> int:
    """
    Seed the recipes table (meal engine v3) from bundled JSON when the table has no rows.

    Without this, `recipes` stays empty on any freshly created database (e.g. a new
    production deploy that only ran Alembic migrations), and meal plan generation fails
    with "Empty recipe pool" for every user/diet/slot. Mirrors load_workout_catalog_if_empty
    / load_food_catalog_from_sql_if_empty. Returns the number of rows inserted.
    """
    path = Path(json_path or DEFAULT_RECIPE_SEED_PATH)
    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM recipes")).scalar() or 0
    if count > 0:
        return 0
    if not path.is_file():
        return 0

    rows = load_seed(path)
    db = SessionLocal()
    try:
        summary = upsert_recipes(db, rows)
    finally:
        db.close()
    return int(summary.get("inserted", 0))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import NexRep recipe seed (meal engine v3)")
    server_root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--file",
        default=str(server_root / "nexrep_recipes_seed.json"),
        help="Path to nexrep_recipes_seed.json",
    )
    args = parser.parse_args(argv)
    path = Path(args.file)
    if not path.exists():
        print(f"ERROR: seed file not found: {path}", file=sys.stderr)
        return 1

    rows = load_seed(path)
    db = SessionLocal()
    try:
        summary = upsert_recipes(db, rows)
    finally:
        db.close()

    print("Import complete")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
