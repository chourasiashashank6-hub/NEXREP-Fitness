"""Deterministic gym-protein recipe meal engine (v3).

Selects and portion-scales complete pre-authored dishes from the recipes table.
"""

from __future__ import annotations

import hashlib
import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy.orm import Session, joinedload

from src.models.recipes import Recipe, UserMealPlan
from src.services.recipe_allergy import filter_recipes_by_allergies

logger = logging.getLogger(__name__)

EMPTY_RECIPE_POOL_USER_MESSAGE = (
    "We couldn't build a meal plan with your current diet, fasting, and allergy settings. "
    "Try updating allergies in your profile or relaxing an active fasting period, then regenerate."
)


class EmptyRecipePoolError(RuntimeError):
    """Raised when no recipe matches constraints after the relaxation ladder."""

    def __init__(
        self,
        *,
        diet: str,
        slot: str,
        fasting_tag: str | None = None,
        allergies: list[str] | None = None,
    ) -> None:
        self.diet = diet
        self.slot = slot
        self.fasting_tag = fasting_tag
        self.allergies = list(allergies or [])
        super().__init__(EMPTY_RECIPE_POOL_USER_MESSAGE)

DietFilter = Literal["no_preference", "vegetarian", "vegan"]
GoalType = Literal["fat_loss", "maintain", "muscle_gain"]
# Catalog tags recipes may list; snack-like day slots map onto "snack".
CatalogSlot = Literal["breakfast", "lunch", "dinner", "snack"]
SlotName = str

@dataclass(frozen=True)
class SlotSpec:
    slot: SlotName
    share: float
    order: int
    label: str
    time: str


# Prompt table (sums to 1.0). 2-meal = Lunch+Dinner (IF-style).
MEAL_SLOT_SCHEDULES: dict[int, tuple[SlotSpec, ...]] = {
    2: (
        SlotSpec("lunch", 0.50, 0, "Lunch", "1:00 PM"),
        SlotSpec("dinner", 0.50, 1, "Dinner", "8:00 PM"),
    ),
    3: (
        SlotSpec("breakfast", 0.30, 0, "Breakfast", "8:00 AM"),
        SlotSpec("lunch", 0.40, 1, "Lunch", "1:00 PM"),
        SlotSpec("dinner", 0.30, 2, "Dinner", "8:00 PM"),
    ),
    4: (
        SlotSpec("breakfast", 0.25, 0, "Breakfast", "8:00 AM"),
        SlotSpec("lunch", 0.35, 1, "Lunch", "1:00 PM"),
        SlotSpec("snack", 0.10, 2, "Snack", "4:00 PM"),
        SlotSpec("dinner", 0.30, 3, "Dinner", "8:00 PM"),
    ),
    5: (
        SlotSpec("breakfast", 0.22, 0, "Breakfast", "8:00 AM"),
        SlotSpec("mid_morning_snack", 0.08, 1, "Mid-Morning Snack", "10:30 AM"),
        SlotSpec("lunch", 0.30, 2, "Lunch", "1:00 PM"),
        SlotSpec("evening_snack", 0.12, 3, "Evening Snack", "5:00 PM"),
        SlotSpec("dinner", 0.28, 4, "Dinner", "8:00 PM"),
    ),
    6: (
        SlotSpec("breakfast", 0.20, 0, "Breakfast", "8:00 AM"),
        SlotSpec("mid_morning_snack", 0.08, 1, "Mid-Morning Snack", "10:30 AM"),
        SlotSpec("lunch", 0.27, 2, "Lunch", "1:00 PM"),
        SlotSpec("afternoon_snack", 0.09, 3, "Afternoon Snack", "3:30 PM"),
        SlotSpec("evening_snack", 0.08, 4, "Evening Snack", "5:30 PM"),
        SlotSpec("dinner", 0.28, 5, "Dinner", "8:00 PM"),
    ),
}

# Backward-compatible aliases used by older call sites / tests.
SLOTS: tuple[SlotName, ...] = ("breakfast", "lunch", "dinner")
SLOT_SHARE: dict[SlotName, float] = {s.slot: s.share for s in MEAL_SLOT_SCHEDULES[3]}

MULTIPLIERS = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5)
DAY_KCAL_TOLERANCE_FRAC = 0.05
COOLDOWN_DAYS = 5
CANDIDATE_SAMPLE = 12
NEVER_USED_WEIGHT = 999
MAX_RECENCY_WEIGHT = 21
PROTEIN_GAP_SLOT = "protein_gap"
PROTEIN_GAP_POOL_SIZE = 15
PROTEIN_GAP_PICKS = 3
PROTEIN_GAP_SERVING_CAP_G = 250

GOAL_SPLITS: dict[GoalType, dict[str, float]] = {
    "fat_loss": {"kcal_mult": 0.85, "protein": 0.40, "carbs": 0.30, "fat": 0.30},
    "maintain": {"kcal_mult": 1.00, "protein": 0.30, "carbs": 0.40, "fat": 0.30},
    "muscle_gain": {"kcal_mult": 1.15, "protein": 0.28, "carbs": 0.47, "fat": 0.25},
}

