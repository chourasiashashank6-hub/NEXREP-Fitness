"""Deterministic Coach Journey Engine detectors (flag-gated at call sites)."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.journey_event import JourneyEvent
from src.models.models import StrengthLift, User, Workout
from src.models.nutrition_calories import DailyNutritionLog, MealEntry
from src.services.calorie_log_targets import get_calorie_log_targets
from src.services.coach_volume_read import BASE_MUSCLES, read_muscle_sets_in_window
from src.services.journey_engine_config import journey_engine_enabled
from src.services.nutrition_log_read import nutrition_day_actuals, resolve_user_log_today

logger = logging.getLogger(__name__)

PROTEIN_GAP_RATIO = 0.8
PROTEIN_GAP_MIN_DAYS = 3
ADHERENCE_MIN_DAYS = 5
ADHERENCE_WINDOW_DAYS = 7
VOLUME_SPIKE_MIN_PREVIOUS_SETS = 2
VOLUME_SPIKE_PCT = 15
PLATEAU_WEEKS = 4
PLATEAU_MIN_LIFTS = 2
DISENGAGEMENT_WORKOUT_DAYS = 3
DISENGAGEMENT_NUTRITION_DAYS = 2


def _iso_week_key(d: date) -> str:
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def _estimated_one_rep_max(weight_kg: float, reps: int) -> float:
    return round(float(weight_kg) * (1 + int(reps) / 30), 1)


def upsert_active_event(
    db: Session,
    *,
    user_id: int,
    domain: str,
    event_type: str,
    pattern_key: str,
    payload: dict[str, Any],
    detected_at: datetime | None = None,
) -> JourneyEvent:
    detected_at = detected_at or datetime.utcnow()
    existing = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user_id,
            JourneyEvent.domain == domain,
            JourneyEvent.event_type == event_type,
            JourneyEvent.status == "active",
            JourneyEvent.payload_json["pattern_key"].astext == pattern_key,
        )
        .first()
    )
    merged = {**payload, "pattern_key": pattern_key}
    if existing:
        existing.payload_json = merged
        existing.updated_at = datetime.utcnow()
        db.flush()
        return existing
    row = JourneyEvent(
        user_id=user_id,
        domain=domain,
        event_type=event_type,
        status="active",
        detected_at=detected_at,
        payload_json=merged,
    )
    db.add(row)
    db.flush()
    return row


def resolve_active_event(
    db: Session,
    *,
    user_id: int,
    domain: str,
    event_type: str,
    pattern_key: str,
) -> None:
    existing = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user_id,
            JourneyEvent.domain == domain,
            JourneyEvent.event_type == event_type,
            JourneyEvent.status == "active",
            JourneyEvent.payload_json["pattern_key"].astext == pattern_key,
        )
        .first()
    )
    if not existing:
        return
    existing.status = "resolved"
    existing.resolved_at = datetime.utcnow()
    existing.updated_at = datetime.utcnow()
    db.flush()


def _last_workout_date(db: Session, user_id: int, before: date | None = None) -> date | None:
    query = db.query(func.max(func.date(Workout.date))).filter(Workout.user_id == user_id)
    if before is not None:
        query = query.filter(func.date(Workout.date) < before)
    value = query.scalar()
    return value if isinstance(value, date) else None


def _last_meal_log_date(db: Session, user_id: int, before: date | None = None) -> date | None:
    query = (
        db.query(func.max(DailyNutritionLog.log_date))
        .join(MealEntry, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id)
    )
    if before is not None:
        query = query.filter(DailyNutritionLog.log_date < before)
    value = query.scalar()
    return value if isinstance(value, date) else None


def detect_protein_gap_streak(db: Session, user: User, today: date) -> None:
    targets = get_calorie_log_targets(db, user)
    target_protein = float(targets.get("target_protein_g") or 0)
    if target_protein <= 0:
        resolve_active_event(db, user_id=user.id, domain="nutrition", event_type="protein_gap_streak", pattern_key="protein_gap")
        return

    streak_days = 0
    streak_start: date | None = None
    today_protein = nutrition_day_actuals(db, user, today)["protein_g"]
    for offset in range(PROTEIN_GAP_MIN_DAYS + 4):
        day = today - timedelta(days=offset)
        actuals = nutrition_day_actuals(db, user, day)
        protein = actuals["protein_g"]
        if protein < target_protein * PROTEIN_GAP_RATIO:
            streak_days += 1
            streak_start = day
        else:
            break

    pattern_key = "protein_gap"
    if streak_days >= PROTEIN_GAP_MIN_DAYS and streak_start is not None:
        upsert_active_event(
            db,
            user_id=user.id,
            domain="nutrition",
            event_type="protein_gap_streak",
            pattern_key=pattern_key,
            payload={
                "streak_days": streak_days,
                "streak_started_at": streak_start.isoformat(),
                "protein_g": round(today_protein, 1),
                "target_protein_g": round(target_protein, 1),
            },
        )
    else:
        resolve_active_event(db, user_id=user.id, domain="nutrition", event_type="protein_gap_streak", pattern_key=pattern_key)


def detect_adherence_trend(db: Session, user: User, today: date) -> None:
    days_on_target = 0
    for offset in range(ADHERENCE_WINDOW_DAYS):
        day = today - timedelta(days=offset)
        actuals = nutrition_day_actuals(db, user, day)
        target_cal = actuals["target_calories"]
        protein_target = actuals["target_protein_g"]
        if target_cal <= 0 or protein_target <= 0:
            continue
        calories = actuals["calories"]
        protein = actuals["protein_g"]
        if calories >= target_cal * 0.9 and protein >= protein_target * 0.9:
            days_on_target += 1

    pattern_key = "adherence_trend"
    if days_on_target >= ADHERENCE_MIN_DAYS:
        upsert_active_event(
            db,
            user_id=user.id,
            domain="nutrition",
            event_type="adherence_trend",
            pattern_key=pattern_key,
            payload={"days_on_target": days_on_target, "window_days": ADHERENCE_WINDOW_DAYS},
        )
    else:
        resolve_active_event(db, user_id=user.id, domain="nutrition", event_type="adherence_trend", pattern_key=pattern_key)


def detect_volume_spikes(db: Session, user: User, now: datetime) -> None:
    current_start = now - timedelta(days=7)
    previous_start = now - timedelta(days=14)
    current_sets = read_muscle_sets_in_window(db, user.id, current_start, now)
    previous_sets = read_muscle_sets_in_window(db, user.id, previous_start, current_start)
    week_key = _iso_week_key(now.date())

    active_keys: set[str] = set()
    for muscle in BASE_MUSCLES:
        prev = previous_sets.get(muscle, 0)
        curr = current_sets.get(muscle, 0)
        pattern_key = f"volume_spike:{muscle}:{week_key}"
        if prev >= VOLUME_SPIKE_MIN_PREVIOUS_SETS and prev > 0:
            increase_pct = round(((curr - prev) / prev) * 100)
            if increase_pct >= VOLUME_SPIKE_PCT:
                active_keys.add(pattern_key)
                upsert_active_event(
                    db,
                    user_id=user.id,
                    domain="workout",
                    event_type="volume_spike",
                    pattern_key=pattern_key,
                    payload={
                        "muscle": muscle,
                        "metric": "set_volume",
                        "percent_increase": increase_pct,
                        "current_sets": curr,
                        "previous_sets": prev,
                        "week_key": week_key,
                    },
                )
            else:
                resolve_active_event(db, user_id=user.id, domain="workout", event_type="volume_spike", pattern_key=pattern_key)

    stale = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user.id,
            JourneyEvent.domain == "workout",
            JourneyEvent.event_type == "volume_spike",
            JourneyEvent.status == "active",
        )
        .all()
    )
    for row in stale:
        key = str((row.payload_json or {}).get("pattern_key") or "")
        if key.startswith("volume_spike:") and key not in active_keys:
            resolve_active_event(db, user_id=user.id, domain="workout", event_type="volume_spike", pattern_key=key)


def detect_plateaus(db: Session, user: User, today: date) -> None:
    cutoff = datetime.combine(today - timedelta(weeks=PLATEAU_WEEKS), datetime.min.time())
    lifts = (
        db.query(StrengthLift)
        .filter(StrengthLift.user_id == user.id, StrengthLift.date >= cutoff)
        .order_by(StrengthLift.date.asc())
        .all()
    )
    by_exercise: dict[str, list[StrengthLift]] = {}
    for lift in lifts:
        name = (lift.exercise_name or "").strip()
        if not name:
            continue
        by_exercise.setdefault(name.lower(), []).append(lift)

    active_keys: set[str] = set()
    for exercise_key, entries in by_exercise.items():
        if len(entries) < PLATEAU_MIN_LIFTS:
            continue
        best_1rm = max(_estimated_one_rep_max(row.weight_kg, row.reps) for row in entries)
        recent = entries[-1]
        recent_1rm = _estimated_one_rep_max(recent.weight_kg, recent.reps)
        pattern_key = f"plateau:{exercise_key}"
        if recent_1rm >= best_1rm * 0.98:
            active_keys.add(pattern_key)
            upsert_active_event(
                db,
                user_id=user.id,
                domain="workout",
                event_type="plateau",
                pattern_key=pattern_key,
                payload={
                    "exercise_name": recent.exercise_name,
                    "weeks_flat": PLATEAU_WEEKS,
                    "best_weight_kg": round(float(recent.weight_kg), 1),
                    "best_1rm_kg": round(best_1rm, 1),
                    "source": "strength_lifts",
                },
            )
        else:
            resolve_active_event(db, user_id=user.id, domain="workout", event_type="plateau", pattern_key=pattern_key)

    stale = (
        db.query(JourneyEvent)
        .filter(
            JourneyEvent.user_id == user.id,
            JourneyEvent.domain == "workout",
            JourneyEvent.event_type == "plateau",
            JourneyEvent.status == "active",
        )
        .all()
    )
    for row in stale:
        key = str((row.payload_json or {}).get("pattern_key") or "")
        if key.startswith("plateau:") and key not in active_keys:
            resolve_active_event(db, user_id=user.id, domain="workout", event_type="plateau", pattern_key=key)


def detect_disengagement(db: Session, user: User, today: date) -> None:
    last_workout = _last_workout_date(db, user.id)
    last_meal = _last_meal_log_date(db, user.id)

    if last_workout is not None:
        days_since_workout = (today - last_workout).days
        pattern_key = "disengagement:workout"
        if days_since_workout >= DISENGAGEMENT_WORKOUT_DAYS:
            upsert_active_event(
                db,
                user_id=user.id,
                domain="engagement",
                event_type="disengagement",
                pattern_key=pattern_key,
                payload={
                    "disengagement_domain": "workout",
                    "domain_label": "workout",
                    "days_since": days_since_workout,
                    "last_activity_date": last_workout.isoformat(),
                },
            )
        else:
            resolve_active_event(db, user_id=user.id, domain="engagement", event_type="disengagement", pattern_key=pattern_key)

    if last_meal is not None:
        days_since_meal = (today - last_meal).days
        pattern_key = "disengagement:nutrition"
        if days_since_meal >= DISENGAGEMENT_NUTRITION_DAYS:
            upsert_active_event(
                db,
                user_id=user.id,
                domain="engagement",
                event_type="disengagement",
                pattern_key=pattern_key,
                payload={
                    "disengagement_domain": "nutrition",
                    "domain_label": "nutrition",
                    "days_since": days_since_meal,
                    "last_activity_date": last_meal.isoformat(),
                },
            )
        else:
            resolve_active_event(db, user_id=user.id, domain="engagement", event_type="disengagement", pattern_key=pattern_key)


def run_journey_detection_for_user(
    db: Session,
    user: User,
    now: datetime | None = None,
    *,
    log_today: date | None = None,
) -> None:
    if not journey_engine_enabled():
        return
    now = now or datetime.utcnow()
    today = log_today or resolve_user_log_today(db, user.id, now)
    detect_protein_gap_streak(db, user, today)
    detect_adherence_trend(db, user, today)
    detect_volume_spikes(db, user, now)
    detect_plateaus(db, user, today)
    detect_disengagement(db, user, today)


def run_journey_detection(db: Session, now: datetime | None = None) -> None:
    if not journey_engine_enabled():
        return
    now = now or datetime.utcnow()
    users = db.query(User).all()
    for user in users:
        try:
            run_journey_detection_for_user(db, user, now)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("journey detection failed for user_id=%s", user.id)
