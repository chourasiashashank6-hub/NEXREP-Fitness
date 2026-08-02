from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Literal

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from src.models.models import Challenge, ChallengeParticipant, Friendship, NotificationPreference, User, Workout
from src.services.activity_feed_service import calculate_user_streak
from src.services.notification_service import send_push_to_user

ChallengeType = Literal["streak_battle", "workout_count"]

DEFAULT_LEADERBOARD_SETTINGS = {"opted_in": True}


def initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def public_user(user: User | None) -> dict[str, Any]:
    name = user.name if user else "User"
    return {
        "user_id": user.id if user else 0,
        "name": name,
        "initials": initials(name),
        "profile_photo_url": user.profile_photo_url if user else None,
    }


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


def _is_blocked_between(db: Session, left_id: int, right_id: int) -> bool:
    return (
        db.query(Friendship)
        .filter(
            Friendship.status == "blocked",
            or_(
                and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
                and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
            ),
        )
        .first()
        is not None
    )


def normalize_leaderboard_settings(raw: dict[str, Any] | None) -> dict[str, bool]:
    source = raw if isinstance(raw, dict) else {}
    return {"opted_in": bool(source.get("opted_in", DEFAULT_LEADERBOARD_SETTINGS["opted_in"]))}


def get_leaderboard_settings(db: Session, user_id: int) -> dict[str, bool]:
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    prefs = row.preferences_json if row and isinstance(row.preferences_json, dict) else {}
    return normalize_leaderboard_settings(prefs.get("leaderboard") if isinstance(prefs, dict) else None)


def set_leaderboard_settings(db: Session, user_id: int, settings: dict[str, Any]) -> dict[str, bool]:
    normalized = normalize_leaderboard_settings(settings)
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
    prefs["leaderboard"] = normalized
    row.preferences_json = prefs
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return normalized


def week_window(today: date | None = None) -> tuple[date, date, datetime]:
    today = today or datetime.utcnow().date()
    start = today - timedelta(days=today.weekday())
    next_start = start + timedelta(days=7)
    return start, next_start, datetime.combine(next_start, time.min)


def workout_days_between(db: Session, user_id: int, start: date, end: date) -> list[datetime]:
    start_dt = datetime.combine(start, time.min)
    end_exclusive = datetime.combine(end + timedelta(days=1), time.min)
    rows = (
        db.query(Workout.date)
        .filter(Workout.user_id == user_id, Workout.date >= start_dt, Workout.date < end_exclusive)
        .order_by(Workout.date.asc())
        .all()
    )
    by_day: dict[date, datetime] = {}
    for row in rows:
        if not row.date:
            continue
        day = row.date.date()
        by_day.setdefault(day, row.date)
    return [by_day[day] for day in sorted(by_day)]


