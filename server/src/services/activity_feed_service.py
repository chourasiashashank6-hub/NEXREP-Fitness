from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.models.models import ActivityEvent, FeedReaction, Friendship, NotificationPreference, User, Workout
from src.models.nutrition_calories import DailyNutritionLog
from src.services.notification_service import send_push_to_user

EventType = Literal["pr", "streak_milestone", "thread_joined"]
ReactionType = Literal["flame", "clap"]

DEFAULT_FEED_AUTO_SHARE = {
    "share_prs": True,
    "share_streak_milestones": True,
    "share_thread_joins": True,
}

EVENT_SETTING_KEY: dict[str, str] = {
    "pr": "share_prs",
    "streak_milestone": "share_streak_milestones",
    "thread_joined": "share_thread_joins",
}


def normalize_feed_auto_share_settings(raw: dict[str, Any] | None) -> dict[str, bool]:
    source = raw if isinstance(raw, dict) else {}
    return {
        key: bool(source.get(key, default))
        for key, default in DEFAULT_FEED_AUTO_SHARE.items()
    }


def get_feed_auto_share_settings(db: Session, user_id: int) -> dict[str, bool]:
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    prefs = row.preferences_json if row and isinstance(row.preferences_json, dict) else {}
    return normalize_feed_auto_share_settings(prefs.get("feed_auto_share") if isinstance(prefs, dict) else None)


def set_feed_auto_share_settings(db: Session, user_id: int, settings: dict[str, Any]) -> dict[str, bool]:
    normalized = normalize_feed_auto_share_settings(settings)
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    if row and isinstance(row.preferences_json, dict):
        prefs = dict(row.preferences_json)
    elif row:
        prefs = {}
    else:
        prefs = {
            "master_enabled": True,
            "categories": {
                "workout": True,
                "meals": True,
                "macro_checkins": True,
                "logging_nudges": True,
                "motivational_quotes": True,
            },
            "quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
            "offsets": {"pre_workout_minutes": 20, "dress_change_minutes": 18, "meditation_minutes": 10},
        }
        row = NotificationPreference(user_id=user_id, preferences_json=prefs)
        db.add(row)
    prefs["feed_auto_share"] = normalized
    row.preferences_json = prefs
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return normalized


def _auto_share_enabled(db: Session, user_id: int, event_type: EventType) -> bool:
    key = EVENT_SETTING_KEY[event_type]
    return bool(get_feed_auto_share_settings(db, user_id).get(key, True))


def _matching_event_exists(db: Session, user_id: int, event_type: EventType, identity_payload: dict[str, Any]) -> bool:
    return (
        db.query(ActivityEvent.id)
        .filter(
            ActivityEvent.user_id == user_id,
            ActivityEvent.type == event_type,
            ActivityEvent.payload_json.contains(identity_payload),
        )
        .first()
        is not None
    )


