"""Progress XP awarding, levels, seasons, and leaderboard helpers."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.models import User, UserOnboarding, Workout
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry
from src.models.recipes import UserMealPlan
from src.models.xp import UserXpTotal, XpEvent, XpSeason
from src.services.activity_feed_service import calculate_user_streak

logger = logging.getLogger(__name__)

XP_EXERCISE_LOGGED = 10
XP_ALL_MEALS_LOGGED = 20
XP_CALORIE_TARGET_HIT = 30
XP_STREAK_DAY_BONUS = 15

LEVEL_THRESHOLDS: list[tuple[int, int]] = [
    (1, 0),
    (2, 150),
    (3, 350),
    (4, 650),
    (5, 1000),
    (6, 1500),
    (7, 2100),
    (8, 2800),
    (9, 3600),
    (10, 4500),
]

COMEBACK_GAP_DAYS = 3
COMEBACK_SESSIONS = 2
COMEBACK_MULTIPLIER = 2


def level_for_total_xp(total_xp: int) -> int:
    level = 1
    for lvl, threshold in LEVEL_THRESHOLDS:
        if total_xp >= threshold:
            level = lvl
    return level


def xp_to_next_level(total_xp: int) -> tuple[int, int | None]:
    """Return (xp_into_current_level, xp_needed_for_next_level_or_none)."""
    current = level_for_total_xp(total_xp)
    current_threshold = next(th for lvl, th in LEVEL_THRESHOLDS if lvl == current)
    if current >= LEVEL_THRESHOLDS[-1][0]:
        return total_xp - current_threshold, None
    next_threshold = next(th for lvl, th in LEVEL_THRESHOLDS if lvl == current + 1)
    return total_xp - current_threshold, next_threshold - current_threshold


def _get_or_create_totals(db: Session, user_id: int) -> UserXpTotal:
    row = db.query(UserXpTotal).filter(UserXpTotal.user_id == user_id).first()
    if row:
        return row
    row = UserXpTotal(user_id=user_id, total_xp=0, level=1, comeback_sessions_remaining=0)
    db.add(row)
    db.flush()
    return row


def _has_idempotency_key(db: Session, user_id: int, key: str) -> bool:
    return (
        db.query(XpEvent.id)
        .filter(
            XpEvent.user_id == user_id,
            XpEvent.metadata_json["idempotency_key"].astext == key,
        )
        .first()
        is not None
    )


def _reversal_idempotency_key(original_key: str) -> str:
    return f"reverse:{original_key}"


def _find_award_event(db: Session, user_id: int, idempotency_key: str) -> XpEvent | None:
    return (
        db.query(XpEvent)
        .filter(
            XpEvent.user_id == user_id,
            XpEvent.metadata_json["idempotency_key"].astext == idempotency_key,
            XpEvent.xp_amount > 0,
        )
        .order_by(XpEvent.id.asc())
        .first()
    )


def _update_totals_after_xp_change(totals: UserXpTotal) -> None:
    """Keep total XP and level in sync — level drops when XP is reversed."""
    totals.total_xp = max(0, int(totals.total_xp or 0))
    totals.level = level_for_total_xp(totals.total_xp)
    totals.updated_at = datetime.utcnow()


def _reverse_xp_for_idempotency_key(
    db: Session,
    *,
    user_id: int,
    idempotency_key: str,
    metadata: dict[str, Any] | None = None,
) -> XpEvent | None:
    reversal_key = _reversal_idempotency_key(idempotency_key)
    if _has_idempotency_key(db, user_id, reversal_key):
        return None

    original = _find_award_event(db, user_id, idempotency_key)
    if not original:
        return None

    meta = dict(metadata or {})
    meta["idempotency_key"] = reversal_key
    meta["reverses_event_id"] = original.id
    meta["reverses_idempotency_key"] = idempotency_key
    if isinstance(original.metadata_json, dict):
        meta.setdefault("original_metadata", original.metadata_json)

    event = XpEvent(
        user_id=user_id,
        event_type=f"{original.event_type}_reversed",
        xp_amount=-int(original.xp_amount),
        metadata_json=meta,
    )
    db.add(event)
    db.flush()

    totals = _get_or_create_totals(db, user_id)
    totals.total_xp = int(totals.total_xp or 0) - int(original.xp_amount)
    _update_totals_after_xp_change(totals)
    db.flush()
    return event


def _last_activity_date(db: Session, user_id: int, before: date) -> date | None:
    last_workout = (
        db.query(func.max(func.date(Workout.date)))
        .filter(Workout.user_id == user_id, func.date(Workout.date) < before)
        .scalar()
    )
    last_meal = (
        db.query(func.max(DailyNutritionLog.log_date))
        .join(MealEntry, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date < before)
        .scalar()
    )
    candidates = [d for d in (last_workout, last_meal) if d is not None]
    return max(candidates) if candidates else None


def _maybe_activate_comeback(db: Session, user_id: int, activity_date: date) -> None:
    totals = _get_or_create_totals(db, user_id)
    if totals.comeback_sessions_remaining > 0:
        return
    last = _last_activity_date(db, user_id, activity_date)
    if last is None:
        return
    if (activity_date - last).days >= COMEBACK_GAP_DAYS:
        totals.comeback_sessions_remaining = COMEBACK_SESSIONS


def _award_xp(
    db: Session,
    *,
    user_id: int,
    event_type: str,
    base_xp: int,
    idempotency_key: str,
    metadata: dict[str, Any] | None = None,
) -> XpEvent | None:
    if base_xp <= 0:
        return None
    if _has_idempotency_key(db, user_id, idempotency_key):
        return None

    totals = _get_or_create_totals(db, user_id)
    multiplier = COMEBACK_MULTIPLIER if totals.comeback_sessions_remaining > 0 else 1
    xp_amount = base_xp * multiplier

    meta = dict(metadata or {})
    meta["idempotency_key"] = idempotency_key
    if multiplier > 1:
        meta["comeback_multiplier"] = multiplier

    event = XpEvent(
        user_id=user_id,
        event_type=event_type,
        xp_amount=xp_amount,
        metadata_json=meta,
    )
    db.add(event)
    db.flush()

    totals.total_xp = int(totals.total_xp or 0) + xp_amount
    _update_totals_after_xp_change(totals)
    if totals.comeback_sessions_remaining > 0:
        totals.comeback_sessions_remaining = max(0, int(totals.comeback_sessions_remaining) - 1)
    totals.updated_at = datetime.utcnow()
    db.flush()
    return event


def _expected_meal_slots(db: Session, user_id: int, log_date: date) -> int | None:
    planned = (
        db.query(UserMealPlan)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == log_date)
        .count()
    )
    if planned > 0:
        return planned
    onboarding = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    if onboarding and isinstance(onboarding.onboarding_json, dict):
        dietary = onboarding.onboarding_json.get("dietary") or {}
        mpd = dietary.get("meals_per_day")
        if mpd is not None:
            return max(1, min(6, int(mpd)))
    return None


def _logged_meal_count(db: Session, user_id: int, log_date: date) -> int:
    manual = (
        db.query(MealEntry)
        .join(DailyNutritionLog, DailyNutritionLog.log_id == MealEntry.log_id)
        .filter(
            DailyNutritionLog.user_id == user_id,
            DailyNutritionLog.log_date == log_date,
            MealEntry.total_calories > 0,
        )
        .count()
    )
    ai = (
        db.query(AIFoodMealEntry)
        .filter(
            AIFoodMealEntry.user_id == user_id,
            AIFoodMealEntry.log_date == log_date,
            AIFoodMealEntry.calories > 0,
        )
        .count()
    )
    return manual + ai


def _calorie_target_hit(log: DailyNutritionLog) -> bool:
    target = int(log.target_calories or 0)
    if target <= 0:
        return False
    total = float(log.total_calories or 0)
    if total <= 0:
        return False
    return abs(total - target) / target <= 0.05


def ensure_default_season(db: Session) -> XpSeason | None:
    today = date.today()
    active = (
        db.query(XpSeason)
        .filter(XpSeason.start_date <= today, XpSeason.end_date >= today)
        .order_by(XpSeason.start_date.desc())
        .first()
    )
    if active:
        return active
    start = date(today.year, today.month, 1)
    if today.month == 12:
        end = date(today.year, 12, 31)
    else:
        end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    season = XpSeason(name=f"{today.strftime('%B %Y')} Season", start_date=start, end_date=end)
    db.add(season)
    db.flush()
    return season


def season_xp_for_user(db: Session, user_id: int, season: XpSeason) -> int:
    start_dt = datetime.combine(season.start_date, datetime.min.time())
    end_dt = datetime.combine(season.end_date, datetime.max.time())
    total = (
        db.query(func.coalesce(func.sum(XpEvent.xp_amount), 0))
        .filter(
            XpEvent.user_id == user_id,
            XpEvent.created_at >= start_dt,
            XpEvent.created_at <= end_dt,
        )
        .scalar()
    )
    return int(total or 0)


def award_xp_for_workout_log(db: Session, *, user_id: int, workout_id: int, log_date: date | None = None) -> None:
    """Hook for POST /workout — manual log and planner checkbox share this path."""
    try:
        activity_date = log_date or date.today()
        _maybe_activate_comeback(db, user_id, activity_date)
        _award_xp(
            db,
            user_id=user_id,
            event_type="exercise_logged",
            base_xp=XP_EXERCISE_LOGGED,
            idempotency_key=f"workout:{workout_id}",
            metadata={"workout_id": workout_id},
        )
        db.commit()
    except Exception:
        logger.exception("XP award failed for workout log user=%s workout=%s", user_id, workout_id)
        db.rollback()


def reverse_xp_for_workout_delete(
    db: Session,
    *,
    user_id: int,
    workout_id: int,
    log_date: date | None = None,
) -> None:
    """Reverse exercise XP when a workout log is deleted or planner checkbox unchecked."""
    try:
        _reverse_xp_for_idempotency_key(
            db,
            user_id=user_id,
            idempotency_key=f"workout:{workout_id}",
            metadata={"workout_id": workout_id, "reason": "workout_deleted"},
        )
        if log_date is not None:
            _maybe_reverse_workout_day_completed(db, user_id=user_id, log_date=log_date)
    except Exception:
        logger.exception(
            "XP reversal failed for workout delete user=%s workout=%s",
            user_id,
            workout_id,
        )


def _maybe_reverse_workout_day_completed(db: Session, *, user_id: int, log_date: date) -> None:
    """Reverse daily workout-completion bonus when the day is no longer fully logged."""
    day_key = log_date.isoformat()
    idempotency_key = f"daily:{day_key}:workout_day_completed"
    if _find_award_event(db, user_id, idempotency_key) is None:
        return
    if _day_workouts_fully_logged(db, user_id, log_date):
        return
    _reverse_xp_for_idempotency_key(
        db,
        user_id=user_id,
        idempotency_key=idempotency_key,
        metadata={"log_date": day_key, "reason": "workout_day_incomplete"},
    )


def _day_workouts_fully_logged(db: Session, user_id: int, log_date: date) -> bool:
    """Placeholder until workout-day completion awards are wired server-side."""
    return False


def reevaluate_xp_after_meal_change(db: Session, *, user_id: int, log_date: date) -> None:
    """Reverse daily meal bonuses that no longer apply after a meal is deleted."""
    try:
        day_key = log_date.isoformat()
        log = (
            db.query(DailyNutritionLog)
            .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date == log_date)
            .first()
        )
        expected = _expected_meal_slots(db, user_id, log_date)
        logged = _logged_meal_count(db, user_id, log_date)

        if expected is None or logged < expected:
            _reverse_xp_for_idempotency_key(
                db,
                user_id=user_id,
                idempotency_key=f"daily:{day_key}:all_meals_logged",
                metadata={"log_date": day_key, "logged": logged, "expected": expected, "reason": "meal_deleted"},
            )

        if not log or not _calorie_target_hit(log):
            _reverse_xp_for_idempotency_key(
                db,
                user_id=user_id,
                idempotency_key=f"daily:{day_key}:calorie_target_hit",
                metadata={"log_date": day_key, "reason": "meal_deleted"},
            )

        # Streak day bonus: reverse only when the day has no logged meals left.
        if logged == 0:
            _reverse_xp_for_idempotency_key(
                db,
                user_id=user_id,
                idempotency_key=f"daily:{day_key}:streak_day_bonus",
                metadata={"log_date": day_key, "reason": "meal_deleted"},
            )
    except Exception:
        logger.exception("XP reversal failed after meal change user=%s date=%s", user_id, log_date)


def reverse_xp_for_guided_warmup_delete(
    db: Session,
    *,
    user_id: int,
    session_id: str,
) -> None:
    """Reverse guided warm-up XP when its session history entry is deleted."""
    try:
        _reverse_xp_for_idempotency_key(
            db,
            user_id=user_id,
            idempotency_key=f"guided_warmup:{session_id}",
            metadata={"session_id": session_id, "reason": "guided_warmup_deleted"},
        )
    except Exception:
        logger.exception(
            "XP reversal failed for guided warm-up delete user=%s session=%s",
            user_id,
            session_id,
        )


def award_xp_for_meal_log(db: Session, *, user_id: int, log_date: date) -> None:
    """Hook after meal log commit — daily bonuses evaluated once per day."""
    try:
        _maybe_activate_comeback(db, user_id, log_date)
        log = (
            db.query(DailyNutritionLog)
            .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.log_date == log_date)
            .first()
        )
        if not log:
            db.commit()
            return

        day_key = log_date.isoformat()

        expected = _expected_meal_slots(db, user_id, log_date)
        logged = _logged_meal_count(db, user_id, log_date)
        if expected is not None and logged >= expected:
            _award_xp(
                db,
                user_id=user_id,
                event_type="all_meals_logged",
                base_xp=XP_ALL_MEALS_LOGGED,
                idempotency_key=f"daily:{day_key}:all_meals_logged",
                metadata={"log_date": day_key, "logged": logged, "expected": expected},
            )

        if _calorie_target_hit(log):
            _award_xp(
                db,
                user_id=user_id,
                event_type="calorie_target_hit",
                base_xp=XP_CALORIE_TARGET_HIT,
                idempotency_key=f"daily:{day_key}:calorie_target_hit",
                metadata={"log_date": day_key},
            )

        streak = calculate_user_streak(db, user_id)
        if streak.get("current_streak", 0) >= 1:
            _award_xp(
                db,
                user_id=user_id,
                event_type="streak_day_bonus",
                base_xp=XP_STREAK_DAY_BONUS,
                idempotency_key=f"daily:{day_key}:streak_day_bonus",
                metadata={"log_date": day_key, "current_streak": streak["current_streak"]},
            )

        db.commit()
    except Exception:
        logger.exception("XP award failed for meal log user=%s date=%s", user_id, log_date)
        db.rollback()


def serialize_xp_summary(db: Session, user_id: int) -> dict[str, Any]:
    totals = _get_or_create_totals(db, user_id)
    computed_level = level_for_total_xp(int(totals.total_xp or 0))
    if int(totals.level or 1) != computed_level:
        totals.level = computed_level
        totals.updated_at = datetime.utcnow()
        db.commit()
    into_level, to_next = xp_to_next_level(int(totals.total_xp or 0))
    season = ensure_default_season(db)
    season_xp = season_xp_for_user(db, user_id, season) if season else 0
    return {
        "total_xp": int(totals.total_xp or 0),
        "level": computed_level,
        "xp_into_level": into_level,
        "xp_to_next_level": to_next,
        "comeback_sessions_remaining": int(totals.comeback_sessions_remaining or 0),
        "season": {
            "id": season.id,
            "name": season.name,
            "start_date": season.start_date.isoformat(),
            "end_date": season.end_date.isoformat(),
            "season_xp": season_xp,
        }
        if season
        else None,
    }


def friends_season_leaderboard(db: Session, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    from src.services.activity_feed_service import accepted_friend_ids

    season = ensure_default_season(db)
    if not season:
        return []
    friend_ids = accepted_friend_ids(db, user_id)
    user_ids = {user_id, *friend_ids}
    start_dt = datetime.combine(season.start_date, datetime.min.time())
    end_dt = datetime.combine(season.end_date, datetime.max.time())
    rows = (
        db.query(XpEvent.user_id, func.sum(XpEvent.xp_amount).label("season_xp"))
        .filter(
            XpEvent.user_id.in_(user_ids),
            XpEvent.created_at >= start_dt,
            XpEvent.created_at <= end_dt,
        )
        .group_by(XpEvent.user_id)
        .order_by(func.sum(XpEvent.xp_amount).desc())
        .limit(limit)
        .all()
    )
    out: list[dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        user = db.query(User).filter(User.id == row.user_id).first()
        out.append(
            {
                "rank": rank,
                "user_id": row.user_id,
                "display_name": (user.name if user and user.name else "Member"),
                "season_xp": int(row.season_xp or 0),
                "is_self": row.user_id == user_id,
            }
        )
    return out
