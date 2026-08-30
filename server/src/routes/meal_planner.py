from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.services.planner_test_users import is_planner_days_unlocked_user
from src.services.meal_planner_service import (
    _build_week_response,
    _monthly_day_regen_stats,
    delete_meal_plan,
    generate_meal_plan,
    generate_week_plan,
    get_existing_monthly_meal_plan,
    get_plan_for_day,
    get_weekly_plan_by_start_day,
    list_weekly_plans_for_month,
    meal_plan_current_response,
    meal_plan_current_weekly_response,
    meal_plan_month_response,
    regenerate_remaining_meals,
    regenerate_single_day,
    regenerate_week_plan,
    swap_meal,
    user_has_stale_meal_plan,
    weeks_overview_response,
)
from src.services.planner_nutrition_extras import (
    protein_suggestions_response,
    supplement_recommendations_response,
)
from src.services.planner_swap_limits import DayRegenLimitExceeded, SwapLimitExceeded
from src.services.planner_common import parse_local_date
from src.services.planner_test_users import is_meal_planner_test_user
from src.utils.auth import get_current_user
from src.utils.plan_check import require_feature
from src.services.meal_engine_v3 import EmptyRecipePoolError

router = APIRouter(prefix="/api/meal-planner", tags=["meal-planner"])


def _require_meal_planner_plan(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if is_meal_planner_test_user(current_user):
        return
    require_feature(current_user, "meal_plan_generation", db)


router.dependencies.append(Depends(_require_meal_planner_plan))


def _meal_engine_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, EmptyRecipePoolError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=500, detail=str(exc))
    raise exc


class MealPlanGenerateRequest(BaseModel):
    budget_level: Literal["budget", "moderate", "flexible"] = "budget"


class GenerateWeekRequest(BaseModel):
    budget_level: Literal["budget", "moderate", "flexible"] = "budget"
    week_start_day: int


class RegenerateWeekRequest(BaseModel):
    week_start_day: int | None = None
    week_start: int | None = None
    from_day: int
    exclude_foods: list[str] = []
    exclude_dishes: list[dict[str, Any] | str] = []


class MealSwapRequest(BaseModel):
    plan_id: int
    day: int
    meal_type: str
    reason: str | None = None


class RegenerateRemainingRequest(BaseModel):
    from_day: int
    exclude_foods: list[str] = []
    exclude_dishes: list[dict[str, Any] | str] = []


class RegenerateDayRequest(BaseModel):
    plan_id: int
    day: int
    exclude_foods: list[str] = []
    exclude_dishes: list[dict[str, Any] | str] = []


