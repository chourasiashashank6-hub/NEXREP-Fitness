"""Active guided workout session completion API."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import (
    Activity,
    User,
    Workout,
    WorkoutSession,
    WorkoutSessionSetLog,
)
from src.services.activity_feed_service import emit_streak_milestone_if_needed
from src.services.exercise_met_service import resolve_met_for_exercise
from src.services.resolve_burn_target_weight_kg import resolve_burn_target_weight_kg
from src.services.session_calories import calc_active_set_kcal
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/sessions", tags=["workout-sessions"])


class SetLogIn(BaseModel):
    exercise_name: str
    set_number: int
    reps: int
    weight_kg: float | None = None
    started_at: datetime
    completed_at: datetime
    tracking_method: Literal["manual", "ai_camera"] = "manual"
    prescribed_reps: int | None = None
    rest_seconds: int | None = None


class CompleteSessionRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64)
    plan_day_id: str
    started_at: datetime
    ended_at: datetime
    status: Literal["completed", "abandoned"]
    set_logs: list[SetLogIn]
    user_weight_kg: float = Field(..., gt=0)
    # Optional AI trainer block — stored, does not affect kcal / idempotency key
    ai_tracking: dict[str, Any] | None = None


class CompleteSessionResponse(BaseModel):
    session_id: str
    server_kcal_total: float
    streak_incremented: bool


def _lookup_met(db: Session, exercise_name: str) -> float:
    return resolve_met_for_exercise(db, exercise_name=exercise_name)


def _active_set_kcal(log: SetLogIn, met: float, weight: float) -> int:
    work_sec = max(0.0, (log.completed_at - log.started_at).total_seconds())
    return calc_active_set_kcal(
        met=met,
        user_weight_kg=weight,
        work_sec=work_sec,
        rest_sec=log.rest_seconds,
        reps=log.reps,
        prescribed_reps=log.prescribed_reps,
    )


@router.post("/complete", response_model=CompleteSessionResponse)
def complete_session(
    payload: CompleteSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompleteSessionResponse:
    existing = (
        db.query(WorkoutSession)
        .filter(
            WorkoutSession.session_id == payload.session_id,
            WorkoutSession.user_id == current_user.id,
        )
        .first()
    )

    # Idempotent: if already finalized, return stored result
    if existing and existing.status in ("completed", "abandoned") and existing.ended_at is not None:
        return CompleteSessionResponse(
            session_id=existing.session_id,
            server_kcal_total=float(existing.server_kcal_total or 0),
            streak_incremented=bool(existing.streak_incremented),
        )

    weight = resolve_burn_target_weight_kg(db, current_user)

    computed_logs: list[tuple[SetLogIn, int]] = []
    total_kcal = 0
    for log in payload.set_logs:
        met = _lookup_met(db, log.exercise_name)
        kcal = _active_set_kcal(log, met, weight)
        computed_logs.append((log, kcal))
        total_kcal += kcal

    if existing is None:
        session = WorkoutSession(
            session_id=payload.session_id,
            user_id=current_user.id,
            plan_day_id=payload.plan_day_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            status=payload.status,
            server_kcal_total=total_kcal,
            streak_incremented=False,
            ai_tracking=payload.ai_tracking,
        )
        db.add(session)
        db.flush()
    else:
        session = existing
        session.plan_day_id = payload.plan_day_id
        session.started_at = payload.started_at
        session.ended_at = payload.ended_at
        session.status = payload.status
        session.server_kcal_total = total_kcal
        if payload.ai_tracking is not None:
            session.ai_tracking = payload.ai_tracking
        db.query(WorkoutSessionSetLog).filter(WorkoutSessionSetLog.session_pk == session.id).delete()

    for log, kcal in computed_logs:
        db.add(
            WorkoutSessionSetLog(
                session_pk=session.id,
                exercise_name=log.exercise_name[:255],
                set_number=log.set_number,
                reps=log.reps,
                weight_kg=log.weight_kg,
                started_at=log.started_at,
                completed_at=log.completed_at,
                server_kcal=kcal,
                tracking_method=log.tracking_method or "manual",
            )
        )

    streak_incremented = False

    # Write Workout + Activity for every exercise with ≥1 logged set,
    # regardless of session status — so abandoned partials appear in history.
    if computed_logs:
        exercise_map: dict[str, dict[str, float | int]] = defaultdict(
            lambda: {"sets": 0, "reps": 0, "duration": 0, "kcal": 0.0}
        )
        for log, kcal in computed_logs:
            agg = exercise_map[log.exercise_name]
            agg["sets"] = int(agg["sets"]) + 1
            agg["reps"] = int(agg["reps"]) + int(log.reps)
            agg["duration"] = int(agg["duration"]) + max(
                0, int((log.completed_at - log.started_at).total_seconds())
            )
            agg["kcal"] = float(agg["kcal"]) + float(kcal)

        is_partial = payload.status == "abandoned"
        notes_prefix = "active_session_partial" if is_partial else "active_session"

        for exercise_name, agg in exercise_map.items():
            duration_sec = int(agg["duration"])
            # Prefer minutes for Workout.duration (manual log uses minutes)
            duration_for_row = max(1, (duration_sec + 59) // 60)

            workout = Workout(
                user_id=current_user.id,
                type="strength",
                exercise_name=str(exercise_name)[:120],
                sets=int(agg["sets"]),
                reps=int(agg["reps"]),
                duration=duration_for_row,
                notes=f"{notes_prefix}:{payload.session_id}",
                date=payload.ended_at,
            )
            db.add(workout)
            db.flush()

            db.add(
                Activity(
                    user_id=current_user.id,
                    kind="exercise",
                    title=f"Strength: {exercise_name}",
                    calories=int(round(float(agg["kcal"]))),
                    duration=duration_for_row,
                    intensity="moderate",
                )
            )

            # Streak / milestone — completed sessions only
            if payload.status == "completed":
                emit_streak_milestone_if_needed(
                    db, user_id=current_user.id, source="workout", source_id=workout.id
                )

        if payload.status == "completed":
            streak_incremented = True
            session.streak_incremented = True
        else:
            # abandoned: streak stays exactly as-is (no increment, no reset)
            streak_incremented = False
            session.streak_incremented = False

    db.commit()
    db.refresh(session)

    return CompleteSessionResponse(
        session_id=session.session_id,
        server_kcal_total=float(session.server_kcal_total or 0),
        streak_incremented=bool(session.streak_incremented),
    )