MEAL_TYPE_FOR_SLOT: dict[SlotName, str] = {
    "breakfast": "Breakfast",
    "lunch": "Lunch",
    "dinner": "Dinner",
    "snack": "Snack",
    "mid_morning_snack": "Mid-Morning Snack",
    "afternoon_snack": "Afternoon Snack",
    "evening_snack": "Evening Snack",
}
SLOT_FOR_MEAL_TYPE: dict[str, SlotName] = {
    "breakfast": "breakfast",
    "lunch": "lunch",
    "dinner": "dinner",
    "snack": "snack",
    "mid-morning_snack": "mid_morning_snack",
    "mid_morning_snack": "mid_morning_snack",
    "afternoon_snack": "afternoon_snack",
    "evening_snack": "evening_snack",
}

# Day-slot key → recipe catalog tag used for pool filtering.
CATALOG_SLOT_FOR: dict[SlotName, CatalogSlot] = {
    "breakfast": "breakfast",
    "lunch": "lunch",
    "dinner": "dinner",
    "snack": "snack",
    "mid_morning_snack": "snack",
    "afternoon_snack": "snack",
    "evening_snack": "snack",
}


def clamp_meals_per_day(raw: int | None) -> int:
    try:
        n = int(raw or 3)
    except (TypeError, ValueError):
        n = 3
    return max(2, min(6, n))


def slot_schedule(meals_per_day: int) -> tuple[SlotSpec, ...]:
    return MEAL_SLOT_SCHEDULES[clamp_meals_per_day(meals_per_day)]


def share_for_slot(meals_per_day: int, slot: SlotName) -> float:
    for spec in slot_schedule(meals_per_day):
        if spec.slot == slot:
            return spec.share
    # Fallback if an orphan row exists from a prior schedule.
    return SLOT_SHARE.get(slot, 1.0 / max(1, clamp_meals_per_day(meals_per_day)))



@dataclass(frozen=True)
class MacroTarget:
    kcal: float
    protein: float
    carbs: float
    fat: float


@dataclass(frozen=True)
class SlotPick:
    recipe: Recipe
    multiplier: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    error: float


def normalize_diet(raw: str | None) -> DietFilter:
    s = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if s in {"vegan"}:
        return "vegan"
    if s in {"vegetarian", "veg", "jain"}:
        return "vegetarian"
    # keto / halal / intermittent_fasting / standard / non_vegetarian → no filter
    return "no_preference"


def normalize_goal(raw: str | None) -> GoalType:
    s = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if s in {"fat_loss", "weight_loss", "lose_weight", "cut", "cutting"}:
        return "fat_loss"
    if s in {"muscle_gain", "bulk", "bulking", "gain_muscle", "hypertrophy"}:
        return "muscle_gain"
    return "maintain"


def daily_targets(daily_kcal: float, goal: GoalType) -> MacroTarget:
    split = GOAL_SPLITS[goal]
    target_kcal = float(daily_kcal) * split["kcal_mult"]
    return MacroTarget(
        kcal=target_kcal,
        protein=target_kcal * split["protein"] / 4.0,
        carbs=target_kcal * split["carbs"] / 4.0,
        fat=target_kcal * split["fat"] / 9.0,
    )


def calorie_log_daily_target(
    *,
    target_kcal: float,
    protein_g: float,
    carbs_g: float,
    fat_g: float,
) -> MacroTarget:
    """Calorie Log / Meal Planner display macros — no extra v3 kcal_mult."""
    return MacroTarget(
        kcal=float(target_kcal),
        protein=float(protein_g),
        carbs=float(carbs_g),
        fat=float(fat_g),
    )


def slot_targets(daily: MacroTarget, slot: SlotName, meals_per_day: int = 3) -> MacroTarget:
    share = share_for_slot(meals_per_day, slot)
    return MacroTarget(
        kcal=daily.kcal * share,
        protein=daily.protein * share,
        carbs=daily.carbs * share,
        fat=daily.fat * share,
    )