@router.post("/generate")
def post_generate(
    body: MealPlanGenerateRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        plan = generate_meal_plan(db, current_user, budget_level=body.budget_level, local_date=local_date)
        return meal_plan_current_response(plan, local_date, db=db, user=current_user)
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e
    except RuntimeError as e:
        raise _meal_engine_http_error(e) from e


@router.post("/generate-week")
def post_generate_week(
    body: GenerateWeekRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return generate_week_plan(
            db,
            current_user,
            budget_level=body.budget_level,
            week_start_day=body.week_start_day,
            local_date=local_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e
    except RuntimeError as e:
        raise _meal_engine_http_error(e) from e
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save week plan. Please try again.") from e


@router.get("/weeks")
def get_weeks(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return weeks_overview_response(db, current_user, local_date)


@router.get("/week")
def get_week(
    week_start_day: int = Query(...),
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_weekly_plan_by_start_day(db, current_user.id, today.month, today.year, week_start_day)
    if not plan:
        raise HTTPException(status_code=404, detail="Week plan not found")
    return _build_week_response(plan, local_date, db=db, user=current_user)


@router.get("/current")
def get_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    weekly_plans = list_weekly_plans_for_month(db, current_user.id, today.month, today.year)
    if weekly_plans:
        return meal_plan_current_weekly_response(db, current_user, local_date)

    plan = get_existing_monthly_meal_plan(db, current_user.id, today.month, today.year)
    if plan:
        return meal_plan_current_response(plan, local_date, db=db, user=current_user)

    raise HTTPException(status_code=404, detail="No meal plan for this month")


@router.get("/day/{day}")
def get_day(
    day: int,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_plan_for_day(db, current_user.id, today.month, today.year, day)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    if (
        day > today.day
        and today.month == plan.month
        and today.year == plan.year
        and not is_planner_days_unlocked_user(current_user)
    ):
        return {
            "day": day,
            "is_cheat_day": False,
            "locked": True,
            "message": f"This day's plan will be available on {today.replace(day=day).strftime('%B %d')}",
        }
    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Day not found")
    from src.services.meal_planner_service import _entry_to_day_dict, _plan_targets_dict

    targets = _plan_targets_dict(plan, db, current_user)
    local = parse_local_date(local_date).isoformat()
    result = _entry_to_day_dict(entry, plan=plan, targets=targets, locked=False)
    return {**result, **_monthly_day_regen_stats(db, current_user.id, plan.month, plan.year, user=current_user)}


@router.get("/month")
def get_month(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_plan_for_day(db, current_user.id, today.month, today.year, today.day)
    if not plan:
        plan = get_existing_monthly_meal_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    return meal_plan_month_response(plan, local_date, db=db, user=current_user)


@router.post("/regenerate-week")
def post_regenerate_week(
    body: RegenerateWeekRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stale_allowed = user_has_stale_meal_plan(db, current_user, local_date)
    if not is_meal_planner_test_user(current_user) and not stale_allowed:
        raise HTTPException(
            status_code=403,
            detail="Full plan regeneration is not available. You can regenerate individual days (3 times per month) or swap individual meals.",
        )
    try:
        week_start = body.week_start_day if body.week_start_day is not None else body.week_start
        if week_start is None:
            raise HTTPException(status_code=400, detail="week_start_day is required")
        return regenerate_week_plan(
            db,
            current_user,
            week_start_day=week_start,
            from_day=body.from_day,
            local_date=local_date,
            exclude_foods=body.exclude_foods,
            exclude_dishes=body.exclude_dishes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e
    except RuntimeError as e:
        raise _meal_engine_http_error(e) from e
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save regenerated week. Please try again.") from e


@router.post("/regenerate-remaining")
def post_regenerate_remaining(
    body: RegenerateRemainingRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stale_allowed = user_has_stale_meal_plan(db, current_user, local_date)
    if not is_meal_planner_test_user(current_user) and not stale_allowed:
        raise HTTPException(
            status_code=403,
            detail="Full plan regeneration is not available. You can regenerate individual days (3 times per month) or swap individual meals.",
        )
    try:
        plan = regenerate_remaining_meals(
            db,
            current_user,
            from_day=body.from_day,
            local_date=local_date,
            exclude_foods=body.exclude_foods,
            exclude_dishes=body.exclude_dishes,
        )
        return meal_plan_current_response(plan, local_date, db=db, user=current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to save regenerated meals due to a duplicate day. Please try again.",
        ) from e


@router.post("/regenerate-day")
def post_regenerate_day(
    body: RegenerateDayRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return regenerate_single_day(
            db,
            current_user,
            plan_id=body.plan_id,
            day=body.day,
            local_date=local_date,
            exclude_foods=body.exclude_foods,
            exclude_dishes=body.exclude_dishes,
        )
    except DayRegenLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e
    except RuntimeError as e:
        raise _meal_engine_http_error(e) from e
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save regenerated day. Please try again.") from e


@router.post("/swap-meal")
def post_swap_meal(
    body: MealSwapRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return swap_meal(
            db,
            current_user,
            plan_id=body.plan_id,
            day=body.day,
            meal_type=body.meal_type,
            reason=body.reason,
            local_date=local_date,
        )
    except SwapLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except EmptyRecipePoolError as e:
        raise _meal_engine_http_error(e) from e


@router.get("/protein-suggestions")
def get_protein_suggestions(
    day: int = Query(...),
    plan_id: int | None = Query(default=None),
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return protein_suggestions_response(
        db,
        current_user,
        day=day,
        plan_id=plan_id,
        local_date=local_date,
    )


@router.get("/supplement-recommendations")
def get_supplement_recommendations(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return supplement_recommendations_response(db, current_user)


@router.delete("/current")
def delete_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_meal_planner_test_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Meal plans cannot be deleted. You can regenerate individual days or swap meals.",
        )
    today = parse_local_date(local_date)
    monthly = get_existing_monthly_meal_plan(db, current_user.id, today.month, today.year)
    if monthly:
        delete_meal_plan(db, monthly)
        return {"deleted": True}
    weekly = list_weekly_plans_for_month(db, current_user.id, today.month, today.year)
    if not weekly:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    for plan in weekly:
        delete_meal_plan(db, plan)
    return {"deleted": True}