def emit_activity_event(
    db: Session,
    *,
    user_id: int,
    event_type: EventType,
    payload: dict[str, Any],
    visibility: Literal["friends", "private"] = "friends",
    identity_payload: dict[str, Any] | None = None,
) -> ActivityEvent | None:
    if not _auto_share_enabled(db, user_id, event_type):
        return None
    if identity_payload and _matching_event_exists(db, user_id, event_type, identity_payload):
        return None
    event = ActivityEvent(
        user_id=user_id,
        type=event_type,
        payload_json=payload,
        visibility=visibility,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _activity_dates(db: Session, user_id: int) -> set[date]:
    workout_rows = db.query(Workout.date).filter(Workout.user_id == user_id).all()
    food_rows = (
        db.query(DailyNutritionLog.log_date)
        .filter(DailyNutritionLog.user_id == user_id, DailyNutritionLog.total_calories > 0)
        .all()
    )
    dates = {row.date.date() for row in workout_rows if row.date}
    dates.update(row.log_date for row in food_rows if row.log_date)
    return dates


def _current_streak_from_dates(active_dates: set[date], today: date | None = None) -> int:
    today = today or datetime.utcnow().date()
    start = today if today in active_dates else today - timedelta(days=1)
    streak = 0
    cursor = start
    while cursor in active_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _best_streak_from_dates(active_dates: set[date]) -> int:
    if not active_dates:
        return 0
    best = 0
    current = 0
    previous: date | None = None
    for active_day in sorted(active_dates):
        if previous and active_day == previous + timedelta(days=1):
            current += 1
        else:
            current = 1
        best = max(best, current)
        previous = active_day
    return best


def calculate_user_streak(db: Session, user_id: int) -> dict[str, int]:
    dates = _activity_dates(db, user_id)
    return {
        "current_streak": _current_streak_from_dates(dates),
        "personal_best_streak": _best_streak_from_dates(dates),
    }


def emit_streak_milestone_if_needed(db: Session, *, user_id: int, source: str, source_id: int | None = None) -> ActivityEvent | None:
    dates = _activity_dates(db, user_id)
    current = _current_streak_from_dates(dates)
    if current <= 0:
        return None
    best = _best_streak_from_dates(dates)
    today = datetime.utcnow().date()
    previous_best = _best_streak_from_dates({d for d in dates if d < today})
    is_multiple_of_7 = current % 7 == 0
    is_new_personal_best = current > previous_best
    if not is_multiple_of_7 and not is_new_personal_best:
        return None
    payload = {
        "current_streak": current,
        "personal_best_streak": best,
        "is_multiple_of_7": is_multiple_of_7,
        "is_new_personal_best": is_new_personal_best,
        "source": source,
        "source_id": source_id,
        "milestone_date": today.isoformat(),
    }
    identity = {"current_streak": current, "milestone_date": today.isoformat()}
    return emit_activity_event(db, user_id=user_id, event_type="streak_milestone", payload=payload, identity_payload=identity)


def accepted_friend_ids(db: Session, user_id: int) -> set[int]:
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == "accepted",
            or_(Friendship.user_id == user_id, Friendship.friend_id == user_id),
        )
        .all()
    )
    return {row.friend_id if row.user_id == user_id else row.user_id for row in rows}


def serialize_event(db: Session, event: ActivityEvent, viewer_id: int) -> dict[str, Any]:
    user = db.query(User).filter(User.id == event.user_id).first()
    reactions = db.query(FeedReaction).filter(FeedReaction.event_id == event.id).all()
    counts = {
        "flame": sum(1 for reaction in reactions if reaction.type == "flame"),
        "clap": sum(1 for reaction in reactions if reaction.type == "clap"),
    }
    viewer_reactions = [reaction.type for reaction in reactions if reaction.user_id == viewer_id]
    return {
        "id": event.id,
        "user": {
            "user_id": event.user_id,
            "name": user.name if user else "User",
            "initials": _initials(user.name if user else "User"),
            "profile_photo_url": user.profile_photo_url if user else None,
        },
        "type": event.type,
        "payload": event.payload_json,
        "visibility": event.visibility,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "reaction_counts": counts,
        "viewer_reactions": viewer_reactions,
    }


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _reaction_body(actor: User, event: ActivityEvent, reaction_type: ReactionType) -> str:
    cheer = "cheered" if reaction_type == "flame" else "clapped for"
    suffix = "🔥" if reaction_type == "flame" else "👏"
    if event.type == "pr":
        exercise = event.payload_json.get("exercise_name") if isinstance(event.payload_json, dict) else None
        return f"{actor.name} {cheer} your {exercise or 'strength'} PR {suffix}"
    if event.type == "streak_milestone":
        streak = event.payload_json.get("current_streak") if isinstance(event.payload_json, dict) else None
        return f"{actor.name} {cheer} your {streak}-day streak {suffix}"
    return f"{actor.name} {cheer} your activity {suffix}"


def react_to_event(db: Session, *, event: ActivityEvent, actor: User, reaction_type: ReactionType) -> FeedReaction:
    existing = (
        db.query(FeedReaction)
        .filter(FeedReaction.event_id == event.id, FeedReaction.user_id == actor.id, FeedReaction.type == reaction_type)
        .first()
    )
    if existing:
        return existing
    reaction = FeedReaction(event_id=event.id, user_id=actor.id, type=reaction_type)
    db.add(reaction)
    db.commit()
    db.refresh(reaction)
    if event.user_id != actor.id:
        send_push_to_user(
            db,
            user_id=event.user_id,
            category="social",
            title="New reaction",
            body=_reaction_body(actor, event, reaction_type),
            event_key=f"feed-reaction:{event.id}:{actor.id}:{reaction_type}",
            data={
                "kind": "feed_reaction",
                "event_id": event.id,
                "reaction_type": reaction_type,
                "sender_id": actor.id,
                "sender_name": actor.name,
                "deep_link": f"nexrep://social/feed/{event.id}",
                "screen": "SocialFeed",
            },
        )
    return reaction