def leaderboard_for_user(db: Session, user_id: int) -> dict[str, Any]:
    start, _, next_reset_at = week_window()
    friend_ids = accepted_friend_ids(db, user_id)
    rows: list[dict[str, Any]] = []
    if friend_ids:
        users = db.query(User).filter(User.id.in_(friend_ids)).all()
        for user in users:
            if not get_leaderboard_settings(db, user.id).get("opted_in", True):
                continue
            workouts_this_week = len(workout_days_between(db, user.id, start, datetime.utcnow().date()))
            current_streak = int(calculate_user_streak(db, user.id).get("current_streak") or 0)
            score = workouts_this_week * 10 + min(current_streak, 30) * 2
            rows.append(
                {
                    "user": public_user(user),
                    "workouts_this_week": workouts_this_week,
                    "current_streak": current_streak,
                    "score": score,
                }
            )
    rows.sort(key=lambda item: (-item["score"], -item["workouts_this_week"], -item["current_streak"], item["user"]["name"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return {
        "items": rows,
        "week_start": start.isoformat(),
        "next_reset_at": next_reset_at.isoformat(),
        "viewer_settings": get_leaderboard_settings(db, user_id),
        "unlock_required_count": 3,
        "unlocked": len(rows) >= 3,
    }


def challenge_progress(db: Session, challenge: Challenge, user_id: int) -> tuple[int, datetime | None]:
    days = workout_days_between(db, user_id, challenge.start_date, min(challenge.end_date, datetime.utcnow().date()))
    if challenge.type == "workout_count":
        reached_at = days[challenge.target - 1] if len(days) >= challenge.target else None
        return len(days), reached_at

    best = 0
    current = 0
    previous: date | None = None
    reached_at: datetime | None = None
    for value in days:
        day = value.date()
        if previous and day == previous + timedelta(days=1):
            current += 1
        else:
            current = 1
        best = max(best, current)
        if current >= challenge.target and reached_at is None:
            reached_at = value
        previous = day
    return best, reached_at


def refresh_challenge_progress(db: Session, challenge: Challenge) -> None:
    for participant in challenge.participants:
        if participant.status != "joined":
            continue
        progress, reached_at = challenge_progress(db, challenge, participant.user_id)
        participant.progress = progress
        if reached_at and not participant.target_reached_at:
            participant.target_reached_at = reached_at
        db.add(participant)


def _winner_for(challenge: Challenge) -> ChallengeParticipant | None:
    joined = [participant for participant in challenge.participants if participant.status == "joined"]
    if not joined:
        return None
    return sorted(
        joined,
        key=lambda participant: (
            -participant.progress,
            participant.target_reached_at or datetime.max,
            participant.joined_at or datetime.max,
            participant.user_id,
        ),
    )[0]


def complete_challenge_if_needed(db: Session, challenge: Challenge, now: date | None = None) -> bool:
    if challenge.status != "active":
        return False
    now = now or datetime.utcnow().date()
    refresh_challenge_progress(db, challenge)
    if challenge.end_date >= now:
        db.commit()
        return False
    winner = _winner_for(challenge)
    challenge.status = "completed"
    challenge.winner_user_id = winner.user_id if winner else None
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    notify_challenge_result(db, challenge)
    return True


def complete_expired_challenges(db: Session) -> None:
    challenges = db.query(Challenge).filter(Challenge.status == "active", Challenge.end_date < datetime.utcnow().date()).all()
    for challenge in challenges:
        complete_challenge_if_needed(db, challenge)


def ensure_visible_challenge(db: Session, challenge_id: int, user_id: int) -> Challenge | None:
    challenge = db.query(Challenge).filter(Challenge.id == challenge_id).first()
    if not challenge:
        return None
    if challenge.creator_id != user_id and _is_blocked_between(db, user_id, challenge.creator_id):
        return None
    participant = next((row for row in challenge.participants if row.user_id == user_id), None)
    if challenge.creator_id != user_id and not participant:
        return None
    complete_challenge_if_needed(db, challenge)
    db.refresh(challenge)
    return challenge


def serialize_challenge(db: Session, challenge: Challenge, viewer_id: int, include_standings: bool = False) -> dict[str, Any]:
    creator = db.query(User).filter(User.id == challenge.creator_id).first()
    winner = db.query(User).filter(User.id == challenge.winner_user_id).first() if challenge.winner_user_id else None
    if winner and _is_blocked_between(db, viewer_id, winner.id):
        winner = None
    viewer_participant = next((row for row in challenge.participants if row.user_id == viewer_id), None)
    payload: dict[str, Any] = {
        "id": challenge.id,
        "creator": public_user(creator),
        "type": challenge.type,
        "title": challenge.title,
        "target": challenge.target,
        "start_date": challenge.start_date.isoformat(),
        "end_date": challenge.end_date.isoformat(),
        "status": challenge.status,
        "winner": public_user(winner) if winner else None,
        "created_at": challenge.created_at.isoformat() if challenge.created_at else None,
        "viewer_status": viewer_participant.status if viewer_participant else ("joined" if challenge.creator_id == viewer_id else None),
        "viewer_is_creator": challenge.creator_id == viewer_id,
    }
    if include_standings:
        payload["standings"] = standings_for_challenge(db, challenge, viewer_id)
    return payload


def standings_for_challenge(db: Session, challenge: Challenge, viewer_id: int) -> list[dict[str, Any]]:
    refresh_challenge_progress(db, challenge)
    db.commit()
    users = {user.id: user for user in db.query(User).filter(User.id.in_([row.user_id for row in challenge.participants] or [-1])).all()}
    rows = [
        {
            "user": public_user(users.get(participant.user_id)),
            "progress": participant.progress,
            "status": participant.status,
            "joined_at": participant.joined_at.isoformat() if participant.joined_at else None,
            "target_reached_at": participant.target_reached_at.isoformat() if participant.target_reached_at else None,
        }
        for participant in challenge.participants
        if participant.status in {"joined", "invited"}
        and (participant.user_id == viewer_id or not _is_blocked_between(db, viewer_id, participant.user_id))
    ]
    rows.sort(key=lambda item: (-item["progress"], item["target_reached_at"] or "9999", item["user"]["name"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def _notification_title_snippet(title: str, limit: int = 50) -> str:
    value = (title or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip()


def notify_challenge_invite(db: Session, challenge: Challenge, inviter: User, invitee: User) -> None:
    title_snippet = _notification_title_snippet(challenge.title)
    send_push_to_user(
        db,
        user_id=invitee.id,
        category="social",
        title="Squad challenge invite",
        body=f"{inviter.name} invited you to {title_snippet}.",
        event_key=f"challenge-invite:{challenge.id}:{invitee.id}",
        data={
            "kind": "challenge_invite",
            "challenge_id": challenge.id,
            "sender_id": inviter.id,
            "sender_name": inviter.name,
            "deep_link": f"nexrep://social/challenges/{challenge.id}",
            "screen": "SocialChallengeDetail",
        },
    )


def notify_challenge_result(db: Session, challenge: Challenge) -> None:
    winner = db.query(User).filter(User.id == challenge.winner_user_id).first() if challenge.winner_user_id else None
    title_snippet = _notification_title_snippet(challenge.title)
    for participant in challenge.participants:
        if participant.status != "joined":
            continue
        body = f"{winner.name} won {title_snippet}." if winner else f"{title_snippet} is complete."
        send_push_to_user(
            db,
            user_id=participant.user_id,
            category="social",
            title="Challenge complete",
            body=body,
            event_key=f"challenge-result:{challenge.id}:{participant.user_id}",
            data={
                "kind": "challenge_result",
                "challenge_id": challenge.id,
                "winner_user_id": challenge.winner_user_id,
                "deep_link": f"nexrep://social/challenges/{challenge.id}",
                "screen": "SocialChallengeDetail",
            },
        )


def is_friend(db: Session, left_id: int, right_id: int) -> bool:
    return (
        db.query(Friendship)
        .filter(
            Friendship.status == "accepted",
            or_(
                and_(Friendship.user_id == left_id, Friendship.friend_id == right_id),
                and_(Friendship.user_id == right_id, Friendship.friend_id == left_id),
            ),
        )
        .first()
        is not None
    )


def is_challenge_visible_to_user(db: Session, challenge: Challenge, user_id: int) -> bool:
    return challenge.creator_id == user_id or not _is_blocked_between(db, user_id, challenge.creator_id)
