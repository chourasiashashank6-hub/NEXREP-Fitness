"""Deterministic coach summary aggregates (rule-engine source for cadence views)."""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.journey_event import JourneyEvent
from src.models.models import User, UserOnboarding
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry, WaterIntakeLog
from src.models.weight_log import WeightLog
from src.services.activity_feed_service import calculate_user_streak
from src.services.calorie_log_targets import get_calorie_log_targets
from src.services.coach_redesign_config import coach_redesign_enabled
from src.services.journey_recommendations import recommendation_for_event

from src.services.coach_summary_labels import score_label_key

MACRO_ON_TRACK_RATIO = 0.8
MACRO_HIGH_RATIO = 1.15
ADHERENCE_CAL_RATIO = 0.9
ADHERENCE_PROTEIN_RATIO = 0.9


def macro_status(consumed: float, target: float) -> str:
    if target <= 0:
        return "on_track"
    ratio = consumed / target
    if ratio < MACRO_ON_TRACK_RATIO:
        return "low"
    if ratio > MACRO_HIGH_RATIO:
        return "high"
    return "on_track"


def day_on_target(calories: float, target_cal: float, protein: float, target_protein: float) -> bool:
    if target_cal <= 0 or target_protein <= 0:
        return False
    return calories >= target_cal * ADHERENCE_CAL_RATIO and protein >= target_protein * ADHERENCE_PROTEIN_RATIO


def day_adherence_pct(calories: float, target_cal: float, protein: float, target_protein: float) -> int:
    if target_cal <= 0:
        return 0
    cal_pct = (calories / target_cal) * 100
    pro_pct = (protein / target_protein * 100) if target_protein > 0 else cal_pct
    return int(round((cal_pct + pro_pct) / 2))


def daily_score(
    *,
    calories: float,
    target_cal: float,
    protein: float,
    protein_target: float,
    carbs: float,
    carbs_target: float,
    fat: float,
    fat_target: float,
    water_l: float,
    water_target_l: float,
    meals_count: int,
) -> int:
    remaining = target_cal - calories
    cal_adherence = max(0, 100 - abs(remaining) / max(target_cal, 1) * 40) if remaining >= 0 else max(0, 60 - abs(remaining) / 50)
    macro_bal = (
        (100 if macro_status(protein, protein_target) == "on_track" else 50)
        + (100 if macro_status(carbs, carbs_target) == "on_track" else 50)
        + (100 if macro_status(fat, fat_target) == "on_track" else 50)
    ) / 3
    water_ml = water_l * 1000
    water_target_ml = max(water_target_l * 1000, 1)
    hyd_score = min(100, (water_ml / water_target_ml) * 100)
    meal_score = min(100, (meals_count / 3) * 100)
    return int(round(cal_adherence * 0.4 + macro_bal * 0.3 + hyd_score * 0.15 + meal_score * 0.15))


def _meal_counts(db: Session, user_id: int, log_date: date) -> int:
    manual = (
        db.query(func.count(MealEntry.meal_id))
        .join(DailyNutritionLog, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date == log_date)
        .scalar()
        or 0
    )
    ai = (
        db.query(func.count(AIFoodMealEntry.ai_meal_id))
        .filter(AIFoodMealEntry.user_id == user_id, AIFoodMealEntry.log_date == log_date)
        .scalar()
        or 0
    )
    return int(manual) + int(ai)