def _rng(user_id: int, plan_date: date, slot: str, swap_version: int, slot_order: int = 0) -> random.Random:
    seed_str = f"{user_id}|{plan_date.isoformat()}|{slot}|{slot_order}|{swap_version}"
    digest = hashlib.sha256(seed_str.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def _diet_clause(diet: DietFilter):
    if diet == "vegan":
        return Recipe.diet == "vegan"
    if diet == "vegetarian":
        return Recipe.diet.in_(("vegetarian", "vegan"))
    return True


def _fasting_clause(fasting_tag: str | None):
    if not fasting_tag:
        return True
    return Recipe.dietary_tags.contains([fasting_tag])


def _slot_matches(recipe: Recipe, slot: SlotName) -> bool:
    catalog = CATALOG_SLOT_FOR.get(slot, slot)  # type: ignore[arg-type]
    slots = recipe.slots or []
    return catalog in slots


def fetch_slot_pool(
    db: Session,
    diet: DietFilter,
    slot: SlotName,
    fasting_tag: str | None = None,
    allergies: list[str] | None = None,
) -> list[Recipe]:
    q = db.query(Recipe).filter(_diet_clause(diet), _fasting_clause(fasting_tag))
    recipes = q.all()
    pool = [r for r in recipes if _slot_matches(r, slot)]
    return filter_recipes_by_allergies(pool, allergies)


def _resolve_slot_pool(
    db: Session,
    *,
    diet: DietFilter,
    slot: SlotName,
    fasting_tag: str | None,
    allergies: list[str] | None,
    exclude_recipe_ids: set[int],
    user_id: int,
    plan_date: date,
) -> tuple[list[Recipe], dict[str, bool]]:
    """Relaxation ladder: fasting window → same-day dedup. Never relax diet or allergies."""
    meta = {"relaxed_fasting": False, "relaxed_dedup": False}
    attempts: list[tuple[str | None, set[int]]] = [
        (fasting_tag, exclude_recipe_ids),
        (None, exclude_recipe_ids),
        (None, set()),
    ]
    for attempt_tag, excl in attempts:
        pool = [
            r
            for r in fetch_slot_pool(db, diet, slot, attempt_tag, allergies)
            if r.id not in excl
        ]
        if pool:
            if attempt_tag != fasting_tag:
                meta["relaxed_fasting"] = True
            if excl != exclude_recipe_ids:
                meta["relaxed_dedup"] = True
            if meta["relaxed_fasting"] or meta["relaxed_dedup"]:
                logger.info(
                    "meal_engine_v3.pool_relaxed",
                    extra={
                        "user_id": user_id,
                        "plan_date": plan_date.isoformat(),
                        "slot": slot,
                        "diet": diet,
                        "fasting_tag": fasting_tag,
                        **meta,
                    },
                )
            return pool, meta
    return [], meta



def _last_used_map(db: Session, user_id: int, before: date) -> dict[int, date]:
    rows = (
        db.query(UserMealPlan.recipe_id, UserMealPlan.plan_date)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date < before)
        .all()
    )
    out: dict[int, date] = {}
    for recipe_id, plan_date in rows:
        prev = out.get(recipe_id)
        if prev is None or plan_date > prev:
            out[recipe_id] = plan_date
    return out


def _cooldown_ids(db: Session, user_id: int, plan_date: date) -> set[int]:
    start = plan_date - timedelta(days=COOLDOWN_DAYS)
    rows = (
        db.query(UserMealPlan.recipe_id)
        .filter(
            UserMealPlan.user_id == user_id,
            UserMealPlan.plan_date >= start,
            UserMealPlan.plan_date < plan_date,
        )
        .all()
    )
    return {int(r[0]) for r in rows}


def _weight_for(recipe_id: int, plan_date: date, last_used: dict[int, date]) -> float:
    used = last_used.get(recipe_id)
    if used is None:
        return float(NEVER_USED_WEIGHT)
    days = (plan_date - used).days
    return float(min(max(days, 1), MAX_RECENCY_WEIGHT))


def _macro_error(recipe: Recipe, mult: float, target: MacroTarget) -> float:
    def term(actual: float, tgt: float, weight: float) -> float:
        if tgt <= 0:
            return 0.0
        return weight * ((actual - tgt) / tgt) ** 2

    return (
        term(recipe.protein_g * mult, target.protein, 3.0)
        + term(recipe.kcal * mult, target.kcal, 1.0)
        + term(recipe.carbs_g * mult, target.carbs, 1.0)
        + term(recipe.fat_g * mult, target.fat, 1.0)
    )


def best_multiplier(recipe: Recipe, target: MacroTarget) -> SlotPick:
    best: SlotPick | None = None
    for mult in MULTIPLIERS:
        err = _macro_error(recipe, mult, target)
        pick = SlotPick(
            recipe=recipe,
            multiplier=mult,
            kcal=round(recipe.kcal * mult, 1),
            protein_g=round(recipe.protein_g * mult, 1),
            carbs_g=round(recipe.carbs_g * mult, 1),
            fat_g=round(recipe.fat_g * mult, 1),
            error=err,
        )
        if best is None or pick.error < best.error:
            best = pick
    assert best is not None
    return best


def _slot_pick(recipe: Recipe, mult: float, target: MacroTarget) -> SlotPick:
    return SlotPick(
        recipe=recipe,
        multiplier=mult,
        kcal=round(recipe.kcal * mult, 1),
        protein_g=round(recipe.protein_g * mult, 1),
        carbs_g=round(recipe.carbs_g * mult, 1),
        fat_g=round(recipe.fat_g * mult, 1),
        error=_macro_error(recipe, mult, target),
    )


