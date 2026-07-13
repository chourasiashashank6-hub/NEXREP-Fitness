"""Catalog-backed serving units for meal planner generation."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MAX_UNITS_PER_FOOD = 2.0
MIN_UNITS_PER_FOOD = 0.5
MIN_POOL_SIZE = 10
MIN_FOODS_PER_MEAL = 2
MAX_FOODS_PER_MEAL = 5
MAX_SINGLE_FOOD_CALORIE_SHARE = 0.60

# Soft lower/kind hints; hard ceiling is always MAX_UNITS_PER_FOOD.
UNIT_BOUNDS_BY_KIND: dict[str, tuple[float, float]] = {
    "beverage": (1.0, 2.0),
    "staple": (1.0, 2.0),
    "snack": (0.5, 1.5),
    "default": (0.5, 2.0),
}

PREFERRED_CATEGORIES = (
    "Indian_Staple",
    "Indian_Curry",
    "Indian_Snack",
    "Legume_Pulse",
    "Grain_Cereal",
    "Dairy",
    "Beverage",
    "Fruit",
    "Nut_Seed",
    "Protein_Egg",
    "Vegetable",
    "Soup_Stew",
    "Protein_Meat",
    "Protein_Seafood",
    "Indian_Sweet",
)

# Onboarding regional_food_styles → allowed food_items.region values (never includes western).
REGION_FILTER_MAP: dict[str, tuple[str, ...]] = {
    "north_indian": ("north_indian", "punjabi", "pan_indian"),
    "punjabi": ("punjabi", "north_indian", "pan_indian"),
    "south_indian": ("south_indian", "pan_indian"),
    "west_indian": ("west_indian", "gujarati", "maharashtrian", "rajasthani", "pan_indian"),
    "east_indian": ("east_indian", "bengali", "pan_indian"),
    "rajasthani": ("rajasthani", "west_indian", "pan_indian"),
    "gujarati": ("gujarati", "west_indian", "pan_indian"),
    "maharashtrian": ("maharashtrian", "west_indian", "pan_indian"),
    "bengali": ("bengali", "east_indian", "pan_indian"),
    "pan_indian": (
        "pan_indian",
        "north_indian",
        "south_indian",
        "west_indian",
        "east_indian",
        "punjabi",
        "gujarati",
        "maharashtrian",
        "rajasthani",
        "bengali",
    ),
}

COMPOSITE_NAME_DENYLIST = (
    "dal baati",
    "baati churma",
    " thali",
    "thali ",
)


class MealCompositionError(Exception):
    """Raised when a meal fails composition rules and cannot be repaired."""


def resolve_catalog_region(regional_food_styles: list[str] | None, *, day: int | None = None) -> str:
    """
    Map onboarding regional_food_styles to one catalog region key used for SQL filtering.
    Rotates across selected styles by day when multiple are chosen.
    """
    styles = [
        str(s).strip().lower()
        for s in (regional_food_styles or [])
        if s and str(s).strip() and str(s).strip().lower() != "no_preference"
    ]
    if not styles:
        return "pan_indian"
    if day is not None and len(styles) > 1:
        return styles[int(day) % len(styles)]
    return styles[0]


def allowed_regions_for(catalog_region: str | None) -> tuple[str, ...] | None:
    if not catalog_region:
        return None
    key = catalog_region.strip().lower()
    return REGION_FILTER_MAP.get(key, (key, "pan_indian"))


def _diet_where_clause(diet_type: str | None, *, alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    diet = (diet_type or "").lower().strip()
    if diet in ("vegan",):
        return f"AND {prefix}is_vegan = TRUE"
    if diet in ("vegetarian", "eggetarian", "lacto_vegetarian", "ovo_vegetarian", "pescatarian"):
        if diet == "pescatarian":
            return ""
        if diet == "eggetarian":
            return f"AND ({prefix}is_vegetarian = TRUE OR LOWER({prefix}food_name) LIKE '%egg%')"
        return f"AND {prefix}is_vegetarian = TRUE"
    return ""


def _kind_for_food(row: dict[str, Any]) -> str:
    label = str(row.get("unit_label") or "").lower()
    name = str(row.get("food_name") or row.get("food") or "").lower()
    if any(x in label or x in name for x in ("cup", "glass", "chai", "lassi", "tea", "coffee", "shake", "milk", "buttermilk")):
        return "beverage"
    if any(x in label for x in ("handful", "tbsp", "piece")) and any(
        x in name for x in ("nut", "almond", "peanut", "walnut", "makhana", "chana", "biscuit")
    ):
        return "snack"
    if any(x in name for x in ("rice", "roti", "chapati", "dal", "rajma", "chole", "poha", "upma", "idli", "dosa")):
        return "staple"
    return "default"


def clamp_units(units: float, row: dict[str, Any] | None = None) -> float:
    """Clamp to kind bounds, then hard-cap at MAX_UNITS_PER_FOOD (server-side, not prompt-only)."""
    kind = _kind_for_food(row or {})
    lo, hi = UNIT_BOUNDS_BY_KIND.get(kind, UNIT_BOUNDS_BY_KIND["default"])
    hi = min(hi, MAX_UNITS_PER_FOOD)
    lo = max(lo, MIN_UNITS_PER_FOOD) if kind != "beverage" else lo
    stepped = round(float(units) * 2) / 2.0
    if stepped < lo:
        stepped = lo
    if stepped > hi:
        stepped = hi
    return min(stepped, MAX_UNITS_PER_FOOD)


def row_to_candidate(row: Any) -> dict[str, Any]:
    return {
        "food_id": int(row["food_id"]),
        "food_name": str(row["food_name"]),
        "unit_label": str(row["unit_label"]),
        "unit_grams": float(row["unit_grams"] or 0),
        "kcal_per_unit": float(row["kcal_per_unit"] or 0),
        "protein_per_unit": float(row["protein_per_unit"] or 0),
        "carbs_per_unit": float(row["carbs_per_unit"] or 0),
        "fat_per_unit": float(row["fat_per_unit"] or 0),
        "is_vegetarian": bool(row.get("is_vegetarian", True)),
        "is_vegan": bool(row.get("is_vegan", False)),
        "region": str(row["region"]) if row.get("region") is not None else None,
        "is_supplement": bool(row.get("is_supplement", False)),
    }


def _query_candidates(
    db: Session,
    *,
    diet_type: str | None,
    limit: int,
    categories: tuple[str, ...] | None,
    region: str | None = None,
    exclude_food_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    diet_sql = _diet_where_clause(diet_type, alias="f")
    category_sql = ""
    region_sql = ""
    exclude_sql = ""
    params: dict[str, Any] = {"lim": max(20, min(int(limit), 150))}

    if categories:
        placeholders = ", ".join(f":cat_{i}" for i in range(len(categories)))
        category_sql = f"AND c.category_name IN ({placeholders})"
        for i, cat in enumerate(categories):
            params[f"cat_{i}"] = cat

    allowed = allowed_regions_for(region)
    if allowed:
        placeholders = ", ".join(f":reg_{i}" for i in range(len(allowed)))
        # Untagged rows are excluded (same spirit as unseeded units).
        region_sql = f"AND f.region IS NOT NULL AND f.region IN ({placeholders})"
        for i, reg in enumerate(allowed):
            params[f"reg_{i}"] = reg

    if exclude_food_ids:
        ids = [int(x) for x in exclude_food_ids if x is not None]
        if ids:
            placeholders = ", ".join(f":ex_{i}" for i in range(len(ids)))
            exclude_sql = f"AND f.food_id NOT IN ({placeholders})"
            for i, fid in enumerate(ids):
                params[f"ex_{i}"] = fid

    rows = (
        db.execute(
            text(
                f"""
                SELECT f.food_id, f.food_name, f.unit_label, f.unit_grams,
                       f.kcal_per_unit, f.protein_per_unit, f.carbs_per_unit, f.fat_per_unit,
                       f.is_vegetarian, f.is_vegan, f.region, f.is_supplement
                FROM food_items f
                JOIN food_categories c ON c.category_id = f.category_id
                WHERE f.unit_label IS NOT NULL
                  AND f.unit_grams IS NOT NULL
                  AND f.unit_grams > 0
                  AND COALESCE(f.is_supplement, FALSE) = FALSE
                  AND COALESCE(f.is_composite, FALSE) = FALSE
                  {category_sql}
                  {diet_sql}
                  {region_sql}
                  {exclude_sql}
                ORDER BY RANDOM()
                LIMIT :lim
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    return [row_to_candidate(r) for r in rows]


