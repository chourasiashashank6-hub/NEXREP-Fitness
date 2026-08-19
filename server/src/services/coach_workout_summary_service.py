"""Deterministic workout coach summary (rule-engine source for cadence views)."""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from src.models.models import StrengthLift, User, Workout
from src.services.coach_summary_labels import (
    score_label_key,
    weekly_workout_hero_label_key,
    workout_readiness_label_key,
)
from src.services.coach_volume_read import BASE_MUSCLES, read_muscle_sets_in_window, read_weekly_muscle_volume

MAIN_LIFT_PATTERNS: tuple[tuple[str, str], ...] = (
    ("bench", "coach.summary.workout.monthly.liftBench"),
    ("squat", "coach.summary.workout.monthly.liftSquat"),
    ("deadlift", "coach.summary.workout.monthly.liftDeadlift"),
)


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


def _dt_range(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())


def _muscle_snapshot(db: Session, user_id: int, *, now: datetime | None = None) -> dict[str, Any]:
    from src.main import _infer_muscles_from_workout

    now = now or datetime.utcnow()
    since = now - timedelta(days=14)
    rows = (
        db.query(Workout)
        .filter(Workout.user_id == user_id, Workout.date >= since)
        .order_by(Workout.date.desc())
        .all()
    )
    week_since = now - timedelta(days=7)
    by_muscle_sets: dict[str, int] = {m: 0 for m in BASE_MUSCLES}
    last_trained: dict[str, datetime] = {}

    for workout in rows:
        muscles = _infer_muscles_from_workout(workout, db)
        sets = max(0, int(workout.sets or 0))
        for muscle in muscles:
            if muscle not in by_muscle_sets:
                continue
            if workout.date >= week_since:
                by_muscle_sets[muscle] += sets
            if muscle not in last_trained or workout.date > last_trained[muscle]:
                last_trained[muscle] = workout.date

    muscle_groups: list[dict[str, Any]] = []
    recovery_values: list[int] = []
    for muscle in BASE_MUSCLES:
        dt = last_trained.get(muscle)
        hours = (now - dt).total_seconds() / 3600 if dt else 168
        recovery = max(12, min(96, round((min(168, hours) / 168) * 100)))
        status = "sore" if recovery < 28 else "tired" if recovery < 52 else "ready" if recovery < 76 else "fresh"
        recovery_values.append(recovery)
        muscle_groups.append(
            {
                "name": muscle,
                "status": status,
                "recovery_percent": recovery,
                "last_trained_at": dt.isoformat() if dt else None,
            }
        )

    volume = read_weekly_muscle_volume(db, user_id, now=now)
    readiness_score = round(sum(recovery_values) / len(recovery_values)) if recovery_values else 68
    return {
        "muscle_groups": muscle_groups,
        "weekly_volume": volume["weeklyVolume"],
        "total_weekly_sets": int(volume["totalWeeklySets"] or 0),
        "target_weekly_sets": int(volume["targetWeeklySets"] or 0),
        "readiness_score": readiness_score,
    }


def _readiness_factors(muscle_groups: list[dict[str, Any]], pct_complete: int) -> list[dict[str, Any]]:
    fresh = [g["name"] for g in muscle_groups if g.get("status") == "fresh"]
    sore = [g["name"] for g in muscle_groups if g.get("status") == "sore"]
    factors: list[dict[str, Any]] = []
    if fresh:
        factors.append(
            {
                "type": "good",
                "label_key": "coach.summary.workout.daily.factorMuscleFresh",
                "params": {"muscle": fresh[0]},
            }
        )
    if sore:
        factors.append(
            {
                "type": "bad",
                "label_key": "coach.summary.workout.daily.factorMuscleSore",
                "params": {"muscle": sore[0]},
            }
        )
    elif not fresh:
        factors.append(
            {"type": "good", "label_key": "coach.summary.workout.daily.factorLowSoreness", "params": {}}
        )
    factors.append(
        {
            "type": "warning" if pct_complete < 50 else "info",
            "label_key": "coach.summary.workout.daily.factorWeeklyVolume",
            "params": {"percent": pct_complete},
        }
    )
    factors.append({"type": "info", "label_key": "coach.summary.workout.daily.factorSleep", "params": {}})
    return factors[:4]