def best_multiplier_bounded(
    recipe: Recipe,
    target: MacroTarget,
    *,
    min_mult: float,
    max_mult: float,
) -> SlotPick:
    """Pick the best multiplier within [min_mult, max_mult] using the normal grid."""
    best: SlotPick | None = None
    for mult in MULTIPLIERS:
        if mult < min_mult - 1e-9 or mult > max_mult + 1e-9:
            continue
        pick = _slot_pick(recipe, mult, target)
        if best is None or pick.error < best.error:
            best = pick
    if best is not None:
        return best
    return best_multiplier(recipe, target)


def _next_multiplier(current: float, direction: int) -> float | None:
    mults = list(MULTIPLIERS)
    idx = next((i for i, m in enumerate(mults) if abs(m - current) < 1e-9), None)
    if idx is None:
        return None
    nxt = idx + direction
    if 0 <= nxt < len(mults):
        return mults[nxt]
    return None


def reconcile_day_kcal(
    db: Session,
    *,
    rows: list[UserMealPlan],
    daily: MacroTarget,
    meals_per_day: int,
    user_id: int,
    plan_date: date,
) -> tuple[list[UserMealPlan], dict[str, Any]]:
    """Close day-level kcal gaps after per-slot fitting, respecting the multiplier ceiling."""
    meal_rows = [r for r in rows if _is_meal_assignment(r) and r.recipe is not None]
    if not meal_rows:
        return rows, {"reconciled": False, "residual_gap_kcal": 0.0}

    target_kcal = float(daily.kcal)
    day_total = sum(float(r.kcal) for r in meal_rows)
    gap = target_kcal - day_total
    tolerance = DAY_KCAL_TOLERANCE_FRAC * target_kcal
    meta: dict[str, Any] = {
        "reconciled": False,
        "initial_gap_kcal": round(gap, 1),
        "residual_gap_kcal": round(gap, 1),
        "target_kcal": round(target_kcal, 1),
    }
    if target_kcal <= 0 or abs(gap) <= tolerance:
        return rows, meta

    max_mult = max(MULTIPLIERS)
    day_protein = sum(float(r.protein_g) for r in meal_rows)
    protein_gap = float(daily.protein) - day_protein
    protein_short = protein_gap > 0.05 * float(daily.protein)
    direction = 1 if gap > 0 else -1
    meta["reconciled"] = True
    meta["adjusted_slots"] = []

    def sort_key(row: UserMealPlan) -> float:
        recipe = row.recipe
        assert recipe is not None
        if protein_short and direction > 0:
            return float(recipe.protein_g) / max(float(recipe.kcal), 1.0)
        return float(row.kcal)

    working = list(meal_rows)
    max_steps = len(MULTIPLIERS) * max(1, len(working))
    for _ in range(max_steps):
        residual = target_kcal - sum(float(r.kcal) for r in working)
        if abs(residual) <= tolerance:
            break
        progressed = False
        # Spread kcal bumps across lighter slots; trim heavier slots first when reducing.
        ordered = sorted(working, key=sort_key, reverse=(direction < 0 or (protein_short and direction > 0)))
        for row in ordered:
            recipe = row.recipe
            assert recipe is not None
            cur_mult = float(row.multiplier)
            nxt_mult = _next_multiplier(cur_mult, direction)
            if nxt_mult is None:
                continue
            if direction > 0 and nxt_mult > max_mult + 1e-9:
                continue
            slot_target = slot_targets(daily, row.slot, meals_per_day)
            candidate = _slot_pick(recipe, nxt_mult, slot_target)
            if direction > 0 and candidate.kcal <= float(row.kcal) + 0.5:
                continue
            if direction < 0 and candidate.kcal >= float(row.kcal) - 0.5:
                continue
            delta = float(candidate.kcal) - float(row.kcal)
            if direction > 0:
                projected_protein = sum(float(r.protein_g) for r in working) + (
                    float(candidate.protein_g) - float(row.protein_g)
                )
                if projected_protein > float(daily.protein) * 1.10:
                    continue
            upsert_assignment(
                db,
                user_id=user_id,
                plan_date=plan_date,
                slot=row.slot,
                slot_order=int(row.slot_order or 0),
                pick=candidate,
                swap_version=int(row.swap_version or 0),
            )
            row.multiplier = candidate.multiplier
            row.kcal = candidate.kcal
            row.protein_g = candidate.protein_g
            row.carbs_g = candidate.carbs_g
            row.fat_g = candidate.fat_g
            meta["adjusted_slots"].append(
                {"slot": row.slot, "delta_kcal": round(delta, 1)}
            )
            progressed = True
            break
        if not progressed:
            break

    db.flush()
    refreshed = (
        db.query(UserMealPlan)
        .options(joinedload(UserMealPlan.recipe))
        .filter(
            UserMealPlan.user_id == user_id,
            UserMealPlan.plan_date == plan_date,
            UserMealPlan.slot != PROTEIN_GAP_SLOT,
        )
        .order_by(UserMealPlan.slot_order.asc())
        .all()
    )
    residual = target_kcal - sum(float(r.kcal) for r in refreshed)
    meta["residual_gap_kcal"] = round(residual, 1)
    if abs(residual) > tolerance:
        logger.info(
            "meal_engine_v3.reconcile_residual_gap",
            extra={**meta, "reason": "post_adjust_still_outside_tolerance"},
        )
    return list(refreshed), meta