def day_nutrition_snapshot(db: Session, user: User, log_date: date) -> dict[str, Any]:
    from src.routes.calories import _get_or_create_daily_log, recalculate_daily_log

    targets = get_calorie_log_targets(db, user)
    meals_count = _meal_counts(db, user.id, log_date)
    logged = meals_count > 0

    if not logged:
        return {
            "date": log_date.isoformat(),
            "logged": False,
            "meals_count": 0,
            "calories": 0.0,
            "protein_g": 0.0,
            "carbs_g": 0.0,
            "fat_g": 0.0,
            "water_l": 0.0,
            "target_calories": float(targets["target_calories"]),
            "target_protein_g": float(targets["target_protein_g"]),
            "target_carbs_g": float(targets["target_carbs_g"]),
            "target_fat_g": float(targets["target_fat_g"]),
            "target_water_l": float(targets["target_water_l"]),
            "calories_remaining": float(targets["target_calories"]),
            "on_target": False,
            "adherence_pct": 0,
            "macro_status": {
                "protein": macro_status(0, float(targets["target_protein_g"])),
                "carbs": macro_status(0, float(targets["target_carbs_g"])),
                "fat": macro_status(0, float(targets["target_fat_g"])),
            },
            "score": 0,
            "score_label_key": score_label_key(0),
        }

    log = _get_or_create_daily_log(db, user, log_date)
    recalculate_daily_log(db, log)
    db.flush()
    water = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == user.id, WaterIntakeLog.log_date == log_date).first()
    water_l = float(water.total_water_l if water else log.total_water_l or 0)
    water_target_l = float(water.target_water_l if water else log.target_water_l or targets["target_water_l"])

    calories = float(log.total_calories or 0)
    protein = float(log.total_protein_g or 0)
    carbs = float(log.total_carbs_g or 0)
    fat = float(log.total_fat_g or 0)
    target_cal = float(log.target_calories or 0)
    target_protein = float(log.target_protein_g or 0)
    target_carbs = float(log.target_carbs_g or 0)
    target_fat = float(log.target_fat_g or 0)

    score = daily_score(
        calories=calories,
        target_cal=target_cal,
        protein=protein,
        protein_target=target_protein,
        carbs=carbs,
        carbs_target=target_carbs,
        fat=fat,
        fat_target=target_fat,
        water_l=water_l,
        water_target_l=water_target_l,
        meals_count=meals_count,
    )

    return {
        "date": log_date.isoformat(),
        "logged": True,
        "meals_count": meals_count,
        "calories": round(calories, 1),
        "protein_g": round(protein, 1),
        "carbs_g": round(carbs, 1),
        "fat_g": round(fat, 1),
        "water_l": round(water_l, 2),
        "target_calories": round(target_cal, 1),
        "target_protein_g": round(target_protein, 1),
        "target_carbs_g": round(target_carbs, 1),
        "target_fat_g": round(target_fat, 1),
        "target_water_l": round(water_target_l, 2),
        "calories_remaining": round(max(0, target_cal - calories), 1),
        "on_target": day_on_target(calories, target_cal, protein, target_protein),
        "adherence_pct": day_adherence_pct(calories, target_cal, protein, target_protein),
        "macro_status": {
            "protein": macro_status(protein, target_protein),
            "carbs": macro_status(carbs, target_carbs),
            "fat": macro_status(fat, target_fat),
        },
        "score": score,
        "score_label_key": score_label_key(score),
    }


def _period_bounds(cadence: str, anchor: date) -> tuple[date, date]:
    if cadence == "daily":
        return anchor, anchor
    if cadence == "weekly":
        return anchor - timedelta(days=6), anchor
    if cadence == "monthly":
        return anchor.replace(day=1), anchor
    raise ValueError(f"Unsupported cadence: {cadence}")


def _iter_dates(start: date, end: date) -> list[date]:
    out: list[date] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _aggregate_days(days: list[dict[str, Any]]) -> dict[str, Any]:
    logged_days = [d for d in days if d.get("logged")]
    days_total = len(days)
    days_logged = len(logged_days)
    days_on_target = sum(1 for d in logged_days if d.get("on_target"))

    def avg(field: str) -> float:
        if not logged_days:
            return 0.0
        return round(sum(float(d.get(field) or 0) for d in logged_days) / len(logged_days), 1)

    return {
        "days_total": days_total,
        "days_logged": days_logged,
        "days_on_target": days_on_target,
        "adherence_pct": int(round((days_on_target / days_total) * 100)) if days_total else 0,
        "avg_calories": avg("calories"),
        "avg_protein_g": avg("protein_g"),
        "avg_carbs_g": avg("carbs_g"),
        "avg_fat_g": avg("fat_g"),
        "avg_water_l": avg("water_l"),
    }