def _build_workout_tips(
    muscle_groups: list[dict[str, Any]],
    weekly_volume: list[dict[str, Any]],
    readiness_score: int,
) -> list[dict[str, Any]]:
    tips: list[dict[str, Any]] = []
    sore = [g["name"] for g in muscle_groups if g.get("status") == "sore"]
    if sore:
        tips.append(
            {
                "key": "coach.summary.workout.daily.tipRestMuscle",
                "params": {"muscle": sore[0], "count": len(sore)},
                "priority": "high",
                "icon": "moon",
                "category": "recovery",
            }
        )

    undertrained = [
        m
        for m in weekly_volume
        if int(m.get("sets") or 0) < int(m.get("targetSets") or 14) * 0.5
    ]
    if undertrained:
        row = undertrained[0]
        tips.append(
            {
                "key": "coach.summary.workout.daily.tipCloseGap",
                "params": {
                    "muscle": str(row.get("muscle") or "muscle"),
                    "current": int(row.get("sets") or 0),
                    "target": int(row.get("targetSets") or 14),
                },
                "priority": "high",
                "icon": "target",
                "category": "volume",
            }
        )

    if readiness_score < 50 and len([t for t in tips if t.get("category") == "recovery"]) < 2:
        tips.append(
            {
                "key": "coach.summary.workout.daily.tipPrioritizeRecovery",
                "params": {"score": readiness_score},
                "priority": "high",
                "icon": "moon",
                "category": "recovery",
            }
        )

    if readiness_score > 75:
        fresh = [g["name"] for g in muscle_groups if g.get("status") == "fresh"]
        if fresh:
            tips.append(
                {
                    "key": "coach.summary.workout.daily.tipPushVolume",
                    "params": {"muscle": fresh[0]},
                    "priority": "medium",
                    "icon": "fire",
                    "category": "programming",
                }
            )

    tips.append(
        {
            "key": "coach.summary.workout.daily.tipSlowEccentric",
            "params": {},
            "priority": "medium",
            "icon": "dumbbell",
            "category": "technique",
        }
    )
    tips.append(
        {
            "key": "coach.summary.workout.daily.tipHydrate",
            "params": {},
            "priority": "low",
            "icon": "droplet",
            "category": "nutrition",
        }
    )

    if not tips:
        tips.append(
            {
                "key": "coach.summary.workout.daily.tipLogWorkouts",
                "params": {},
                "priority": "high",
                "icon": "target",
                "category": "programming",
            }
        )
    return tips[:4]


def _recovery_cards() -> list[dict[str, Any]]:
    return [
        {"icon": "sleep", "title_key": "coach.summary.workout.recovery.sleepTitle", "body_key": "coach.summary.workout.recovery.sleepBody"},
        {"icon": "water", "title_key": "coach.summary.workout.recovery.hydrateTitle", "body_key": "coach.summary.workout.recovery.hydrateBody"},
        {"icon": "stretch", "title_key": "coach.summary.workout.recovery.stretchTitle", "body_key": "coach.summary.workout.recovery.stretchBody"},
    ]


def _sets_on_date(db: Session, user_id: int, log_date: date) -> int:
    start, end = _dt_range(log_date, log_date)
    rows = db.query(Workout).filter(Workout.user_id == user_id, Workout.date >= start, Workout.date < end).all()
    return sum(max(0, int(w.sets or 0)) for w in rows)


def _workout_days_in_range(db: Session, user_id: int, start: date, end: date) -> set[date]:
    ws, we = _dt_range(start, end)
    rows = db.query(Workout).filter(Workout.user_id == user_id, Workout.date >= ws, Workout.date < we).all()
    return {w.date.date() if isinstance(w.date, datetime) else w.date for w in rows}


def _strength_progression(db: Session, user_id: int, start: date, end: date) -> list[dict[str, Any]]:
    ws, we = _dt_range(start, end)
    rows = (
        db.query(StrengthLift)
        .filter(StrengthLift.user_id == user_id, StrengthLift.date >= ws, StrengthLift.date < we)
        .order_by(StrengthLift.date.asc())
        .all()
    )
    out: list[dict[str, Any]] = []
    for pattern, label_key in MAIN_LIFT_PATTERNS:
        matches = [r for r in rows if pattern in (r.exercise_name or "").lower()]
        if len(matches) < 2:
            continue
        start_kg = float(matches[0].weight_kg or 0)
        end_kg = float(matches[-1].weight_kg or 0)
        if start_kg <= 0:
            continue
        out.append(
            {
                "label_key": label_key,
                "start_kg": round(start_kg, 1),
                "end_kg": round(end_kg, 1),
                "delta_kg": round(end_kg - start_kg, 1),
            }
        )
    return out