def select_for_slot(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    slot: SlotName,
    diet: DietFilter,
    target: MacroTarget,
    swap_version: int = 0,
    slot_order: int = 0,
    exclude_recipe_ids: set[int] | None = None,
    fasting_tag: str | None = None,
    allergies: list[str] | None = None,
) -> SlotPick:
    exclude = set(exclude_recipe_ids or ())
    pool, relax_meta = _resolve_slot_pool(
        db,
        diet=diet,
        slot=slot,
        fasting_tag=fasting_tag,
        allergies=allergies,
        exclude_recipe_ids=exclude,
        user_id=user_id,
        plan_date=plan_date,
    )
    if not pool:
        if fasting_tag:
            logger.error(
                "meal_engine_v3.empty_fasting_pool",
                extra={
                    "user_id": user_id,
                    "plan_date": plan_date.isoformat(),
                    "slot": slot,
                    "fasting_tag": fasting_tag,
                    "diet": diet,
                    "allergies": allergies or [],
                    **relax_meta,
                },
            )
        raise EmptyRecipePoolError(
            diet=diet,
            slot=slot,
            fasting_tag=fasting_tag,
            allergies=allergies,
        )

    cooled = _cooldown_ids(db, user_id, plan_date)
    filtered = [r for r in pool if r.id not in cooled]
    if not filtered:
        logger.info(
            "meal_engine_v3.cooldown_relaxed",
            extra={"user_id": user_id, "plan_date": plan_date.isoformat(), "slot": slot, "diet": diet},
        )
        filtered = pool

    last_used = _last_used_map(db, user_id, plan_date)
    rng = _rng(user_id, plan_date, slot, swap_version, slot_order=slot_order)
    weights = [_weight_for(r.id, plan_date, last_used) for r in filtered]
    k = min(CANDIDATE_SAMPLE, len(filtered))
    # weighted sample without replacement
    candidates: list[Recipe] = []
    pool_list = list(filtered)
    weight_list = list(weights)
    for _ in range(k):
        total = sum(weight_list)
        pick_idx = 0
        if total <= 0:
            pick_idx = rng.randrange(len(pool_list))
        else:
            roll = rng.uniform(0, total)
            acc = 0.0
            for i, w in enumerate(weight_list):
                acc += w
                if roll <= acc:
                    pick_idx = i
                    break
        candidates.append(pool_list.pop(pick_idx))
        weight_list.pop(pick_idx)

    scored = [best_multiplier(r, target) for r in candidates]

    def protein_ratio(pick: SlotPick) -> float:
        if target.protein <= 0:
            return 1.0
        return pick.protein_g / target.protein

    # Prefer candidates that land near the slot protein target so daily totals stay honest.
    preferred = [p for p in scored if 0.85 <= protein_ratio(p) <= 1.15]
    pool = preferred or scored
    best = min(pool, key=lambda p: p.error)
    return best


def _is_meal_assignment(row: UserMealPlan) -> bool:
    return str(row.slot) != PROTEIN_GAP_SLOT


def _protein_density(recipe: Recipe) -> float:
    return float(recipe.protein_g) / max(float(recipe.serving_grams), 1.0)


def _weighted_choice(rng: random.Random, items: list[Any], weights: list[float]) -> int:
    if not items:
        raise ValueError("empty weighted choice")
    total = sum(weights)
    if total <= 0:
        return rng.randrange(len(items))
    roll = rng.uniform(0, total)
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if roll <= acc:
            return i
    return len(items) - 1


def _sample_protein_gap_recipes(
    pool: list[Recipe],
    *,
    k: int,
    rng: random.Random,
) -> list[Recipe]:
    """Weighted-random sample by density; at most one recipe per category."""
    remaining = list(pool)
    picked: list[Recipe] = []
    used_categories: set[str] = set()
    while len(picked) < k and remaining:
        eligible = [r for r in remaining if str(r.category) not in used_categories]
        if not eligible:
            break
        weights = [_protein_density(r) for r in eligible]
        idx = _weighted_choice(rng, eligible, weights)
        choice = eligible[idx]
        picked.append(choice)
        used_categories.add(str(choice.category))
        remaining = [r for r in remaining if r.id != choice.id]
    return picked


def _suggestion_payload(recipe: Recipe) -> dict[str, Any]:
    return {
        "icon": "meal",
        "title": recipe.name,
        "description": recipe.category,
        "protein_g": round(float(recipe.protein_g)),
        "time_suggestion": "",
        "estimated_cost_inr": None,
        "category": recipe.category,
        "recipe_id": recipe.id,
    }


