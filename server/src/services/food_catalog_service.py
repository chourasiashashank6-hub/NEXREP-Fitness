from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

_SERVER_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SQL_PATH = str(_SERVER_ROOT / "sql" / "food_database_final.sql")


def _to_decimal(value: Any, fallback: str = "0") -> Decimal:
    try:
        if value is None:
            return Decimal(fallback)
        return Decimal(str(value))
    except Exception:
        return Decimal(fallback)


def _split_tuples(values_sql: str) -> list[str]:
    tuples: list[str] = []
    in_quote = False
    escape = False
    depth = 0
    start = -1
    for i, ch in enumerate(values_sql):
        if ch == "\\" and in_quote:
            escape = not escape
            continue
        if ch == "'" and not escape:
            in_quote = not in_quote
        escape = False
        if in_quote:
            continue
        if ch == "(":
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and start >= 0:
                tuples.append(values_sql[start:i])
                start = -1
    return tuples


def _split_fields(tuple_sql: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    in_quote = False
    escape = False
    for ch in tuple_sql:
        if ch == "\\" and in_quote:
            escape = not escape
            cur.append(ch)
            continue
        if ch == "'" and not escape:
            in_quote = not in_quote
            cur.append(ch)
            continue
        escape = False
        if ch == "," and not in_quote:
            out.append("".join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    out.append("".join(cur).strip())
    return out


def _decode(token: str) -> Any:
    t = token.strip()
    if not t:
        return None
    upper = t.upper()
    if upper == "NULL":
        return None
    if t.startswith("'") and t.endswith("'"):
        return t[1:-1].replace("\\'", "'")
    if "." in t:
        try:
            return Decimal(t)
        except Exception:
            return t
    try:
        return int(t)
    except Exception:
        return t


def _parse_food_rows(sql_text: str) -> list[dict[str, Any]]:
    marker = "INSERT INTO food_master"
    parts = sql_text.split(marker)
    rows: list[dict[str, Any]] = []
    for part in parts[1:]:
        if "VALUES" not in part or ";" not in part:
            continue
        values_block = part.split("VALUES", 1)[1].split(";", 1)[0]
        tuple_chunks = _split_tuples(values_block)
        for chunk in tuple_chunks:
            fields = [_decode(x) for x in _split_fields(chunk)]
            if len(fields) != 20:
                continue
            rows.append(
                {
                    "source_food_id": None,
                    "food_name": str(fields[0]),
                    "category": str(fields[1]),
                    "calories_per_100g": _to_decimal(fields[2]),
                    "protein_g": _to_decimal(fields[3]),
                    "carbs_g": _to_decimal(fields[4]),
                    "fat_g": _to_decimal(fields[5]),
                    "fiber_g": _to_decimal(fields[6]),
                    "sugar_g": _to_decimal(fields[7]),
                    "sodium_mg": _to_decimal(fields[8]),
                    "saturated_fat_g": _to_decimal(fields[9]),
                    "cholesterol_mg": _to_decimal(fields[10]),
                    "potassium_mg": _to_decimal(fields[11]),
                    "calcium_mg": _to_decimal(fields[12]),
                    "iron_mg": _to_decimal(fields[13]),
                    "vitamin_c_mg": _to_decimal(fields[14]),
                    "glycemic_index": int(fields[15]) if fields[15] is not None else None,
                    "serving_size_g": _to_decimal(fields[16], "100"),
                    "is_vegetarian": bool(fields[17]),
                    "is_vegan": bool(fields[18]),
                    "is_gluten_free": bool(fields[19]),
                }
            )
    return rows


def ensure_food_catalog_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS food_categories (
                    category_id BIGSERIAL PRIMARY KEY,
                    category_name VARCHAR(80) NOT NULL UNIQUE
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS food_items (
                    food_id BIGSERIAL PRIMARY KEY,
                    source_food_id BIGINT NULL,
                    food_name VARCHAR(200) NOT NULL,
                    category_id BIGINT NOT NULL REFERENCES food_categories(category_id),
                    calories_per_100g NUMERIC(9,2) NOT NULL,
                    protein_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    carbs_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    fat_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    fiber_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    sugar_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    sodium_mg NUMERIC(10,2) NOT NULL DEFAULT 0,
                    saturated_fat_g NUMERIC(9,2) NOT NULL DEFAULT 0,
                    cholesterol_mg NUMERIC(10,2) NOT NULL DEFAULT 0,
                    potassium_mg NUMERIC(10,2) NOT NULL DEFAULT 0,
                    calcium_mg NUMERIC(10,2) NOT NULL DEFAULT 0,
                    iron_mg NUMERIC(9,2) NOT NULL DEFAULT 0,
                    vitamin_c_mg NUMERIC(9,2) NOT NULL DEFAULT 0,
                    glycemic_index INT NULL,
                    serving_size_g NUMERIC(9,2) NOT NULL DEFAULT 100,
                    is_vegetarian BOOLEAN NOT NULL DEFAULT TRUE,
                    is_vegan BOOLEAN NOT NULL DEFAULT FALSE,
                    is_gluten_free BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_food_items_food_name ON food_items(food_name)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_food_items_food_name_lower ON food_items((LOWER(food_name)))"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_food_items_category_id ON food_items(category_id)"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_food_items_food_name_trgm ON food_items USING gin (food_name gin_trgm_ops)"))


def load_food_catalog_from_sql_if_empty(engine: Engine, sql_path: str | None = None) -> int:
    path = (sql_path or os.getenv("FOOD_DB_SQL_PATH") or DEFAULT_SQL_PATH).strip()
    with engine.begin() as conn:
        has_rows = conn.execute(text("SELECT COUNT(*) FROM food_items")).scalar() or 0
    if has_rows > 0:
        return 0
    if not os.path.exists(path):
        return 0

    with open(path, "r", encoding="utf-8") as f:
        sql_text = f.read()
    rows = _parse_food_rows(sql_text)
    if not rows:
        return 0

    categories = sorted({r["category"] for r in rows})
    with engine.begin() as conn:
        for cat in categories:
            conn.execute(
                text(
                    """
                    INSERT INTO food_categories(category_name)
                    VALUES (:name)
                    ON CONFLICT (category_name) DO NOTHING
                    """
                ),
                {"name": cat},
            )
        cat_rows = conn.execute(text("SELECT category_id, category_name FROM food_categories")).mappings().all()
        cat_map = {r["category_name"]: r["category_id"] for r in cat_rows}

        payload = []
        for r in rows:
            payload.append(
                {
                    "source_food_id": r["source_food_id"],
                    "food_name": r["food_name"],
                    "category_id": cat_map[r["category"]],
                    "calories_per_100g": r["calories_per_100g"],
                    "protein_g": r["protein_g"],
                    "carbs_g": r["carbs_g"],
                    "fat_g": r["fat_g"],
                    "fiber_g": r["fiber_g"],
                    "sugar_g": r["sugar_g"],
                    "sodium_mg": r["sodium_mg"],
                    "saturated_fat_g": r["saturated_fat_g"],
                    "cholesterol_mg": r["cholesterol_mg"],
                    "potassium_mg": r["potassium_mg"],
                    "calcium_mg": r["calcium_mg"],
                    "iron_mg": r["iron_mg"],
                    "vitamin_c_mg": r["vitamin_c_mg"],
                    "glycemic_index": r["glycemic_index"],
                    "serving_size_g": r["serving_size_g"],
                    "is_vegetarian": r["is_vegetarian"],
                    "is_vegan": r["is_vegan"],
                    "is_gluten_free": r["is_gluten_free"],
                }
            )
        conn.execute(
            text(
                """
                INSERT INTO food_items (
                    source_food_id, food_name, category_id, calories_per_100g, protein_g, carbs_g, fat_g,
                    fiber_g, sugar_g, sodium_mg, saturated_fat_g, cholesterol_mg, potassium_mg,
                    calcium_mg, iron_mg, vitamin_c_mg, glycemic_index, serving_size_g,
                    is_vegetarian, is_vegan, is_gluten_free
                ) VALUES (
                    :source_food_id, :food_name, :category_id, :calories_per_100g, :protein_g, :carbs_g, :fat_g,
                    :fiber_g, :sugar_g, :sodium_mg, :saturated_fat_g, :cholesterol_mg, :potassium_mg,
                    :calcium_mg, :iron_mg, :vitamin_c_mg, :glycemic_index, :serving_size_g,
                    :is_vegetarian, :is_vegan, :is_gluten_free
                )
                """
            ),
            payload,
        )
    return len(payload)


def search_foods(db: Session, query: str, limit: int = 20) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    rows = (
        db.execute(
            text(
                """
                SELECT fi.food_id, fi.food_name, fc.category_name
                FROM food_items fi
                JOIN food_categories fc ON fc.category_id = fi.category_id
                WHERE LOWER(fi.food_name) LIKE LOWER(:pat)
                ORDER BY
                  CASE WHEN LOWER(fi.food_name) = LOWER(:exact) THEN 0 ELSE 1 END,
                  fi.food_name ASC
                LIMIT :lim
                """
            ),
            {"pat": f"%{q}%", "exact": q, "lim": max(1, min(limit, 50))},
        )
        .mappings()
        .all()
    )
    return [{"food_id": int(r["food_id"]), "food_name": r["food_name"], "category": r["category_name"]} for r in rows]


def lookup_food_scaled(db: Session, *, food_id: int | None, food_name: str | None, quantity_g: Decimal) -> dict[str, Any] | None:
    if quantity_g <= 0:
        return None
    if food_id is not None:
        row = (
            db.execute(
                text(
                    """
                    SELECT fi.food_id, fi.food_name, fc.category_name, fi.calories_per_100g, fi.protein_g, fi.carbs_g, fi.fat_g, fi.fiber_g
                    FROM food_items fi
                    JOIN food_categories fc ON fc.category_id = fi.category_id
                    WHERE fi.food_id = :fid
                    LIMIT 1
                    """
                ),
                {"fid": food_id},
            )
            .mappings()
            .first()
        )
    else:
        row = (
            db.execute(
                text(
                    """
                    SELECT fi.food_id, fi.food_name, fc.category_name, fi.calories_per_100g, fi.protein_g, fi.carbs_g, fi.fat_g, fi.fiber_g
                    FROM food_items fi
                    JOIN food_categories fc ON fc.category_id = fi.category_id
                    WHERE LOWER(fi.food_name) = LOWER(:name)
                    ORDER BY fi.food_id ASC
                    LIMIT 1
                    """
                ),
                {"name": (food_name or "").strip()},
            )
            .mappings()
            .first()
        )
    if not row:
        return None

    cal100 = _to_decimal(row["calories_per_100g"])
    p100 = _to_decimal(row["protein_g"])
    c100 = _to_decimal(row["carbs_g"])
    f100 = _to_decimal(row["fat_g"])
    fi100 = _to_decimal(row["fiber_g"])
    factor = quantity_g / Decimal("100")
    return {
        "food_id": int(row["food_id"]),
        "food_name": row["food_name"],
        "category": row["category_name"],
        "quantity_g": quantity_g,
        "per_100g": {
            "calories": cal100,
            "protein_g": p100,
            "carbs_g": c100,
            "fat_g": f100,
            "fiber_g": fi100,
        },
        "scaled": {
            "calories": (cal100 * factor),
            "protein_g": (p100 * factor),
            "carbs_g": (c100 * factor),
            "fat_g": (f100 * factor),
            "fiber_g": (fi100 * factor),
        },
    }