def _volume_by_week(db: Session, user_id: int, start: date, end: date) -> list[dict[str, Any]]:
    from src.main import _infer_muscles_from_workout

    dates = _iter_dates(start, end)
    if not dates:
        return []
    week_count = max(1, (len(dates) + 6) // 7)
    buckets = [0 for _ in range(week_count)]
    ws, we = _dt_range(start, end)
    rows = db.query(Workout).filter(Workout.user_id == user_id, Workout.date >= ws, Workout.date < we).all()
    for workout in rows:
        wdate = workout.date.date() if isinstance(workout.date, datetime) else workout.date
        day_index = (wdate - start).days
        bucket = min(week_count - 1, day_index // 7)
        buckets[bucket] += max(0, int(workout.sets or 0))
    return [{"week": i + 1, "sets": buckets[i]} for i in range(week_count)]


def _build_weekly_notes(
    current_sets: int,
    target_sets: int,
    prev_sets: int,
    undertrained_muscle: str | None,
) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    if prev_sets > 0 and current_sets != prev_sets:
        notes.append(
            {
                "kind": "what_changed",
                "key": "coach.summary.workout.weekly.whatChanged",
                "params": {"prevSets": prev_sets, "currSets": current_sets},
            }
        )
    if undertrained_muscle and current_sets > 0:
        notes.append(
            {
                "kind": "undertrained",
                "key": "coach.summary.workout.weekly.undertrained",
                "params": {"muscle": undertrained_muscle},
            }
        )
    pct = round((current_sets / target_sets) * 100) if target_sets else 0
    if current_sets > 0 or prev_sets > 0:
        notes.append(
            {
                "kind": "adjust_next_week",
                "key": "coach.summary.workout.weekly.adjustNext",
                "params": {"percent": pct},
            }
        )
    return notes


def _build_monthly_notes(
    sessions: int,
    volume_trend_pct: int | None,
    progression: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    if volume_trend_pct is not None:
        if volume_trend_pct >= 10:
            notes.append(
                {
                    "kind": "recurring_pattern",
                    "key": "coach.summary.workout.monthly.patternVolumeUp",
                    "params": {"percent": volume_trend_pct},
                }
            )
        elif volume_trend_pct <= -10:
            notes.append(
                {
                    "kind": "recurring_pattern",
                    "key": "coach.summary.workout.monthly.patternVolumeDown",
                    "params": {"percent": abs(volume_trend_pct)},
                }
            )
    flat = [p for p in progression if abs(float(p.get("delta_kg") or 0)) < 1]
    if flat:
        notes.append(
            {
                "kind": "plateau",
                "key": "coach.summary.workout.monthly.plateau",
                "params": {"liftKey": flat[0]["label_key"]},
            }
        )
    elif progression:
        best = max(progression, key=lambda p: float(p.get("delta_kg") or 0))
        notes.append(
            {
                "kind": "biggest_win",
                "key": "coach.summary.workout.monthly.winStrength",
                "params": {"liftKey": best["label_key"], "deltaKg": best["delta_kg"]},
            }
        )
    if sessions > 0:
        notes.append(
            {
                "kind": "next_month",
                "key": "coach.summary.workout.monthly.nextMonthFocus",
                "params": {"sessions": sessions},
            }
        )
    return notes


def build_workout_summary(db: Session, user: User, cadence: str, local_date: date) -> dict[str, Any]:
    start, end = _period_bounds(cadence, local_date)
    now = datetime.combine(local_date, datetime.max.time())
    snap = _muscle_snapshot(db, user.id, now=now)
    target_sets = max(1, int(snap["target_weekly_sets"] or 84))
    completed_sets = int(snap["total_weekly_sets"] or 0)
    pct_complete = round((completed_sets / target_sets) * 100) if target_sets else 0

    payload: dict[str, Any] = {
        "domain": "workout",
        "cadence": cadence,
        "period": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "days_in_period": len(_iter_dates(start, end)),
            "days_with_data": 0,
            "label_partial": False,
        },
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }

    if cadence == "daily":
        score = int(snap["readiness_score"])
        has_history = any(g.get("last_trained_at") for g in snap["muscle_groups"])
        payload["period"]["days_with_data"] = 1 if (_sets_on_date(db, user.id, local_date) > 0 or has_history) else 0
        payload["daily"] = {
            "readiness_score": score,
            "readiness_label_key": workout_readiness_label_key(score),
            "completed_sets_today": _sets_on_date(db, user.id, local_date),
            "completed_sets_week": completed_sets,
            "target_sets_week": target_sets,
            "weekly_percent": pct_complete,
            "muscle_groups": snap["muscle_groups"],
            "readiness_factors": _readiness_factors(snap["muscle_groups"], pct_complete),
            "tips": _build_workout_tips(snap["muscle_groups"], snap["weekly_volume"], score),
            "recovery_cards": _recovery_cards(),
        }
        insight_muscles = [g["name"] for g in snap["muscle_groups"] if g.get("status") == "fresh"]
        if has_history or completed_sets > 0:
            payload["notes"] = [
                {
                    "kind": "readiness_insight",
                    "key": "coach.summary.workout.daily.insightFresh"
                    if insight_muscles
                    else "coach.summary.workout.daily.insightRecovery",
                    "params": {"muscle": insight_muscles[0]} if insight_muscles else {"score": score},
                }
            ]
        return payload

    if cadence == "weekly":
        trained_days = _workout_days_in_range(db, user.id, start, end)
        consistency = [{"date": d.isoformat(), "trained": d in trained_days} for d in _iter_dates(start, end)]
        sessions = len(trained_days)
        days_in_period = len(_iter_dates(start, end))
        ws, we = _dt_range(start, end)
        by_muscle = read_muscle_sets_in_window(db, user.id, ws, we)
        volume_by_muscle = [
            {"muscle": m, "sets": by_muscle.get(m, 0), "target_sets": int(row.get("targetSets") or 14)}
            for m in BASE_MUSCLES
            for row in [next((r for r in snap["weekly_volume"] if r.get("muscle") == m), {"targetSets": 14})]
        ]
        prev_start = start - timedelta(days=7)
        prev_end = start - timedelta(days=1)
        pws, pwe = _dt_range(prev_start, prev_end)
        prev_by_muscle = read_muscle_sets_in_window(db, user.id, pws, pwe)
        prev_sets = sum(prev_by_muscle.values())
        undertrained = next(
            (m["muscle"] for m in volume_by_muscle if int(m.get("sets") or 0) < int(m.get("target_sets") or 14) * 0.5),
            None,
        )
        week_score = int(round((pct_complete + min(100, sessions * 15)) / 2))
        payload["weekly"] = {
            "week_score": week_score,
            "hero_label_key": weekly_workout_hero_label_key(pct_complete),
            "completed_sets": completed_sets,
            "target_sets": target_sets,
            "weekly_percent": pct_complete,
            "sessions": sessions,
            "volume_by_muscle": volume_by_muscle,
            "consistency": consistency,
        }
        payload["period"]["days_with_data"] = sessions
        payload["period"]["label_partial"] = sessions < days_in_period
        payload["notes"] = _build_weekly_notes(completed_sets, target_sets, prev_sets, undertrained)
        return payload

    # monthly
    days_in_period = len(_iter_dates(start, end))
    ws, we = _dt_range(start, end)
    month_rows = db.query(Workout).filter(Workout.user_id == user.id, Workout.date >= ws, Workout.date < we).all()
    sessions = len({(w.date.date() if isinstance(w.date, datetime) else w.date) for w in month_rows})
    month_sets = sum(max(0, int(w.sets or 0)) for w in month_rows)

    prev_month_end = start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)
    pws, pwe = _dt_range(prev_month_start, prev_month_end)
    prev_rows = db.query(Workout).filter(Workout.user_id == user.id, Workout.date >= pws, Workout.date < pwe).all()
    prev_sets = sum(max(0, int(w.sets or 0)) for w in prev_rows)
    volume_trend_pct = round(((month_sets - prev_sets) / prev_sets) * 100) if prev_sets else None

    progression = _strength_progression(db, user.id, start, end)
    month_score = min(100, max(0, sessions * 12))
    payload["monthly"] = {
        "month_score": month_score,
        "hero_label_key": "coach.summary.workout.monthly.heroTitle",
        "sessions": sessions,
        "total_sets": month_sets,
        "volume_trend_pct": volume_trend_pct,
        "volume_by_week": _volume_by_week(db, user.id, start, end),
        "strength_progression": progression,
    }
    payload["period"]["days_with_data"] = sessions
    payload["period"]["label_partial"] = (
        end.day < calendar.monthrange(end.year, end.month)[1] or sessions < days_in_period
    )
    payload["notes"] = _build_monthly_notes(sessions, volume_trend_pct, progression)
    return payload