def _record_protein_gap_seen(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    recipes: list[Recipe],
) -> None:
    """Persist suggestions as UserMealPlan rows so cooldown history covers them."""
    existing = (
        db.query(UserMealPlan)
        .filter(
            UserMealPlan.user_id == user_id,
            UserMealPlan.plan_date == plan_date,
            UserMealPlan.slot == PROTEIN_GAP_SLOT,
        )
        .all()
    )
    keep_orders = set(range(len(recipes)))
    for old in existing:
        if int(old.slot_order) not in keep_orders:
            db.delete(old)
    for i, recipe in enumerate(recipes):
        pick = SlotPick(
            recipe=recipe,
            multiplier=1.0,
            kcal=round(float(recipe.kcal), 1),
            protein_g=round(float(recipe.protein_g), 1),
            carbs_g=round(float(recipe.carbs_g), 1),
            fat_g=round(float(recipe.fat_g), 1),
            error=0.0,
        )
        upsert_assignment(
            db,
            user_id=user_id,
            plan_date=plan_date,
            slot=PROTEIN_GAP_SLOT,
            slot_order=i,
            pick=pick,
            swap_version=0,
        )
    db.flush()


def upsert_assignment(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    slot: SlotName,
    slot_order: int,
    pick: SlotPick,
    swap_version: int,
) -> UserMealPlan:
    row = (
        db.query(UserMealPlan)
        .filter(
            UserMealPlan.user_id == user_id,
            UserMealPlan.plan_date == plan_date,
            UserMealPlan.slot == slot,
            UserMealPlan.slot_order == slot_order,
        )
        .one_or_none()
    )
    now = datetime.utcnow()
    if row is None:
        row = UserMealPlan(
            user_id=user_id,
            plan_date=plan_date,
            slot=slot,
            slot_order=slot_order,
            recipe_id=pick.recipe.id,
            multiplier=pick.multiplier,
            kcal=pick.kcal,
            protein_g=pick.protein_g,
            carbs_g=pick.carbs_g,
            fat_g=pick.fat_g,
            swap_version=swap_version,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.recipe_id = pick.recipe.id
        # Keep the loaded ORM relationship consistent with the FK. Without
        # this, a subsequent joinedload/sync in the same session can restore
        # the old recipe and make swaps/regenerates appear to succeed while
        # leaving the visible day unchanged.
        row.recipe = pick.recipe
        row.multiplier = pick.multiplier
        row.kcal = pick.kcal
        row.protein_g = pick.protein_g
        row.carbs_g = pick.carbs_g
        row.fat_g = pick.fat_g
        row.swap_version = swap_version
        row.updated_at = now
    db.flush()
    return row


def ensure_day_plan(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    diet: DietFilter,
    goal: GoalType,
    daily_kcal: float,
    meals_per_day: int = 3,
    force: bool = False,
    daily_override: MacroTarget | None = None,
    fasting_tag: str | None = None,
    allergies: list[str] | None = None,
) -> list[UserMealPlan]:
    daily = daily_override or daily_targets(daily_kcal, goal)
    schedule = slot_schedule(meals_per_day)
    existing_rows = (
        db.query(UserMealPlan)
        .options(joinedload(UserMealPlan.recipe))
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == plan_date)
        .order_by(UserMealPlan.slot_order.asc())
        .all()
    )
    meal_rows = [r for r in existing_rows if _is_meal_assignment(r)]
    # Preserve previously generated days even if meals_per_day changed later,
    # unless the caller forces a rebuild (Week/Day regenerate).
    if meal_rows and not force:
        return list(meal_rows)

    used_ids: set[int] = set()
    rows: list[UserMealPlan] = []
    keep_keys = {(spec.slot, spec.order) for spec in schedule}

    for spec in schedule:
        existing = next((r for r in meal_rows if r.slot == spec.slot and int(r.slot_order) == spec.order), None)
        target = slot_targets(daily, spec.slot, meals_per_day)
        swap_version = int(existing.swap_version) if existing else 0
        pick = select_for_slot(
            db,
            user_id=user_id,
            plan_date=plan_date,
            slot=spec.slot,
            diet=diet,
            target=target,
            swap_version=swap_version,
            slot_order=spec.order,
            exclude_recipe_ids=used_ids,
            fasting_tag=fasting_tag,
            allergies=allergies,
        )
        used_ids.add(int(pick.recipe.id))
        row = upsert_assignment(
            db,
            user_id=user_id,
            plan_date=plan_date,
            slot=spec.slot,
            slot_order=spec.order,
            pick=pick,
            swap_version=swap_version,
        )
        row = (
            db.query(UserMealPlan)
            .options(joinedload(UserMealPlan.recipe))
            .filter(UserMealPlan.id == row.id)
            .one()
        )
        rows.append(row)

    # Drop leftover meal slots from a previous meals_per_day setting.
    # Also clear protein-gap suggestion rows on forced rebuild so they refresh.
    for old in existing_rows:
        if old.slot == PROTEIN_GAP_SLOT:
            if force:
                db.delete(old)
            continue
        if (old.slot, int(old.slot_order)) not in keep_keys:
            db.delete(old)
    db.flush()

    rows, _reconcile_meta = reconcile_day_kcal(
        db,
        rows=rows,
        daily=daily,
        meals_per_day=meals_per_day,
        user_id=user_id,
        plan_date=plan_date,
    )
    db.flush()
    return rows


