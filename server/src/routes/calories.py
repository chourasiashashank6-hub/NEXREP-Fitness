from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User, UserOnboarding
from src.models.nutrition_calories import DailyNutritionLog, MealEntry, WaterIntakeLog
from src.schemas.calories_api import DailyLogEnsureRequest, MealCreateRequest, WaterPatchRequest
from src.utils.auth import get_current_user

router = APIRouter()

MEAL_ORDER = ["Breakfast", "Lunch", "Dinner", "Snack", "Pre_Workout", "Post_Workout"]

DEFAULT_TARGETS = {
    "target_calories": 2100,
    "target_protein_g": Decimal("158"),
    "target_carbs_g": Decimal("210"),
    "target_fat_g": Decimal("70"),
    "target_water_l": Decimal("2.5"),
    "protein_pct": 30,
    "carbs_pct": 40,
    "fat_pct": 30,
}


def _to_decimal(v: Any, default: Decimal) -> Decimal:
    if v is None:
        return default
    try:
        return Decimal(str(v))
    except Exception:
        return default


def _parse_log_date(value: str | None) -> date:
    if not value:
        return datetime.utcnow().date()
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid date; use YYYY-MM-DD") from exc


def _targets_from_onboarding_json(targets: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(targets, dict):
        return dict(DEFAULT_TARGETS)
    macros = targets.get("macros") if isinstance(targets.get("macros"), dict) else {}
    out = {
        "target_calories": int(targets.get("target_kcal") or DEFAULT_TARGETS["target_calories"]),
        "target_protein_g": _to_decimal(macros.get("protein_g"), DEFAULT_TARGETS["target_protein_g"]),
        "target_carbs_g": _to_decimal(macros.get("carbs_g"), DEFAULT_TARGETS["target_carbs_g"]),
        "target_fat_g": _to_decimal(macros.get("fat_g"), DEFAULT_TARGETS["target_fat_g"]),
        "target_water_l": _to_decimal(macros.get("water_l"), DEFAULT_TARGETS["target_water_l"]),
        "protein_pct": int(macros.get("protein_pct") or DEFAULT_TARGETS["protein_pct"]),
        "carbs_pct": int(macros.get("carbs_pct") or DEFAULT_TARGETS["carbs_pct"]),
        "fat_pct": int(macros.get("fat_pct") or DEFAULT_TARGETS["fat_pct"]),
    }
    return out


def resolve_user_targets(db: Session, user_id: int) -> dict[str, Any]:
    """
    Prefer user_calorie_targets when present (is_current = true);
    otherwise use user_onboarding.targets_json; else defaults (2100 kcal, 2.5L, 30/40/30).
    """
    try:
        row = (
            db.execute(
                text(
                    """
                    SELECT target_calories, target_protein_g, target_carbs_g, target_fat_g, target_water_l,
                           protein_pct, carbs_pct, fat_pct
                    FROM user_calorie_targets
                    WHERE user_id = :uid AND is_current = true
                    LIMIT 1
                    """
                ),
                {"uid": user_id},
            )
            .mappings()
            .first()
        )
        if row:
            return {
                "target_calories": int(row["target_calories"] or DEFAULT_TARGETS["target_calories"]),
                "target_protein_g": _to_decimal(row["target_protein_g"], DEFAULT_TARGETS["target_protein_g"]),
                "target_carbs_g": _to_decimal(row["target_carbs_g"], DEFAULT_TARGETS["target_carbs_g"]),
                "target_fat_g": _to_decimal(row["target_fat_g"], DEFAULT_TARGETS["target_fat_g"]),
                "target_water_l": _to_decimal(row["target_water_l"], DEFAULT_TARGETS["target_water_l"]),
                "protein_pct": int(row["protein_pct"] or DEFAULT_TARGETS["protein_pct"]),
                "carbs_pct": int(row["carbs_pct"] or DEFAULT_TARGETS["carbs_pct"]),
                "fat_pct": int(row["fat_pct"] or DEFAULT_TARGETS["fat_pct"]),
            }
    except Exception:
        # Missing table, wrong schema, or aborted transaction — fall back to onboarding / defaults.
        db.rollback()

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    if ob and isinstance(ob.targets_json, dict):
        return _targets_from_onboarding_json(ob.targets_json)
    return dict(DEFAULT_TARGETS)


def _macro_label(t: dict[str, Any]) -> str:
    return f"Protein {t['protein_pct']}% · Carbs {t['carbs_pct']}% · Fat {t['fat_pct']}%"


def _ensure_water_row(db: Session, user_id: int, log_date: date, target_water_l: Decimal) -> WaterIntakeLog:
    row = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == user_id, WaterIntakeLog.log_date == log_date).first()
    if row:
        row.target_water_l = target_water_l
        row.is_target_met = bool(row.total_water_l >= row.target_water_l)
        return row
    row = WaterIntakeLog(
        user_id=user_id,
        log_date=log_date,
        total_water_l=Decimal("0"),
        target_water_l=target_water_l,
        is_target_met=False,
    )
    db.add(row)
    return row


