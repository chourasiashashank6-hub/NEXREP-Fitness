"""Gym squad creation, invites, daily status, streaks, and nudges."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from src.models.models import User, Workout
from src.models.squads import Squad, SquadMember
from src.services.notification_service import send_push_to_user
from src.services.social_challenge_service import _is_blocked_between, is_friend, public_user
from src.services.xp_service import _logged_meal_count

logger = logging.getLogger(__name__)

DEFAULT_MAX_MEMBERS = 6
NUDGE_UTC_HOUR = 18


def parse_log_date(value: str | None) -> date:
    if value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
    return datetime.utcnow().date()


def _workout_logged_on_date(db: Session, user_id: int, log_date: date) -> bool:
    start_dt = datetime.combine(log_date, time.min)
    end_dt = datetime.combine(log_date + timedelta(days=1), time.min)
    return (
        db.query(Workout.id)
        .filter(Workout.user_id == user_id, Workout.date >= start_dt, Workout.date < end_dt)
        .first()
        is not None
    )


def member_activity_for_date(db: Session, user_id: int, log_date: date) -> dict[str, bool]:
    meals = _logged_meal_count(db, user_id, log_date)
    return {
        "workout_logged": _workout_logged_on_date(db, user_id, log_date),
        "meals_logged": meals > 0,
    }


def _joined_member_count(db: Session, squad_id: int) -> int:
    return (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad_id, SquadMember.status == "joined")
        .count()
    )


def _serialize_member_status(
    db: Session,
    member: SquadMember,
    *,
    log_date: date,
    viewer_id: int,
) -> dict[str, Any]:
    user = db.query(User).filter(User.id == member.user_id).first()
    row: dict[str, Any] = {
        "user": public_user(user),
        "role": member.role,
        "status": member.status,
        "share_status": bool(member.share_status),
        "joined_at": member.joined_at.isoformat() if member.joined_at else None,
    }
    is_self = member.user_id == viewer_id
    if member.status != "joined":
        row["daily"] = None
        return row
    if not member.share_status and not is_self:
        row["daily"] = {"visibility": "private"}
        return row
    activity = member_activity_for_date(db, member.user_id, log_date)
    row["daily"] = {
        "visibility": "shared",
        "workout_logged": activity["workout_logged"],
        "meals_logged": activity["meals_logged"],
        "complete": activity["workout_logged"] and activity["meals_logged"],
    }
    return row


def compute_squad_streak(db: Session, squad_id: int, end_date: date, *, lookback_days: int = 60) -> int:
    """Consecutive days ending on end_date where every opted-in joined member logged workout + meals."""
    members = (
        db.query(SquadMember)
        .filter(
            SquadMember.squad_id == squad_id,
            SquadMember.status == "joined",
            SquadMember.share_status.is_(True),
        )
        .all()
    )
    if not members:
        return 0
    streak = 0
    for offset in range(lookback_days):
        day = end_date - timedelta(days=offset)
        all_complete = True
        for member in members:
            activity = member_activity_for_date(db, member.user_id, day)
            if not (activity["workout_logged"] and activity["meals_logged"]):
                all_complete = False
                break
        if all_complete:
            streak += 1
        else:
            break
    return streak


def is_squad_visible_to_user(db: Session, squad: Squad, user_id: int) -> bool:
    if squad.creator_id == user_id:
        return True
    return not _is_blocked_between(db, user_id, squad.creator_id)


def ensure_visible_squad(db: Session, squad_id: int, user_id: int) -> Squad | None:
    squad = db.query(Squad).filter(Squad.id == squad_id).first()
    if not squad:
        return None
    participant = (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad_id, SquadMember.user_id == user_id)
        .first()
    )
    if not participant and squad.creator_id != user_id:
        return None
    if not is_squad_visible_to_user(db, squad, user_id):
        return None
    return squad


def serialize_squad(
    db: Session,
    squad: Squad,
    viewer_id: int,
    *,
    log_date: date | None = None,
    include_members: bool = True,
) -> dict[str, Any]:
    day = log_date or datetime.utcnow().date()
    creator = db.query(User).filter(User.id == squad.creator_id).first()
    viewer_member = (
        db.query(SquadMember)
        .filter(SquadMember.squad_id == squad.id, SquadMember.user_id == viewer_id)
        .first()
    )
    payload: dict[str, Any] = {
        "id": squad.id,
        "name": squad.name,
        "creator": public_user(creator),
        "max_members": int(squad.max_members or DEFAULT_MAX_MEMBERS),
        "member_count": _joined_member_count(db, squad.id),
        "status": squad.status,
        "created_at": squad.created_at.isoformat() if squad.created_at else None,
        "viewer_status": viewer_member.status if viewer_member else None,
        "viewer_is_creator": squad.creator_id == viewer_id,
        "viewer_share_status": bool(viewer_member.share_status) if viewer_member else False,
        "squad_streak": compute_squad_streak(db, squad.id, day),
        "log_date": day.isoformat(),
    }
    if include_members:
        members = (
            db.query(SquadMember)
            .filter(
                SquadMember.squad_id == squad.id,
                SquadMember.status.in_(("joined", "invited")),
            )
            .all()
        )
        rows = [
            _serialize_member_status(db, member, log_date=day, viewer_id=viewer_id)
            for member in members
            if member.user_id == viewer_id
            or not _is_blocked_between(db, viewer_id, member.user_id)
        ]
        payload["members"] = rows
    return payload


def notify_squad_invite(db: Session, squad: Squad, inviter: User, invitee: User) -> None:
    title = (squad.name or "Gym squad").strip()[:50]
    send_push_to_user(
        db,
        user_id=invitee.id,
        category="social",
        title="Gym squad invite",
        body=f"{inviter.name} invited you to {title}.",
        event_key=f"squad-invite:{squad.id}:{invitee.id}",
        data={
            "kind": "squad_invite",
            "squad_id": squad.id,
            "sender_id": inviter.id,
            "sender_name": inviter.name,
            "deep_link": f"nexrep://social/squads/{squad.id}",
            "screen": "SocialGymSquads",
        },
    )


def notify_squad_nudge(db: Session, squad: Squad, member: SquadMember, squadmate_name: str, log_date: date) -> None:
    title = (squad.name or "Gym squad").strip()[:50]
    send_push_to_user(
        db,
        user_id=member.user_id,
        category="social",
        title="Squad nudge",
        body=f"{squadmate_name} logged today in {title}. Your turn!",
        event_key=f"squad-nudge:{squad.id}:{member.user_id}:{log_date.isoformat()}",
        data={
            "kind": "squad_nudge",
            "squad_id": squad.id,
            "log_date": log_date.isoformat(),
            "deep_link": f"nexrep://social/squads/{squad.id}",
            "screen": "SocialGymSquads",
        },
    )


def run_squad_nudges(db: Session, *, as_of: datetime | None = None) -> int:
    """UTC evening nudge pass — limitation: no per-user timezone stored yet."""
    now = as_of or datetime.utcnow()
    if now.hour < NUDGE_UTC_HOUR:
        return 0
    log_date = now.date()
    sent = 0
    squads = db.query(Squad).filter(Squad.status == "active").all()
    for squad in squads:
        members = (
            db.query(SquadMember)
            .filter(
                SquadMember.squad_id == squad.id,
                SquadMember.status == "joined",
                SquadMember.share_status.is_(True),
            )
            .all()
        )
        if len(members) < 2:
            continue
        active_names: list[str] = []
        inactive: list[SquadMember] = []
        for member in members:
            activity = member_activity_for_date(db, member.user_id, log_date)
            if activity["workout_logged"] or activity["meals_logged"]:
                user = db.query(User).filter(User.id == member.user_id).first()
                active_names.append(user.name if user and user.name else "A squadmate")
            else:
                inactive.append(member)
        if not active_names or not inactive:
            continue
        squadmate_name = active_names[0]
        for member in inactive:
            try:
                notify_squad_nudge(db, squad, member, squadmate_name, log_date)
                sent += 1
            except Exception:
                logger.exception("Squad nudge failed squad=%s user=%s", squad.id, member.user_id)
    return sent