def swap_slot(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    slot: SlotName,
    diet: DietFilter,
    goal: GoalType,
    daily_kcal: float,
    meals_per_day: int = 3,
    slot_order: int | None = None,
    exclude_recipe_ids: set[int] | None = None,
    match_current_macros: bool = True,
    daily_override: MacroTarget | None = None,
    fasting_tag: str | None = None,
    allergies: list[str] | None = None,
) -> UserMealPlan:
    daily = daily_override or daily_targets(daily_kcal, goal)
    q = db.query(UserMealPlan).filter(
        UserMealPlan.user_id == user_id,
        UserMealPlan.plan_date == plan_date,
        UserMealPlan.slot == slot,
    )
    if slot_order is not None:
        q = q.filter(UserMealPlan.slot_order == slot_order)
    existing = q.order_by(UserMealPlan.slot_order.asc()).first()
    order = int(existing.slot_order) if existing is not None else (slot_order or 0)
    target = (
        MacroTarget(
            kcal=float(existing.kcal),
            protein=float(existing.protein_g),
            carbs=float(existing.carbs_g),
            fat=float(existing.fat_g),
        )
        if existing is not None and match_current_macros
        else slot_targets(daily, slot, meals_per_day)
    )
    exclude = set(exclude_recipe_ids or ())
    # Same-day dedup: never hand back another slot's recipe from today.
    same_day = (
        db.query(UserMealPlan.recipe_id)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == plan_date)
        .all()
    )
    exclude |= {int(r[0]) for r in same_day}
    next_version = 0
    if existing:
        exclude.add(int(existing.recipe_id))
        next_version = int(existing.swap_version) + 1

    pick = select_for_slot(
        db,
        user_id=user_id,
        plan_date=plan_date,
        slot=slot,
        diet=diet,
        target=target,
        swap_version=next_version,
        slot_order=order,
        exclude_recipe_ids=exclude,
        fasting_tag=fasting_tag,
        allergies=allergies,
    )
    if existing and int(pick.recipe.id) == int(existing.recipe_id):
        raise RuntimeError("Swap returned the same recipe")

    row = upsert_assignment(
        db,
        user_id=user_id,
        plan_date=plan_date,
        slot=slot,
        slot_order=order,
        pick=pick,
        swap_version=next_version,
    )
    return (
        db.query(UserMealPlan)
        .options(joinedload(UserMealPlan.recipe))
        .filter(UserMealPlan.id == row.id)
        .one()
    )


def protein_gap_suggestions(
    db: Session,
    *,
    user_id: int,
    plan_date: date,
    diet: DietFilter,
    goal: GoalType,
    daily_kcal: float,
    daily_override: MacroTarget | None = None,
    fasting_tag: str | None = None,
    allergies: list[str] | None = None,
) -> dict[str, Any]:
    daily = daily_override or daily_targets(daily_kcal, goal)
    rows = (
        db.query(UserMealPlan)
        .options(joinedload(UserMealPlan.recipe))
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == plan_date)
        .all()
    )
    meal_rows = [r for r in rows if _is_meal_assignment(r)]
    gap_rows = [r for r in rows if not _is_meal_assignment(r)]
    consumed = sum(float(r.protein_g) for r in meal_rows)
    gap = round(daily.protein - consumed)
    assigned_ids = {int(r.recipe_id) for r in meal_rows}

    suggestions: list[dict[str, Any]] = []
    if gap > 5:
        # Stable within a day: reuse previously shown suggestions when present.
        if gap_rows:
            ordered = sorted(gap_rows, key=lambda r: int(r.slot_order or 0))
            suggestions = [
                _suggestion_payload(r.recipe)
                for r in ordered
                if r.recipe is not None and int(r.recipe_id) not in assigned_ids
            ]
        else:
            cooled = _cooldown_ids(db, user_id, plan_date)
            exclude = set(assigned_ids) | set(cooled)

            def _candidate_pool(excl: set[int]) -> list[Recipe]:
                pool = [
                    r
                    for r in filter_recipes_by_allergies(
                        db.query(Recipe).filter(_diet_clause(diet)).all(),
                        allergies,
                    )
                    if int(r.id) not in excl and float(r.serving_grams) < PROTEIN_GAP_SERVING_CAP_G
                ]
                pool.sort(key=_protein_density, reverse=True)
                return pool[:PROTEIN_GAP_POOL_SIZE]

            top = _candidate_pool(exclude)
            if len(top) < PROTEIN_GAP_PICKS:
                # Cooldown exhausted the dense pool — relax like meal selection does.
                top = _candidate_pool(set(assigned_ids))

            rng = _rng(user_id, plan_date, PROTEIN_GAP_SLOT, swap_version=0)
            picked = _sample_protein_gap_recipes(top, k=PROTEIN_GAP_PICKS, rng=rng)
            if picked:
                _record_protein_gap_seen(db, user_id=user_id, plan_date=plan_date, recipes=picked)
                suggestions = [_suggestion_payload(r) for r in picked]

    return {
        "protein_gap_g": max(gap, 0),
        "target_protein_g": round(daily.protein),
        "consumed_protein_g": round(consumed),
        "gap_pct": round((max(gap, 0) / daily.protein) * 100) if daily.protein else 0,
        "show_suggestions": gap > 5,
        "suggestions": suggestions,
    }


