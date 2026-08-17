from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import MotivationalQuote, NotificationLog, NotificationPreference, PushToken, StrengthLift, User, Workout
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry
from src.services.language_service import translate

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CHECKPOINTS = {
    14: ("midday", 0.45),
    20: ("evening", 0.85),
}
QUOTE_OF_THE_DAY_HOUR = 8
MEAL_THRESHOLDS = {
    "breakfast": 10,
    "lunch": 15,
    "dinner": 21,
}
DEFAULT_NOTIFICATION_PREFERENCES: dict[str, Any] = {
    "master_enabled": True,
    "categories": {
        "workout": True,
        "meals": True,
        "macro_checkins": True,
        "logging_nudges": True,
        "motivational_quotes": True,
    },
    "quiet_hours": {
        "enabled": False,
        "start": "22:00",
        "end": "07:00",
    },
    "offsets": {
        "pre_workout_minutes": 20,
        "dress_change_minutes": 18,
        "meditation_minutes": 10,
    },
}

_scheduler: BackgroundScheduler | None = None


def _deep_merge_preferences(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "master_enabled": bool(raw.get("master_enabled", DEFAULT_NOTIFICATION_PREFERENCES["master_enabled"])),
        "categories": {
            **DEFAULT_NOTIFICATION_PREFERENCES["categories"],
            **(raw.get("categories") if isinstance(raw.get("categories"), dict) else {}),
        },
        "quiet_hours": {
            **DEFAULT_NOTIFICATION_PREFERENCES["quiet_hours"],
            **(raw.get("quiet_hours") if isinstance(raw.get("quiet_hours"), dict) else {}),
        },
        "offsets": {
            **DEFAULT_NOTIFICATION_PREFERENCES["offsets"],
            **(raw.get("offsets") if isinstance(raw.get("offsets"), dict) else {}),
        },
    }


def _to_float(value: Any) -> float:
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_minutes(value: Any, fallback: str) -> int:
    text = str(value or fallback).strip()
    try:
        hour, minute = text.split(":", 1)
        return max(0, min(23, int(hour))) * 60 + max(0, min(59, int(minute)))
    except (TypeError, ValueError):
        hour, minute = fallback.split(":", 1)
        return int(hour) * 60 + int(minute)


def _in_quiet_hours(now: datetime, preferences: dict[str, Any]) -> bool:
    quiet = preferences.get("quiet_hours") if isinstance(preferences.get("quiet_hours"), dict) else {}
    if not quiet.get("enabled"):
        return False
    start = _parse_minutes(quiet.get("start"), "22:00")
    end = _parse_minutes(quiet.get("end"), "07:00")
    current = now.hour * 60 + now.minute
    if start == end:
        return False
    if start < end:
        return start <= current < end
    return current >= start or current < end


def _preferences_allow(db: Session, user_id: int, category: str, now: datetime) -> bool:
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    preferences = _deep_merge_preferences(row.preferences_json if row else None)
    categories = preferences.get("categories") if isinstance(preferences.get("categories"), dict) else {}
    return bool(preferences.get("master_enabled")) and bool(categories.get(category, True)) and not _in_quiet_hours(now, preferences)


def _already_sent(db: Session, user_id: int, event_key: str | None) -> bool:
    if not event_key:
        return False
    return (
        db.query(NotificationLog.id)
        .filter(
            NotificationLog.user_id == user_id,
            NotificationLog.event_key == event_key,
            NotificationLog.status == "sent",
        )
        .first()
        is not None
    )