def fetch_food_candidate_pool(
    db: Session,
    *,
    diet_type: str | None = None,
    region: str | None = None,
    exclude_food_ids: list[int] | None = None,
    limit: int = 100,
    meal_type: str | None = None,
) -> list[dict[str, Any]]:
    """
    Filtered catalog pool with progressive category broadening when thin.

    Hard filters (never dropped): unit seeding, is_supplement=false, is_composite=false,
    region (when provided), diet. Only category list broadens when pool < MIN_POOL_SIZE.
    """
    try:
        pool = _query_candidates(
            db,
            diet_type=diet_type,
            limit=limit,
            categories=PREFERRED_CATEGORIES,
            region=region,
            exclude_food_ids=exclude_food_ids,
        )
        if len(pool) < MIN_POOL_SIZE:
            logger.info(
                "[MealPlanner] thin preferred pool (%s < %s); broadening categories "
                "diet=%s region=%s meal_type=%s (region/diet kept)",
                len(pool),
                MIN_POOL_SIZE,
                diet_type,
                region,
                meal_type,
            )
            broader = _query_candidates(
                db,
                diet_type=diet_type,
                limit=limit,
                categories=None,
                region=region,
                exclude_food_ids=exclude_food_ids,
            )
            seen = {int(f["food_id"]) for f in pool}
            for f in broader:
                fid = int(f["food_id"])
                if fid not in seen:
                    pool.append(f)
                    seen.add(fid)
                if len(pool) >= limit:
                    break
        if len(pool) < MIN_POOL_SIZE:
            log_thin_pool_warning(
                diet_type=diet_type,
                meal_type=meal_type,
                pool_size=len(pool),
                region=region,
            )
        return pool[: max(20, min(int(limit), 150))]
    except Exception:
        logger.exception("[MealPlanner] failed to load food candidate pool")
        try:
            db.rollback()
        except Exception:
            pass
    return []