def _get_or_create_daily_log(db: Session, user: User, log_date: date) -> DailyNutritionLog:
    log = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == log_date)
        .first()
    )
    t = resolve_user_targets(db, user.id)
    if log:
        log.target_calories = t["target_calories"]
        log.target_protein_g = t["target_protein_g"]
        log.target_carbs_g = t["target_carbs_g"]
        log.target_fat_g = t["target_fat_g"]
        log.target_water_l = t["target_water_l"]
        db.flush()
        _ensure_water_row(db, user.id, log_date, t["target_water_l"])
        db.flush()
        return log

    log = DailyNutritionLog(
        user_id=user.id,
        log_date=log_date,
        target_calories=t["target_calories"],
        target_protein_g=t["target_protein_g"],
        target_carbs_g=t["target_carbs_g"],
        target_fat_g=t["target_fat_g"],
        target_water_l=t["target_water_l"],
        total_calories=Decimal("0"),
        total_protein_g=Decimal("0"),
        total_carbs_g=Decimal("0"),
        total_fat_g=Decimal("0"),
        total_water_l=Decimal("0"),
        calories_remaining=Decimal(str(t["target_calories"])),
        is_goal_met=False,
    )
    db.add(log)
    db.flush()
    _ensure_water_row(db, user.id, log_date, t["target_water_l"])
    db.flush()
    return log


def recalculate_daily_log(db: Session, log: DailyNutritionLog) -> None:
    sums = (
        db.query(
            func.coalesce(func.sum(MealEntry.total_calories), 0),
            func.coalesce(func.sum(MealEntry.total_protein_g), 0),
            func.coalesce(func.sum(MealEntry.total_carbs_g), 0),
            func.coalesce(func.sum(MealEntry.total_fat_g), 0),
        )
        .filter(MealEntry.log_id == log.log_id)
        .one()
    )
    tc, tp, tcarbs, tf = (Decimal(str(x)) for x in sums)
    log.total_calories = tc
    log.total_protein_g = tp
    log.total_carbs_g = tcarbs
    log.total_fat_g = tf
    log.calories_remaining = Decimal(log.target_calories) - tc
    log.is_goal_met = bool(tc >= Decimal(log.target_calories) and tp >= Decimal(log.target_protein_g))

    water_row = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == log.user_id, WaterIntakeLog.log_date == log.log_date).first()
    if water_row:
        log.total_water_l = water_row.total_water_l
        water_row.target_water_l = log.target_water_l
        water_row.is_target_met = bool(water_row.total_water_l >= water_row.target_water_l)
    db.flush()


def _serialize_meal(m: MealEntry) -> dict[str, Any]:
    return {
        "meal_id": m.meal_id,
        "log_id": m.log_id,
        "meal_type": m.meal_type,
        "food_name": m.food_name,
        "quantity_g": float(m.quantity_g),
        "calories_per_100g": float(m.calories_per_100g),
        "protein_per_100g": float(m.protein_per_100g),
        "carbs_per_100g": float(m.carbs_per_100g),
        "fat_per_100g": float(m.fat_per_100g),
        "total_calories": float(m.total_calories),
        "total_protein_g": float(m.total_protein_g),
        "total_carbs_g": float(m.total_carbs_g),
        "total_fat_g": float(m.total_fat_g),
        "logged_at": m.logged_at.isoformat() if m.logged_at else None,
    }