def send_push_to_user(
    db: Session,
    *,
    user_id: int,
    category: str,
    title: str,
    body: str,
    event_key: str | None = None,
    data: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> bool:
    now = now or datetime.utcnow()
    if _already_sent(db, user_id, event_key):
        return False
    if not _preferences_allow(db, user_id, category, now):
        return False

    tokens = (
        db.query(PushToken)
        .filter(PushToken.user_id == user_id, PushToken.is_active.is_(True))
        .order_by(PushToken.updated_at.desc())
        .all()
    )
    if not tokens:
        return False

    messages = [
        {
            "to": token.expo_push_token,
            "title": title,
            "body": body,
            "sound": "default",
            "channelId": category.replace("_", "-"),
            "data": {"category": category, **(data or {})},
        }
        for token in tokens
    ]
    log = NotificationLog(
        user_id=user_id,
        category=category,
        title=title[:160],
        body=body,
        event_key=event_key,
        status="queued",
        payload_json={"messages": messages},
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    try:
        response = requests.post(EXPO_PUSH_URL, json=messages, timeout=8)
        response.raise_for_status()
        payload = response.json()
        tickets = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(tickets, list):
            for token, ticket in zip(tokens, tickets):
                if isinstance(ticket, dict) and ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                    token.is_active = False
            first_ticket = next((ticket for ticket in tickets if isinstance(ticket, dict)), {})
            log.expo_ticket_id = str(first_ticket.get("id") or "")[:160] or None
        log.status = "sent"
        log.sent_at = datetime.utcnow()
        db.add(log)
        db.commit()
        return True
    except Exception as exc:  # pragma: no cover - depends on Expo network.
        log.status = "failed"
        log.error_message = str(exc)[:1000]
        db.add(log)
        db.commit()
        return False


def send_test_push_to_user(db: Session, *, user_id: int) -> tuple[bool, str]:
    """Send an immediate test push, bypassing preferences and dedup."""
    tokens = (
        db.query(PushToken)
        .filter(PushToken.user_id == user_id, PushToken.is_active.is_(True))
        .order_by(PushToken.updated_at.desc())
        .all()
    )
    if not tokens:
        return False, "No active push token registered for this account. Enable notifications in the app first."

    messages = [
        {
            "to": token.expo_push_token,
            "title": "NexRep test push",
            "body": "Server push notifications are working.",
            "sound": "default",
            "channelId": "logging-nudges",
            "data": {"category": "logging_nudges", "kind": "server_test"},
        }
        for token in tokens
    ]
    try:
        response = requests.post(EXPO_PUSH_URL, json=messages, timeout=8)
        response.raise_for_status()
        payload = response.json()
        tickets = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(tickets, list):
            for token, ticket in zip(tokens, tickets):
                if isinstance(ticket, dict) and ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                    token.is_active = False
            db.commit()
        return True, f"Sent to {len(tokens)} device(s)."
    except Exception as exc:  # pragma: no cover
        return False, str(exc)[:500]


def _users_with_active_tokens(db: Session) -> list[User]:
    return (
        db.query(User)
        .join(PushToken, PushToken.user_id == User.id)
        .filter(PushToken.is_active.is_(True))
        .distinct(User.id)
        .all()
    )


def _quote_for_context(db: Session, context: str) -> MotivationalQuote | None:
    quote = (
        db.query(MotivationalQuote)
        .filter(
            MotivationalQuote.is_active.is_(True),
            MotivationalQuote.notification_context == context,
        )
        .order_by(func.random())
        .first()
    )
    if quote:
        return quote
    return (
        db.query(MotivationalQuote)
        .filter(
            MotivationalQuote.is_active.is_(True),
            MotivationalQuote.notification_context == "general",
        )
        .order_by(func.random())
        .first()
    )


def _t(user: User, key: str, values: dict[str, Any] | None = None) -> str:
    return translate(user.preferred_language, key, values)


def _meal_logged(db: Session, user_id: int, local_day: date, meal_name: str) -> bool:
    pattern = f"%{meal_name}%"
    daily = (
        db.query(MealEntry.meal_id)
        .join(DailyNutritionLog, DailyNutritionLog.log_id == MealEntry.log_id)
        .filter(
            MealEntry.user_id == user_id,
            DailyNutritionLog.log_date == local_day,
            func.lower(MealEntry.meal_type).like(pattern),
        )
        .first()
    )
    ai = (
        db.query(AIFoodMealEntry.ai_meal_id)
        .filter(
            AIFoodMealEntry.user_id == user_id,
            AIFoodMealEntry.log_date == local_day,
            func.lower(AIFoodMealEntry.meal_type).like(pattern),
        )
        .first()
    )
    return daily is not None or ai is not None


def _run_macro_checkpoint(db: Session, user: User, now: datetime) -> None:
    checkpoint = CHECKPOINTS.get(now.hour)
    if not checkpoint:
        return
    label, expected_ratio = checkpoint
    local_day = now.date()
    log = db.query(DailyNutritionLog).filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == local_day).first()
    if not log:
        return
    target_calories = max(1.0, _to_float(log.target_calories))
    target_protein = max(1.0, _to_float(log.target_protein_g))
    calories = _to_float(log.total_calories)
    protein = _to_float(log.total_protein_g)
    low_calories = calories < target_calories * expected_ratio * 0.7
    low_protein = protein < target_protein * expected_ratio * 0.7
    high_calories = calories > target_calories * min(1.2, expected_ratio + 0.35)
    if not (low_calories or low_protein or high_calories):
        return
    parts = []
    if low_calories:
        parts.append(
            _t(user, "notifications.macroCheckin.lowCalories", {"calories": round(calories), "targetCalories": round(target_calories)})
        )
    if low_protein:
        parts.append(
            _t(user, "notifications.macroCheckin.lowProtein", {"protein": round(protein), "targetProtein": round(target_protein)})
        )
    if high_calories:
        parts.append(_t(user, "notifications.macroCheckin.highCalories", {"calories": round(calories)}))
    summary = ", ".join(parts)
    send_push_to_user(
        db,
        user_id=user.id,
        category="macro_checkins",
        title=_t(user, "notifications.macroCheckin.title"),
        body=_t(user, "notifications.macroCheckin.body", {"checkpoint": label, "summary": summary}),
        event_key=f"macro:{user.id}:{local_day.isoformat()}:{label}",
        data={"kind": "macro_checkpoint", "checkpoint": label},
        now=now,
    )


def _run_missing_log_checks(db: Session, user: User, now: datetime) -> None:
    local_day = now.date()
    for meal_name, threshold_hour in MEAL_THRESHOLDS.items():
        if now.hour < threshold_hour or _meal_logged(db, user.id, local_day, meal_name):
            continue
        send_push_to_user(
            db,
            user_id=user.id,
            category="meals",
            title=_t(user, "notifications.missingMeal.title", {"meal": meal_name}),
            body=_t(user, "notifications.missingMeal.body", {"meal": meal_name}),
            event_key=f"missing-meal:{user.id}:{local_day.isoformat()}:{meal_name}",
            data={"kind": "missing_meal", "meal": meal_name},
            now=now,
        )

    if now.hour >= 20:
        workout_logged = (
            db.query(Workout.id)
            .filter(Workout.user_id == user.id, func.date(Workout.date) == local_day)
            .first()
            is not None
        )
        if not workout_logged:
            send_push_to_user(
                db,
                user_id=user.id,
                category="workout",
                title=_t(user, "notifications.missingWorkout.title"),
                body=_t(user, "notifications.missingWorkout.body"),
                event_key=f"missing-workout:{user.id}:{local_day.isoformat()}",
                data={"kind": "missing_workout"},
                now=now,
            )


def _run_streak_risk_check(db: Session, user: User, now: datetime) -> None:
    if now.hour != 19:
        return
    local_day = now.date()
    meal_logged = db.query(DailyNutritionLog.log_id).filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == local_day).first()
    workout_logged = db.query(Workout.id).filter(Workout.user_id == user.id, func.date(Workout.date) == local_day).first()
    if meal_logged or workout_logged:
        return
    send_push_to_user(
        db,
        user_id=user.id,
        category="logging_nudges",
        title=_t(user, "notifications.streakRisk.title"),
        body=_t(user, "notifications.streakRisk.body"),
        event_key=f"streak-risk:{user.id}:{local_day.isoformat()}",
        data={"kind": "streak_risk"},
        now=now,
    )