def log_thin_pool_warning(
    *,
    diet_type: str | None,
    meal_type: str | None,
    pool_size: int,
    region: str | None = None,
) -> None:
    logger.warning(
        "[MealPlanner] thin seeded catalog pool after broadening: size=%s diet=%s meal_type=%s region=%s "
        "(seeding gap — do not invent unseeded foods)",
        pool_size,
        diet_type,
        meal_type,
        region,
    )


def food_by_id_map(pool: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(f["food_id"]): f for f in pool if f.get("food_id") is not None}


def prompt_food_list(pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact list embedded in the LLM user message."""
    return [
        {
            "food_id": f["food_id"],
            "food_name": f["food_name"],
            "unit_label": f["unit_label"],
            "unit_grams": f["unit_grams"],
            "kcal_per_unit": f["kcal_per_unit"],
            "protein_per_unit": f["protein_per_unit"],
            "carbs_per_unit": f["carbs_per_unit"],
            "fat_per_unit": f["fat_per_unit"],
        }
        for f in pool
    ]


def build_item_from_units(food: dict[str, Any], units: float) -> dict[str, Any]:
    units = clamp_units(units, food)
    ug = float(food.get("unit_grams") or 0)
    item = {
        "food_id": int(food["food_id"]),
        "food": str(food.get("food_name") or food.get("food") or ""),
        "units": units,
        "unit_label": str(food.get("unit_label") or "serving"),
        "quantity_g": max(1, round(units * ug)),
        "calories": max(1, round(units * float(food.get("kcal_per_unit") or 0))),
        "protein": round(units * float(food.get("protein_per_unit") or 0), 1),
        "carbs": round(units * float(food.get("carbs_per_unit") or 0), 1),
        "fat": round(units * float(food.get("fat_per_unit") or 0), 1),
        "unit_grams": ug,
        "kcal_per_unit": float(food.get("kcal_per_unit") or 0),
        "protein_per_unit": float(food.get("protein_per_unit") or 0),
        "carbs_per_unit": float(food.get("carbs_per_unit") or 0),
        "fat_per_unit": float(food.get("fat_per_unit") or 0),
    }
    if food.get("region"):
        item["region"] = str(food["region"])
    return item


def _lookup_by_name(food_by_id: dict[int, dict[str, Any]], name: str) -> dict[str, Any] | None:
    needle = name.lower().strip()
    if not needle:
        return None
    for food in food_by_id.values():
        fname = str(food.get("food_name") or "").lower()
        if fname == needle or needle in fname or fname in needle:
            return food
    return None


def resolve_raw_item(
    raw: dict[str, Any],
    food_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    """Map LLM {food_id, units} (or legacy name) onto a catalog-backed item."""
    if not isinstance(raw, dict) or not food_by_id:
        return None

    food: dict[str, Any] | None = None
    food_id_raw = raw.get("food_id")
    if food_id_raw is not None and str(food_id_raw).strip() != "":
        try:
            food = food_by_id.get(int(food_id_raw))
        except (TypeError, ValueError):
            food = None

    if food is None:
        name = str(raw.get("food") or raw.get("food_name") or "").strip()
        food = _lookup_by_name(food_by_id, name)
        if food is None:
            logger.warning("[MealPlanner] rejecting unknown food_id=%s name=%s", food_id_raw, raw.get("food"))
            return None

    units_raw = raw.get("units")
    if units_raw is None and raw.get("quantity_g") is not None and float(food.get("unit_grams") or 0) > 0:
        units_raw = float(raw["quantity_g"]) / float(food["unit_grams"])
    try:
        units = float(units_raw if units_raw is not None else 1)
    except (TypeError, ValueError):
        units = 1.0
    if units <= 0:
        units = 1.0
    # Hard cap before build (also enforced inside clamp_units).
    units = min(units, MAX_UNITS_PER_FOOD)
    return build_item_from_units(food, units)


def resolve_meal_items(
    meal: dict[str, Any],
    food_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    items_in = meal.get("items") if isinstance(meal.get("items"), list) else []
    resolved: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for raw in items_in:
        item = resolve_raw_item(raw, food_by_id) if isinstance(raw, dict) else None
        if not item:
            continue
        fid = int(item["food_id"])
        if fid in seen_ids:
            continue
        seen_ids.add(fid)
        resolved.append(item)
        if len(resolved) >= MAX_FOODS_PER_MEAL:
            break
    meal["items"] = resolved
    return meal


def recompute_item_from_units(item: dict[str, Any]) -> None:
    """After changing `units`, refresh grams/macros from embedded per-unit fields."""
    units = clamp_units(float(item.get("units") or 1), item)
    item["units"] = units
    ug = float(item.get("unit_grams") or 0)
    if ug <= 0:
        return
    item["quantity_g"] = max(1, round(units * ug))
    item["calories"] = max(1, round(units * float(item.get("kcal_per_unit") or 0)))
    item["protein"] = round(units * float(item.get("protein_per_unit") or 0), 1)
    item["carbs"] = round(units * float(item.get("carbs_per_unit") or 0), 1)
    item["fat"] = round(units * float(item.get("fat_per_unit") or 0), 1)


def scale_item_units(item: dict[str, Any], factor: float) -> None:
    if factor <= 0 or abs(factor - 1.0) < 0.01:
        return
    if item.get("food_id") is not None and item.get("unit_grams"):
        new_units = min(float(item.get("units") or 1) * factor, MAX_UNITS_PER_FOOD)
        item["units"] = new_units
        recompute_item_from_units(item)
        return
    item["quantity_g"] = max(1, round(float(item.get("quantity_g") or 0) * factor))
    item["calories"] = max(1, round(float(item.get("calories") or 0) * factor))
    item["protein"] = round(float(item.get("protein") or 0) * factor, 1)
    item["carbs"] = round(float(item.get("carbs") or 0) * factor, 1)
    item["fat"] = round(float(item.get("fat") or 0) * factor, 1)


def pick_fallback_items(
    food_by_id: dict[int, dict[str, Any]],
    *,
    count: int = 2,
    avoid_ids: set[int] | None = None,
    prefer_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    avoid = avoid_ids or set()
    foods = [f for f in food_by_id.values() if int(f["food_id"]) not in avoid]
    if not foods:
        return []
    chosen: list[dict[str, Any]] = []
    if prefer_names:
        for needle in prefer_names:
            match = _lookup_by_name(food_by_id, needle)
            if match and int(match["food_id"]) not in avoid and match not in chosen:
                chosen.append(match)
            if len(chosen) >= count:
                break
    if len(chosen) < count:
        rest = sorted(
            [f for f in foods if f not in chosen],
            key=lambda f: float(f.get("protein_per_unit") or 0),
            reverse=True,
        )
        for f in rest:
            chosen.append(f)
            if len(chosen) >= count:
                break
    defaults = [1.0, 1.0, 0.5, 1.5]
    return [build_item_from_units(f, defaults[i % len(defaults)]) for i, f in enumerate(chosen[:count])]


def distinct_food_ids(items: list[dict[str, Any]]) -> set[int]:
    ids: set[int] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            ids.add(int(item["food_id"]))
        except (TypeError, ValueError, KeyError):
            continue
    return ids


def meal_calorie_total(items: list[dict[str, Any]]) -> float:
    return sum(float(i.get("calories") or 0) for i in items if isinstance(i, dict))


def max_calorie_share(items: list[dict[str, Any]]) -> float:
    total = meal_calorie_total(items)
    if total <= 0:
        return 1.0
    return max((float(i.get("calories") or 0) / total) for i in items if isinstance(i, dict))


def meal_composition_ok(items: list[dict[str, Any]]) -> tuple[bool, str | None]:
    ids = distinct_food_ids(items)
    if len(ids) < MIN_FOODS_PER_MEAL:
        return False, f"meal returned fewer than {MIN_FOODS_PER_MEAL} distinct foods"
    if len(ids) > MAX_FOODS_PER_MEAL:
        return False, f"meal returned more than {MAX_FOODS_PER_MEAL} distinct foods"
    for item in items:
        if not isinstance(item, dict):
            continue
        units = float(item.get("units") or 0)
        if units > MAX_UNITS_PER_FOOD + 1e-6:
            return False, f"units {units} exceed max {MAX_UNITS_PER_FOOD}"
    if max_calorie_share(items) > MAX_SINGLE_FOOD_CALORIE_SHARE + 1e-6:
        return False, "single food contributes more than 60% of meal calories"
    return True, None


def enforce_meal_composition(
    meal: dict[str, Any],
    food_by_id: dict[int, dict[str, Any]],
    *,
    meal_kcal_target: float | None = None,
    day_avoid_ids: set[int] | None = None,
) -> dict[str, Any]:
    """
    Cap units, ensure 2–5 foods, and break single-food calorie dominance.
    If still far under calorie target after capping, log a seeding/gap warning.
    """
    items = [i for i in (meal.get("items") or []) if isinstance(i, dict)]
    for item in items:
        item["units"] = min(float(item.get("units") or 1), MAX_UNITS_PER_FOOD)
        recompute_item_from_units(item)

    used = distinct_food_ids(items)
    avoid = set(day_avoid_ids or set()) | used

    # Ensure minimum distinct foods.
    while len(distinct_food_ids(items)) < MIN_FOODS_PER_MEAL and len(items) < MAX_FOODS_PER_MEAL:
        picks = pick_fallback_items(food_by_id, count=1, avoid_ids=avoid)
        if not picks:
            break
        items.append(picks[0])
        avoid.add(int(picks[0]["food_id"]))

    # Break calorie dominance by adding complementary foods (not by inflating units).
    guard = 0
    while (
        len(items) >= 1
        and max_calorie_share(items) > MAX_SINGLE_FOOD_CALORIE_SHARE
        and len(items) < MAX_FOODS_PER_MEAL
        and guard < 4
    ):
        guard += 1
        picks = pick_fallback_items(food_by_id, count=1, avoid_ids=avoid)
        if not picks:
            break
        items.append(picks[0])
        avoid.add(int(picks[0]["food_id"]))

    # Trim if somehow over max.
    if len(items) > MAX_FOODS_PER_MEAL:
        items = items[:MAX_FOODS_PER_MEAL]

    meal["items"] = items
    ok, reason = meal_composition_ok(items)
    if not ok:
        # Last resort: replace with a deterministic 2–3 item combo from the pool.
        logger.warning(
            "[MealPlanner] composition failed (%s) for %s — using deterministic pool combo",
            reason,
            meal.get("meal_type"),
        )
        replace = pick_fallback_items(food_by_id, count=min(3, max(MIN_FOODS_PER_MEAL, 2)), avoid_ids=day_avoid_ids)
        if len(replace) < MIN_FOODS_PER_MEAL:
            raise MealCompositionError(reason or "unable to build multi-item meal from pool")
        meal["items"] = replace

    if meal_kcal_target and meal_kcal_target > 0:
        actual = meal_calorie_total(meal["items"])
        if actual < meal_kcal_target * 0.70:
            logger.warning(
                "[MealPlanner] meal %s still under calorie target after unit cap "
                "(actual=%s target=%s) — likely thin pool / seeding gap; not inflating units past %s",
                meal.get("meal_type"),
                round(actual),
                round(meal_kcal_target),
                MAX_UNITS_PER_FOOD,
            )
    return meal


def is_composite_food_name(name: str) -> bool:
    needle = (name or "").lower()
    return any(pat in needle for pat in COMPOSITE_NAME_DENYLIST)


def day_food_ids(meals: list[dict[str, Any]]) -> set[int]:
    ids: set[int] = set()
    for meal in meals:
        if not isinstance(meal, dict):
            continue
        ids |= distinct_food_ids([i for i in (meal.get("items") or []) if isinstance(i, dict)])
    return ids