def _weight_in_range(db: Session, user_id: int, start: date, end: date) -> dict[str, Any]:
    rows = (
        db.query(WeightLog)
        .filter(
            WeightLog.user_id == user_id,
            WeightLog.log_date >= start.isoformat(),
            WeightLog.log_date <= end.isoformat(),
        )
        .order_by(WeightLog.log_date.asc())
        .all()
    )
    if not rows:
        return {"start_kg": None, "end_kg": None, "change_kg": None, "weigh_ins": 0}
    start_kg = float(rows[0].weight_kg)
    end_kg = float(rows[-1].weight_kg)
    return {
        "start_kg": round(start_kg, 1),
        "end_kg": round(end_kg, 1),
        "change_kg": round(end_kg - start_kg, 1),
        "weigh_ins": len(rows),
    }


def _onboarding_target_weight_kg(db: Session, user_id: int) -> float | None:
    from src.routes.calories import _onboarding_target_weight_kg

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = ob.onboarding_json if ob and isinstance(ob.onboarding_json, dict) else {}
    return _onboarding_target_weight_kg(onboarding)


def _goal_pacing(db: Session, user: User, current_kg: float | None, target_kg: float | None) -> str | None:
    if current_kg is None or target_kg is None:
        return None
    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    targets_json = ob.targets_json if ob and isinstance(ob.targets_json, dict) else {}
    timeline = targets_json.get("timeline") if isinstance(targets_json.get("timeline"), dict) else {}
    try:
        weekly = float(timeline.get("weekly_change_kg") or timeline.get("weekly_delta_kg") or 0)
    except (TypeError, ValueError):
        weekly = 0
    if weekly <= 0:
        return None
    weeks = max(0, round(abs(current_kg - target_kg) / weekly))
    if weeks == 0:
        return "on_pace_now"
    if weeks <= 4:
        return f"on_pace_{weeks}w"
    return "on_pace_4w"


def _nutrition_journey_events(db: Session, user_id: int, start: date, end: date) -> list[dict[str, Any]]:
    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time())
    rows = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user_id,
            JourneyEvent.detected_at >= start_dt,
            JourneyEvent.detected_at < end_dt,
        )
        .order_by(JourneyEvent.detected_at.desc())
        .limit(20)
        .all()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        if row.domain not in ("nutrition", "engagement"):
            continue
        payload = row.payload_json if isinstance(row.payload_json, dict) else {}
        if row.domain == "engagement" and payload.get("disengagement_domain") != "nutrition":
            continue
        rec_key, rec_params = recommendation_for_event(row.event_type, payload)
        out.append(
            {
                "id": row.id,
                "event_type": row.event_type,
                "status": row.status,
                "detected_at": row.detected_at.isoformat() if row.detected_at else None,
                "recommendation_key": rec_key,
                "recommendation_params": rec_params,
            }
        )
    return out


def _build_daily_focus(day: dict[str, Any]) -> dict[str, Any]:
    if not day.get("logged"):
        return {"key": "coach.summary.nutrition.daily.focusLogMeals", "params": {}}
    ms = day.get("macro_status") or {}
    macro_fields = {
        "protein": ("protein_g", "target_protein_g"),
        "carbs": ("carbs_g", "target_carbs_g"),
        "fat": ("fat_g", "target_fat_g"),
    }
    for name, (cur_key, tgt_key) in macro_fields.items():
        if ms.get(name) == "low":
            gap_g = max(0, round(float(day.get(tgt_key) or 0) - float(day.get(cur_key) or 0)))
            return {
                "key": f"coach.summary.nutrition.daily.focus{name.capitalize()}Gap",
                "params": {"gapG": gap_g},
            }
    remaining = float(day.get("calories_remaining") or 0)
    if remaining > 200:
        return {
            "key": "coach.summary.nutrition.daily.focusBalancedMeal",
            "params": {"remaining": int(round(remaining))},
        }
    return {"key": "coach.summary.nutrition.daily.focusOnTrack", "params": {}}


