"""Deterministic health-tip selection for the calorie coach carousel."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from src.models.models import User, UserOnboarding
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry, ShownHealthTip
from src.utils.app_time import APP_TIMEZONE, now_ist, today_ist

LIBRARY_PATH = Path(__file__).resolve().parents[1] / "data" / "health_tips_library.json"
TIP_COUNT = 4
EVENING_HOUR = 17
LATE_FIRST_MEAL_HOUR = 12


@dataclass(frozen=True)
class NutritionContext:
    diet_type: str
    onboarding_diet: str
    goal: str
    meals_per_day: int
    meals_logged: int
    calories_eaten: float
    calorie_target: float
    protein_eaten: float
    protein_target: float
    fiber_eaten: float
    fiber_target: float
    fat_eaten: float
    fat_target: float
    water_ml: float
    water_target_ml: float
    high_carb_meal: bool
    late_first_meal: bool
    logged_food_items: tuple[str, ...]


@lru_cache(maxsize=1)
def load_tip_library() -> tuple[dict[str, Any], ...]:
    raw = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("health_tips_library.json must be a JSON array")
    return tuple(raw)


def normalize_onboarding_diet(diet_type: str | None) -> str:
    return (diet_type or "standard").strip().lower().replace("-", "_").replace(" ", "_")


def user_diet_tag(diet_type: str | None) -> str:
    s = normalize_onboarding_diet(diet_type)
    if s == "vegan":
        return "vegan"
    if s in {"vegetarian", "veg", "jain"}:
        return "veg"
    return "non_veg"


def user_goal_tag(goal: str | None) -> str:
    s = (goal or "maintain").strip().lower().replace("-", "_").replace(" ", "_")
    if s in {"fat_loss", "weight_loss", "cut", "cutting", "lose_weight"}:
        return "fat_loss"
    if s in {"muscle_gain", "bulk", "bulking", "hypertrophy", "gain_muscle"}:
        return "muscle_gain"
    if s == "strength":
        return "strength"
    return "maintain"


def _onboarding(db: Session, user_id: int) -> dict[str, Any]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    return row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}


def meals_per_day_for_user(db: Session, user_id: int) -> int:
    onboarding = _onboarding(db, user_id)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    mpd = int(dietary.get("meals_per_day") or 3)
    return max(2, min(6, mpd))


def _meal_carb_ratio(calories: float, carbs_g: float, protein_g: float, fat_g: float) -> float:
    total = float(calories or 0)
    if total <= 0:
        total = float(protein_g or 0) * 4 + float(carbs_g or 0) * 4 + float(fat_g or 0) * 9
    if total <= 0:
        return 0.0
    return (float(carbs_g or 0) * 4) / total


def _first_meal_hour_ist(db: Session, user_id: int, log_date: date) -> int | None:
    rows: list[datetime] = []
    manual = (
        db.query(MealEntry.logged_at)
        .join(DailyNutritionLog, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date == log_date)
        .all()
    )
    rows.extend(r[0] for r in manual if r[0] is not None)
    ai = (
        db.query(AIFoodMealEntry.created_at)
        .filter(AIFoodMealEntry.user_id == user_id, AIFoodMealEntry.log_date == log_date)
        .all()
    )
    rows.extend(r[0] for r in ai if r[0] is not None)
    if not rows:
        return None
    first = min(rows)
    if first.tzinfo is None:
        first = first.replace(tzinfo=APP_TIMEZONE)
    return first.astimezone(APP_TIMEZONE).hour


def build_nutrition_context(db: Session, user: User, log_date: date) -> NutritionContext:
    from src.services.calorie_log_targets import get_calorie_log_targets

    onboarding = _onboarding(db, user.id)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    goal_block = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    targets = get_calorie_log_targets(db, user)

    meals_per_day = meals_per_day_for_user(db, user.id)
    log = db.query(DailyNutritionLog).filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == log_date).first()
    meals_logged = 0
    calories_eaten = 0.0
    protein_eaten = 0.0
    fiber_eaten = 0.0
    fat_eaten = 0.0
    water_ml = 0.0
    calorie_target = float(targets["target_calories"])
    protein_target = float(targets["target_protein_g"])
    fiber_target = float(targets.get("target_fiber_g") or 30)
    fat_target = float(targets["target_fat_g"])
    water_target_ml = float(targets["target_water_l"]) * 1000
    high_carb_meal = False
    food_items: list[str] = []

    if log:
        from src.routes.calories import recalculate_daily_log

        recalculate_daily_log(db, log)
        db.flush()
        calories_eaten = float(log.total_calories or 0)
        protein_eaten = float(log.total_protein_g or 0)
        fiber_eaten = float(log.total_fiber_g or 0)
        fat_eaten = float(log.total_fat_g or 0)
        water_ml = float(log.total_water_l or 0) * 1000
        calorie_target = float(log.target_calories or calorie_target)
        protein_target = float(log.target_protein_g or protein_target)
        fiber_target = float(log.target_fiber_g or fiber_target)
        fat_target = float(log.target_fat_g or fat_target)
        water_target_ml = float(log.target_water_l or water_target_ml / 1000) * 1000

        manual_meals = db.query(MealEntry).filter(MealEntry.log_id == log.log_id).all()
        meals_logged += len(manual_meals)
        for meal in manual_meals:
            food_items.append(str(meal.food_name or "").strip())
            if _meal_carb_ratio(
                float(meal.total_calories or 0),
                float(meal.total_carbs_g or 0),
                float(meal.total_protein_g or 0),
                float(meal.total_fat_g or 0),
            ) > 0.65:
                high_carb_meal = True

    ai_meals = db.query(AIFoodMealEntry).filter(AIFoodMealEntry.user_id == user.id, AIFoodMealEntry.log_date == log_date).all()
    meals_logged += len(ai_meals)
    for meal in ai_meals:
        food_items.append(str(meal.food_name or "").strip())
        if _meal_carb_ratio(
            float(meal.calories or 0),
            float(meal.carbs or 0),
            float(meal.protein or 0),
            float(meal.fat or 0),
        ) > 0.65:
            high_carb_meal = True

    first_hour = _first_meal_hour_ist(db, user.id, log_date)
    late_first_meal = first_hour is not None and first_hour >= LATE_FIRST_MEAL_HOUR

    raw_diet = normalize_onboarding_diet(str(dietary.get("diet_type") or "standard"))
    return NutritionContext(
        diet_type=user_diet_tag(raw_diet),
        onboarding_diet=raw_diet,
        goal=user_goal_tag(str(goal_block.get("type") or "maintain")),
        meals_per_day=meals_per_day,
        meals_logged=meals_logged,
        calories_eaten=calories_eaten,
        calorie_target=calorie_target,
        protein_eaten=protein_eaten,
        protein_target=protein_target,
        fiber_eaten=fiber_eaten,
        fiber_target=fiber_target,
        fat_eaten=fat_eaten,
        fat_target=fat_target,
        water_ml=water_ml,
        water_target_ml=water_target_ml,
        high_carb_meal=high_carb_meal,
        late_first_meal=late_first_meal,
        logged_food_items=tuple(item for item in food_items if item),
    )


def compute_active_triggers(ctx: NutritionContext, *, now: datetime | None = None) -> set[str]:
    now = now or now_ist()
    hour = now.hour
    late_day = hour >= EVENING_HOUR
    triggers: set[str] = set()

    if ctx.meals_logged <= 0:
        triggers.add("no_logs")
        return triggers

    protein_ratio = ctx.protein_eaten / ctx.protein_target if ctx.protein_target > 0 else 1.0
    calorie_ratio = ctx.calories_eaten / ctx.calorie_target if ctx.calorie_target > 0 else 1.0
    fiber_ratio = ctx.fiber_eaten / ctx.fiber_target if ctx.fiber_target > 0 else 1.0
    water_ratio = ctx.water_ml / ctx.water_target_ml if ctx.water_target_ml > 0 else 1.0
    fat_ratio = ctx.fat_eaten / ctx.fat_target if ctx.fat_target > 0 else 1.0

    if protein_ratio < 0.7:
        triggers.add("protein_gap")
    if protein_ratio < 0.4 and ctx.meals_logged >= 2:
        triggers.add("protein_severe_gap")
    if late_day and calorie_ratio < 0.8:
        triggers.add("under_calories")
    if calorie_ratio > 1.05:
        triggers.add("over_calories")
    if water_ratio < 0.6:
        triggers.add("low_hydration")
    if fiber_ratio < 0.6:
        triggers.add("low_fiber")
    if ctx.high_carb_meal:
        triggers.add("high_carb_meal")
    if fat_ratio < 0.5:
        triggers.add("low_fat")
    if late_day and ctx.meals_logged < ctx.meals_per_day:
        triggers.add("meal_skipped")
    if ctx.late_first_meal:
        triggers.add("late_first_meal")

    on_track = (
        0.9 <= calorie_ratio <= 1.05
        and protein_ratio >= 0.7
        and water_ratio >= 0.6
        and (fiber_ratio >= 0.6 or ctx.fiber_target <= 0)
    )
    if on_track:
        triggers.add("on_track")

    return triggers


def _tip_matches_diet(tip_diets: list[str], user_diet: str) -> bool:
    if "all" in tip_diets:
        return True
    return user_diet in tip_diets


def _tip_matches_goal(tip_goals: list[str], user_goal: str) -> bool:
    if "all" in tip_goals:
        return True
    return user_goal in tip_goals


def _tip_matches_triggers(tip_triggers: list[str], active: set[str]) -> bool:
    if not tip_triggers:
        return True
    return bool(set(tip_triggers) & active)


def _tip_excluded_for_onboarding_diet(tip: dict[str, Any], onboarding_diet: str) -> bool:
    excluded = tip.get("excluded_diets") or []
    if not excluded:
        return False
    normalized = normalize_onboarding_diet(onboarding_diet)
    blocked = {normalize_onboarding_diet(str(item)) for item in excluded}
    return normalized in blocked


def _shown_recently(
    db: Session,
    user_id: int,
    tip_id: str,
    cooldown_days: int,
    *,
    as_of: date,
) -> bool:
    if cooldown_days <= 0:
        return False
    since = as_of - timedelta(days=cooldown_days - 1)
    row = (
        db.query(ShownHealthTip.id)
        .filter(
            ShownHealthTip.user_id == user_id,
            ShownHealthTip.tip_id == tip_id,
            ShownHealthTip.shown_on >= since,
            ShownHealthTip.shown_on <= as_of,
        )
        .first()
    )
    return row is not None


def _last_shown_on(db: Session, user_id: int, tip_id: str) -> date | None:
    row = (
        db.query(ShownHealthTip.shown_on)
        .filter(ShownHealthTip.user_id == user_id, ShownHealthTip.tip_id == tip_id)
        .order_by(ShownHealthTip.shown_on.desc())
        .first()
    )
    return row[0] if row else None


def _eligible_tips(
    ctx: NutritionContext,
    active_triggers: set[str],
    *,
    relax_cooldown: bool,
    db: Session,
    user_id: int,
    as_of: date,
) -> list[dict[str, Any]]:
    eligible: list[dict[str, Any]] = []
    for tip in load_tip_library():
        tip_id = str(tip["id"])
        diets = list(tip.get("diet") or [])
        goals = list(tip.get("goals") or [])
        triggers = list(tip.get("triggers") or [])
        priority = int(tip.get("priority") or 5)
        cooldown_days = int(tip.get("cooldown_days") or 30)

        if not _tip_matches_diet(diets, ctx.diet_type):
            continue
        if _tip_excluded_for_onboarding_diet(tip, ctx.onboarding_diet):
            continue
        if not _tip_matches_goal(goals, ctx.goal):
            continue
        if not _tip_matches_triggers(triggers, active_triggers):
            continue

        trigger_active = bool(set(triggers) & active_triggers)
        bypass_cooldown = priority == 1 and trigger_active
        if not bypass_cooldown and not relax_cooldown and _shown_recently(db, user_id, tip_id, cooldown_days, as_of=as_of):
            continue

        eligible.append({**tip, "priority": priority, "cooldown_days": cooldown_days})

    eligible.sort(key=lambda t: (int(t["priority"]), str(t["id"])))
    return eligible


def _serialize_tip(tip: dict[str, Any]) -> dict[str, str]:
    category = str(tip.get("category") or "habit")
    return {
        "id": str(tip["id"]),
        "category": category,
        "title": str(tip.get("title") or ""),
        "body": str(tip.get("body") or ""),
        "tag": category.replace("_", " ").title(),
    }


def _record_shown_tips(db: Session, user_id: int, tip_ids: list[str], shown_on: date) -> None:
    for tip_id in tip_ids:
        exists = (
            db.query(ShownHealthTip.id)
            .filter(
                ShownHealthTip.user_id == user_id,
                ShownHealthTip.tip_id == tip_id,
                ShownHealthTip.shown_on == shown_on,
            )
            .first()
        )
        if exists:
            continue
        db.add(ShownHealthTip(user_id=user_id, tip_id=tip_id, shown_on=shown_on))
    db.commit()


def select_health_tips(db: Session, user: User, log_date: date | None = None) -> list[dict[str, str]]:
    as_of = log_date or today_ist()
    try:
        ctx = build_nutrition_context(db, user, as_of)
        active_triggers = compute_active_triggers(ctx)
    except Exception:
        ctx = NutritionContext(
            diet_type="non_veg",
            onboarding_diet="standard",
            goal="maintain",
            meals_per_day=3,
            meals_logged=0,
            calories_eaten=0,
            calorie_target=2100,
            protein_eaten=0,
            protein_target=150,
            fiber_eaten=0,
            fiber_target=30,
            fat_eaten=0,
            fat_target=70,
            water_ml=0,
            water_target_ml=2500,
            high_carb_meal=False,
            late_first_meal=False,
            logged_food_items=(),
        )
        active_triggers = {"no_logs"}

    selected: list[dict[str, Any]] = []
    for relax in (False, True):
        pool = _eligible_tips(
            ctx,
            active_triggers,
            relax_cooldown=relax,
            db=db,
            user_id=user.id,
            as_of=as_of,
        )
        if relax:
            pool.sort(
                key=lambda t: (
                    int(t["priority"]),
                    _last_shown_on(db, user.id, str(t["id"])) or date.min,
                    str(t["id"]),
                )
            )
        for tip in pool:
            if len(selected) >= TIP_COUNT:
                break
            if any(s["id"] == tip["id"] for s in selected):
                continue
            selected.append(tip)
        if len(selected) >= TIP_COUNT:
            break

    if len(selected) < TIP_COUNT:
        evergreen = [
            tip
            for tip in load_tip_library()
            if not tip.get("triggers")
            and _tip_matches_diet(list(tip.get("diet") or []), ctx.diet_type)
            and not _tip_excluded_for_onboarding_diet(tip, ctx.onboarding_diet)
            and _tip_matches_goal(list(tip.get("goals") or []), ctx.goal)
        ]
        evergreen.sort(key=lambda t: (int(t.get("priority") or 5), str(t["id"])))
        for tip in evergreen:
            if len(selected) >= TIP_COUNT:
                break
            if any(s["id"] == tip["id"] for s in selected):
                continue
            selected.append(tip)

    payload = [_serialize_tip(t) for t in selected[:TIP_COUNT]]
    if payload:
        _record_shown_tips(db, user.id, [t["id"] for t in payload], as_of)
    return payload