def _serialize_day(db: Session, user: User, log_date: date) -> dict[str, Any]:
    log = _get_or_create_daily_log(db, user, log_date)
    recalculate_daily_log(db, log)
    db.commit()
    db.refresh(log)

    meals = (
        db.query(MealEntry)
        .filter(MealEntry.log_id == log.log_id)
        .order_by(MealEntry.logged_at.asc(), MealEntry.meal_id.asc())
        .all()
    )
    water = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == user.id, WaterIntakeLog.log_date == log_date).first()
    t = resolve_user_targets(db, user.id)

    return {
        "date": log_date.isoformat(),
        "macro_split_label": _macro_label(t),
        "log": {
            "log_id": log.log_id,
            "user_id": log.user_id,
            "log_date": log.log_date.isoformat(),
            "total_calories": float(log.total_calories),
            "total_protein_g": float(log.total_protein_g),
            "total_carbs_g": float(log.total_carbs_g),
            "total_fat_g": float(log.total_fat_g),
            "total_water_l": float(log.total_water_l),
            "target_calories": log.target_calories,
            "target_protein_g": float(log.target_protein_g),
            "target_carbs_g": float(log.target_carbs_g),
            "target_fat_g": float(log.target_fat_g),
            "target_water_l": float(log.target_water_l),
            "calories_remaining": float(log.calories_remaining),
            "is_goal_met": log.is_goal_met,
        },
        "water": {
            "total_water_l": float(water.total_water_l) if water else float(log.total_water_l),
            "target_water_l": float(water.target_water_l) if water else float(log.target_water_l),
            "is_target_met": bool(water.is_target_met) if water else False,
        },
        "meals": [_serialize_meal(m) for m in meals],
    }


@router.post("/daily-log")
def ensure_daily_log(
    payload: DailyLogEnsureRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = _parse_log_date(payload.date if payload else None)
    return _serialize_day(db, current_user, log_date)


@router.get("/daily-log/{log_date}")
def get_daily_log(log_date: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = _parse_log_date(log_date)
    return _serialize_day(db, current_user, d)


@router.post("/meals")
def add_meal_entry(payload: MealCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_date = _parse_log_date(payload.log_date)
    log = _get_or_create_daily_log(db, current_user, log_date)
    db.flush()

    q = payload.quantity_g
    c100 = payload.calories_per_100g
    p100 = payload.protein_per_100g
    carb100 = payload.carbs_per_100g
    f100 = payload.fat_per_100g

    total_calories = (c100 / Decimal("100")) * q
    total_protein_g = (p100 / Decimal("100")) * q
    total_carbs_g = (carb100 / Decimal("100")) * q
    total_fat_g = (f100 / Decimal("100")) * q

    entry = MealEntry(
        log_id=log.log_id,
        user_id=current_user.id,
        meal_type=payload.meal_type,
        food_name=payload.food_name.strip()[:200],
        quantity_g=q,
        calories_per_100g=c100,
        protein_per_100g=p100,
        carbs_per_100g=carb100,
        fat_per_100g=f100,
        total_calories=total_calories,
        total_protein_g=total_protein_g,
        total_carbs_g=total_carbs_g,
        total_fat_g=total_fat_g,
    )
    db.add(entry)
    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    return _serialize_day(db, current_user, log_date)


@router.delete("/meals/{meal_id}")
def delete_meal_entry(meal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    meal = db.query(MealEntry).filter(MealEntry.meal_id == meal_id, MealEntry.user_id == current_user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    log = db.query(DailyNutritionLog).filter(DailyNutritionLog.log_id == meal.log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Daily log missing")
    log_date = log.log_date
    db.delete(meal)
    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    return _serialize_day(db, current_user, log_date)


@router.patch("/water")
def patch_water(payload: WaterPatchRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_date = _parse_log_date(payload.date)
    log = _get_or_create_daily_log(db, current_user, log_date)
    db.flush()
    water = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == current_user.id, WaterIntakeLog.log_date == log_date).first()
    if not water:
        water = _ensure_water_row(db, current_user.id, log_date, log.target_water_l)
        db.flush()

    cap = max(Decimal("5"), Decimal(log.target_water_l) * Decimal("2"))
    new_total = max(Decimal("0"), min(payload.water_l, cap))
    water.total_water_l = new_total
    water.target_water_l = log.target_water_l
    water.is_target_met = bool(new_total >= log.target_water_l)
    log.total_water_l = new_total
    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    return _serialize_day(db, current_user, log_date)