def _run_quote_of_the_day(db: Session, user: User, now: datetime) -> None:
    if now.hour != QUOTE_OF_THE_DAY_HOUR:
        return
    quote = _quote_for_context(db, "general")
    if not quote:
        return
    send_push_to_user(
        db,
        user_id=user.id,
        category="motivational_quotes",
        title=_t(user, "notifications.quoteOfDay.title"),
        body=_t(user, "notifications.quoteOfDay.body", {"quote": quote.quote, "author": quote.author}),
        event_key=f"quote-of-day:{user.id}:{now.date().isoformat()}",
        data={"kind": "quote_of_the_day", "quote_id": quote.id, "notification_context": quote.notification_context},
        now=now,
    )


def _run_weekly_digest(db: Session, user: User, now: datetime) -> None:
    if now.weekday() != 6 or now.hour != 18:
        return
    from src.services.plan_reflow_service import (
        apply_weekly_compensation,
        build_weekly_review,
        weekly_review_message,
        weekly_summary_enabled,
    )
    from src.services.workout_planner_service import get_existing_workout_plan

    if not weekly_summary_enabled(db, user.id):
        return
    local_date = now.date().isoformat()
    summary = build_weekly_review(db, user, local_date)
    week_start = now.date() - timedelta(days=6)
    meals_logged = (
        db.query(func.count(DailyNutritionLog.log_id))
        .filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date >= week_start, DailyNutritionLog.log_date <= now.date())
        .scalar()
        or 0
    )
    workouts_logged = int(summary.get("workouts_logged") or 0)
    prs = (
        db.query(func.count(StrengthLift.id))
        .filter(StrengthLift.user_id == user.id, StrengthLift.date >= datetime.combine(week_start, datetime.min.time()))
        .scalar()
        or 0
    )
    send_push_to_user(
        db,
        user_id=user.id,
        category="logging_nudges",
        title=_t(user, "notifications.weeklyDigest.title"),
        body=_t(
            user,
            "notifications.weeklyDigest.body",
            {"mealsLogged": meals_logged, "workoutsLogged": workouts_logged, "strengthLifts": prs},
        ),
        event_key=f"weekly-digest:{user.id}:{now.date().isoformat()}",
        data={"kind": "weekly_digest", "review_message": weekly_review_message(summary)},
        now=now,
    )
    try:
        plan = get_existing_workout_plan(db, user.id, now.month, now.year)
        if plan:
            apply_weekly_compensation(db, user, plan_id=plan.id, local_date=local_date)
    except Exception:
        pass


def run_hourly_notification_checks(now: datetime | None = None) -> None:
    now = now or datetime.utcnow()
    db = SessionLocal()
    try:
        from src.services.social_challenge_service import complete_expired_challenges

        complete_expired_challenges(db)
        from src.services.squad_service import run_squad_nudges

        run_squad_nudges(db, as_of=now)
        for user in _users_with_active_tokens(db):
            _run_macro_checkpoint(db, user, now)
            _run_missing_log_checks(db, user, now)
            _run_streak_risk_check(db, user, now)
            _run_quote_of_the_day(db, user, now)
            _run_weekly_digest(db, user, now)
    finally:
        db.close()


def start_notification_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        run_hourly_notification_checks,
        trigger="cron",
        minute=5,
        id="nexrep-hourly-notification-checks",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()


def stop_notification_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