def _build_weekly_notes(
    agg: dict[str, Any],
    days: list[dict[str, Any]],
    prev_agg: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    if prev_agg and int(prev_agg.get("days_logged") or 0) > 0:
        prev_pct = int(prev_agg.get("adherence_pct") or 0)
        curr_pct = int(agg.get("adherence_pct") or 0)
        if curr_pct != prev_pct:
            weekend_miss = sum(
                1
                for d in days
                if d.get("logged") and not d.get("on_target") and date.fromisoformat(str(d["date"])).weekday() >= 5
            )
            notes.append(
                {
                    "kind": "what_changed",
                    "key": "coach.summary.nutrition.weekly.whatChanged",
                    "params": {
                        "prevPct": prev_pct,
                        "currPct": curr_pct,
                        "weekendMissDays": weekend_miss,
                    },
                }
            )
    if int(agg.get("days_logged") or 0) > 0:
        lowest_macro = min(
            [
                ("protein", float(agg.get("avg_protein_g") or 0)),
                ("carbs", float(agg.get("avg_carbs_g") or 0)),
                ("fat", float(agg.get("avg_fat_g") or 0)),
            ],
            key=lambda x: x[1],
        )[0]
        notes.append(
            {
                "kind": "fix_next_week",
                "key": "coach.summary.nutrition.weekly.fixMacro",
                "params": {"macro": lowest_macro},
            }
        )
    return notes


def _build_monthly_notes(
    agg: dict[str, Any],
    mom: dict[str, Any] | None,
    weight: dict[str, Any],
) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    if mom and mom.get("comparable") and mom.get("adherence_pct_delta") is not None:
        delta = int(mom["adherence_pct_delta"])
        if delta <= -5:
            notes.append(
                {
                    "kind": "recurring_pattern",
                    "key": "coach.summary.nutrition.monthly.patternAdherenceDown",
                    "params": {"delta": abs(delta)},
                }
            )
        elif delta >= 5:
            notes.append(
                {
                    "kind": "recurring_pattern",
                    "key": "coach.summary.nutrition.monthly.patternAdherenceUp",
                    "params": {"delta": delta},
                }
            )
    change = weight.get("change_kg")
    if change is not None and change < -0.5:
        notes.append(
            {
                "kind": "biggest_win",
                "key": "coach.summary.nutrition.monthly.winWeight",
                "params": {"changeKg": change},
            }
        )
    elif int(agg.get("days_on_target") or 0) >= 10:
        notes.append(
            {
                "kind": "biggest_win",
                "key": "coach.summary.nutrition.monthly.winAdherence",
                "params": {"daysOnTarget": int(agg.get("days_on_target") or 0)},
            }
        )
    if int(agg.get("days_logged") or 0) > 0:
        notes.append(
            {
                "kind": "next_month",
                "key": "coach.summary.nutrition.monthly.nextProtein",
                "params": {"avgProteinG": float(agg.get("avg_protein_g") or 0)},
            }
        )
    return notes


def build_nutrition_summary(db: Session, user: User, cadence: str, local_date: date) -> dict[str, Any]:
    start, end = _period_bounds(cadence, local_date)
    dates = _iter_dates(start, end)
    day_rows = [day_nutrition_snapshot(db, user, d) for d in dates]
    targets = get_calorie_log_targets(db, user)
    streak = calculate_user_streak(db, user.id)

    days_with_data = sum(1 for d in day_rows if d.get("logged"))
    payload: dict[str, Any] = {
        "domain": "nutrition",
        "cadence": cadence,
        "period": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "days_in_period": len(dates),
            "days_with_data": days_with_data,
            "label_partial": (
                (cadence == "weekly" and days_with_data < len(dates))
                or (cadence == "monthly" and end.day < calendar.monthrange(end.year, end.month)[1])
            ),
        },
        "targets": {
            "target_calories": float(targets["target_calories"]),
            "target_protein_g": float(targets["target_protein_g"]),
            "target_carbs_g": float(targets["target_carbs_g"]),
            "target_fat_g": float(targets["target_fat_g"]),
            "target_water_l": float(targets["target_water_l"]),
        },
        "streak": {
            "current_streak": streak.get("current_streak", 0),
            "personal_best_streak": streak.get("personal_best_streak", 0),
        },
        "journey_events": _nutrition_journey_events(db, user.id, start, end),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }

    if cadence == "daily":
        day = day_rows[-1] if day_rows else day_nutrition_snapshot(db, user, local_date)
        payload["daily"] = day
        if day.get("logged"):
            payload["notes"] = [{"kind": "todays_focus", **_build_daily_focus(day)}]
        return payload

    agg = _aggregate_days(day_rows)
    payload["daily_breakdown"] = [
        {
            "date": d["date"],
            "logged": d.get("logged"),
            "adherence_pct": d.get("adherence_pct"),
            "on_target": d.get("on_target"),
        }
        for d in day_rows
    ]

    if cadence == "weekly":
        prev_start = start - timedelta(days=7)
        prev_end = start - timedelta(days=1)
        prev_days = [day_nutrition_snapshot(db, user, d) for d in _iter_dates(prev_start, prev_end)]
        prev_agg = _aggregate_days(prev_days)
        payload["weekly"] = {
            **agg,
            "week_score": int(round((int(agg.get("adherence_pct") or 0) + min(100, int(agg.get("days_logged", 0) / max(agg.get("days_total"), 1) * 100))) / 2)),
            "label_days": agg["days_total"],
            "hero_label_key": "coach.summary.nutrition.weekly.heroTitle",
        }
        payload["notes"] = _build_weekly_notes(agg, day_rows, prev_agg)
        return payload

    if cadence == "monthly":
        month_start = start
        prev_month_end = month_start - timedelta(days=1)
        prev_month_start = prev_month_end.replace(day=1)
        prev_span_days = min(end.day, prev_month_end.day)
        prev_end_cmp = prev_month_start.replace(day=min(prev_span_days, prev_month_end.day))
        prev_days = [day_nutrition_snapshot(db, user, d) for d in _iter_dates(prev_month_start, prev_end_cmp)]
        prev_agg = _aggregate_days(prev_days)
        weight = _weight_in_range(db, user.id, month_start, end)
        target_kg = _onboarding_target_weight_kg(db, user.id)
        pacing = _goal_pacing(db, user, weight.get("end_kg"), target_kg)
        mom = None
        if prev_agg.get("days_logged"):
            mom = {
                "adherence_pct": int(prev_agg.get("adherence_pct") or 0),
                "adherence_pct_delta": int(agg.get("adherence_pct") or 0) - int(prev_agg.get("adherence_pct") or 0),
                "avg_protein_g": float(prev_agg.get("avg_protein_g") or 0),
                "avg_protein_g_delta": round(float(agg.get("avg_protein_g") or 0) - float(prev_agg.get("avg_protein_g") or 0), 1),
                "days_logged": int(prev_agg.get("days_logged") or 0),
                "days_logged_delta": int(agg.get("days_logged") or 0) - int(prev_agg.get("days_logged") or 0),
                "comparable": True,
            }
        payload["monthly"] = {
            **agg,
            "weight": weight,
            "target_weight_kg": target_kg,
            "pacing_key": pacing,
            "mom": mom,
        }
        payload["notes"] = _build_monthly_notes(agg, mom, weight)
        return payload

    raise ValueError(f"Unsupported cadence: {cadence}")


def build_coach_summary(db: Session, user: User, domain: str, cadence: str, local_date: date) -> dict[str, Any]:
    if not coach_redesign_enabled():
        return {"enabled": False}
    if domain == "workout":
        from src.services.coach_workout_summary_service import build_workout_summary

        return {"enabled": True, **build_workout_summary(db, user, cadence, local_date)}
    if domain != "nutrition":
        return {"enabled": True, "domain": domain, "cadence": cadence, "unsupported": True}
    return {"enabled": True, **build_nutrition_summary(db, user, cadence, local_date)}
