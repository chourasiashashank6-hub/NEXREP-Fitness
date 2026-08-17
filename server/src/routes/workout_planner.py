from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.services.planner_common import parse_local_date
from src.services.planner_swap_limits import DayRegenLimitExceeded, MonthPlanRegenLimitExceeded, SwapLimitExceeded
from src.services.workout_planner_service import (
    delete_workout_plan,
    generate_workout_plan,
    get_existing_workout_plan,
    regenerate_month_plan_workouts,
    regenerate_single_workout_day,
    swap_exercise,
    workout_plan_current_response,
    workout_plan_month_response,
)
from src.services.plan_reflow_service import (
    apply_reflow_patches,
    apply_weekly_compensation,
    build_weekly_review,
)
from src.services.planner_test_users import is_planner_days_unlocked_user, is_planner_test_user
from src.utils.auth import get_current_user
from src.utils.plan_check import require_feature

router = APIRouter(prefix="/api/workout-planner", tags=["workout-planner"])


def _require_workout_planner_plan(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if is_planner_test_user(current_user):
        return
    require_feature(current_user, "workout_plan_generation", db)


router.dependencies.append(Depends(_require_workout_planner_plan))

FOCUS_MUSCLES = {"Chest", "Back", "Shoulders", "Legs", "Arms", "Core"}


class WorkoutPlanGenerateRequest(BaseModel):
    focus_muscles: list[str] | None = None


class ExerciseSwapRequest(BaseModel):
    plan_id: int
    day: int
    exercise_index: int
    reason: str | None = None


class WorkoutRegenerateDayRequest(BaseModel):
    plan_id: int
    day: int


class RegenerateRemainingWorkoutRequest(BaseModel):
    plan_id: int
    focus_muscles: list[str] | None = None


class ReflowDayPatch(BaseModel):
    day: int
    exercises: list[dict[str, Any]]
    estimated_duration_min: int | None = None


class ReflowApplyRequest(BaseModel):
    plan_id: int
    patches: list[ReflowDayPatch]


class WeeklyCompensationRequest(BaseModel):
    plan_id: int


def _normalize_focus_muscles(muscles: list[str] | None) -> list[str]:
    if not muscles:
        return []
    out: list[str] = []
    for muscle in muscles:
        if muscle not in FOCUS_MUSCLES:
            raise HTTPException(status_code=422, detail=f"Invalid focus muscle: {muscle}")
        if muscle not in out:
            out.append(muscle)
    return out


@router.post("/generate")
def post_generate(
    body: WorkoutPlanGenerateRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Empty/missing selection means the service should resolve onboarding focus.
    focus_muscles = _normalize_focus_muscles(body.focus_muscles) or None
    plan = generate_workout_plan(db, current_user, focus_muscles=focus_muscles, local_date=local_date)
    return workout_plan_current_response(plan, local_date, db=db, user=current_user)


@router.get("/current")
def get_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the saved month plan only — never regenerate on read (matches meal planner)."""
    today = parse_local_date(local_date)
    plan = get_existing_workout_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No workout plan for this month")
    return workout_plan_current_response(plan, local_date, db=db, user=current_user)


@router.get("/day/{day}")
def get_day(
    day: int,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_workout_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No workout plan for this month")
    if (
        day > today.day
        and today.month == plan.month
        and today.year == plan.year
        and not is_planner_days_unlocked_user(current_user)
    ):
        return {
            "day": day,
            "is_rest_day": False,
            "locked": True,
            "message": f"This day's plan will be available on {today.replace(day=day).strftime('%B %d')}",
        }
    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Day not found")
    from src.services.workout_planner_service import _attach_workout_day_regen_stats, _monthly_workout_day_regen_stats, _workout_entry_dict

    payload = _workout_entry_dict(entry, locked=False)
    return _attach_workout_day_regen_stats(
        payload,
        _monthly_workout_day_regen_stats(db, current_user.id, plan.month, plan.year, user=current_user),
    )


@router.get("/month")
def get_month(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_workout_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No workout plan for this month")
    return workout_plan_month_response(plan, local_date)


@router.post("/regenerate-day")
def post_regenerate_day(
    body: WorkoutRegenerateDayRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return regenerate_single_workout_day(
            db,
            current_user,
            plan_id=body.plan_id,
            day=body.day,
            local_date=local_date,
        )
    except DayRegenLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/regenerate-remaining")
def post_regenerate_remaining(
    body: RegenerateRemainingWorkoutRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return regenerate_month_plan_workouts(
            db,
            current_user,
            plan_id=body.plan_id,
            local_date=local_date,
        )
    except MonthPlanRegenLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/swap-exercise")
def post_swap_exercise(
    body: ExerciseSwapRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return swap_exercise(
            db,
            current_user,
            plan_id=body.plan_id,
            day=body.day,
            exercise_index=body.exercise_index,
            reason=body.reason,
            local_date=local_date,
        )
    except SwapLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/reflow")
def post_reflow(
    body: ReflowApplyRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return apply_reflow_patches(
            db,
            current_user,
            plan_id=body.plan_id,
            patches=[patch.model_dump() for patch in body.patches],
            local_date=local_date,
        )
    except LookupError as e:
        import logging

        logging.getLogger(__name__).warning("reflow 404 user_id=%s plan_id=%s: %s", current_user.id, body.plan_id, e)
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        import logging

        logging.getLogger(__name__).warning("reflow 400 user_id=%s plan_id=%s: %s", current_user.id, body.plan_id, e)
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        import logging

        logging.getLogger(__name__).exception("reflow failed user_id=%s plan_id=%s", current_user.id, body.plan_id)
        raise HTTPException(status_code=500, detail="Reflow failed") from e


@router.get("/weekly-review")
def get_weekly_review(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    summary = build_weekly_review(db, current_user, local_date)
    return summary


@router.post("/weekly-review/apply")
def post_weekly_review_apply(
    body: WeeklyCompensationRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply weekly compensation reflow. Mobile clients do not call this — Sunday cron handles it."""
    try:
        result = apply_weekly_compensation(
            db,
            current_user,
            plan_id=body.plan_id,
            local_date=local_date,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Plan not found")
        return result
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/current")
def delete_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=403,
        detail="Workout plans cannot be deleted.",
    )