def _scaled_items(recipe: Recipe, multiplier: float) -> list[dict[str, Any]]:
    items = recipe.items or []
    out = []
    for it in items:
        grams = float(it.get("grams") or 0) * multiplier
        out.append(
            {
                "key": it.get("key"),
                "label": it.get("label") or it.get("key") or "Ingredient",
                "grams": round(grams, 1),
                # compatibility with existing MealFoodItem shape
                "food": it.get("label") or it.get("key") or "Ingredient",
                "quantity_g": round(grams),
                "calories": 0,
                "protein": 0,
                "carbs": 0,
                "fat": 0,
            }
        )
    return out


def _scaled_fibre_g(recipe: Recipe, multiplier: float) -> float:
    return round(float(getattr(recipe, "fibre_g", 0) or 0) * float(multiplier), 1)


def assignment_to_meal(row: UserMealPlan) -> dict[str, Any]:
    recipe = row.recipe
    mult = float(row.multiplier)
    grams = round(float(recipe.serving_grams) * mult)
    fibre = _scaled_fibre_g(recipe, mult)
    meal_type = MEAL_TYPE_FOR_SLOT.get(row.slot) or str(row.slot).replace("_", " ").title()
    time_map = {spec.slot: spec.time for specs in MEAL_SLOT_SCHEDULES.values() for spec in specs}
    return {
        "meal_type": meal_type,
        "time": time_map.get(row.slot, ""),
        "slot": row.slot,
        "slot_order": int(row.slot_order or 0),
        "items": [
            {
                "food": recipe.name,
                "food_id": recipe.id,
                "units": mult,
                "unit_label": "serving",
                "quantity_g": grams,
                "calories": round(float(row.kcal)),
                "protein": round(float(row.protein_g)),
                "carbs": round(float(row.carbs_g)),
                "fat": round(float(row.fat_g)),
                "fiber": round(fibre),
            }
        ],
        "total_calories": round(float(row.kcal)),
        "total_protein": round(float(row.protein_g)),
        "total_carbs": round(float(row.carbs_g)),
        "total_fat": round(float(row.fat_g)),
        "total_fiber": round(fibre),
        "prep_time_min": int(recipe.prep_min),
        "estimated_cost_inr": None,
        # v3 extensions for UI
        "engine": "v3",
        "recipe_id": recipe.id,
        "recipe_name": recipe.name,
        "recipe_category": recipe.category,
        "multiplier": mult,
        "serving_grams": grams,
        "recipe_items": _scaled_items(recipe, mult),
        "recipe_steps": list(recipe.steps or []),
    }


def day_payload_from_assignments(
    plan_date: date,
    rows: list[UserMealPlan],
    daily: MacroTarget,
    *,
    fibre_target_g: int | None = None,
) -> dict[str, Any]:
    meal_rows = [r for r in rows if _is_meal_assignment(r)]
    ordered = sorted(meal_rows, key=lambda x: int(getattr(x, "slot_order", 0) or 0))
    meals = [assignment_to_meal(r) for r in ordered]
    total_fiber = sum(_scaled_fibre_g(r.recipe, float(r.multiplier)) for r in meal_rows if r.recipe is not None)
    return {
        "day": plan_date.day,
        "is_cheat_day": False,
        "total_calories": round(sum(float(r.kcal) for r in meal_rows)),
        "total_protein_g": round(sum(float(r.protein_g) for r in meal_rows)),
        "total_carbs_g": round(sum(float(r.carbs_g) for r in meal_rows)),
        "total_fat_g": round(sum(float(r.fat_g) for r in meal_rows)),
        "total_fiber_g": round(total_fiber),
        "target_kcal": round(daily.kcal),
        "target_protein_g": round(daily.protein),
        "target_carbs_g": round(daily.carbs),
        "target_fat_g": round(daily.fat),
        "target_fiber_g": int(fibre_target_g) if fibre_target_g is not None else 0,
        "meals": meals,
        "meals_per_day": len(ordered),
        "engine": "v3",
    }


def parse_slot_from_meal_type(meal_type: str) -> SlotName:
    key = (meal_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    # Collapse repeated underscores from "Mid-Morning Snack" → mid_morning_snack
    while "__" in key:
        key = key.replace("__", "_")
    if key in SLOT_FOR_MEAL_TYPE:
        return SLOT_FOR_MEAL_TYPE[key]
    raise ValueError(f"Unsupported meal slot for v3 engine: {meal_type}")
