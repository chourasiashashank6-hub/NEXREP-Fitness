from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.services.meal_planner_service import (
    delete_meal_plan,
    generate_meal_plan,
    get_existing_meal_plan,
    meal_plan_current_response,
    meal_plan_month_response,
    regenerate_remaining_meals,
    swap_meal,
)
from src.services.planner_swap_limits import SwapLimitExceeded
from src.services.planner_common import parse_local_date
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/meal-planner", tags=["meal-planner"])


class MealPlanGenerateRequest(BaseModel):
    budget_level: Literal["budget", "moderate", "flexible"] = "budget"


class MealSwapRequest(BaseModel):
    plan_id: int
    day: int
    meal_type: str
    reason: str | None = None


class RegenerateRemainingRequest(BaseModel):
    from_day: int


@router.post("/generate")
def post_generate(
    body: MealPlanGenerateRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = generate_meal_plan(db, current_user, budget_level=body.budget_level, local_date=local_date)
    return meal_plan_current_response(plan, local_date)


@router.get("/current")
def get_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_meal_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    return meal_plan_current_response(plan, local_date)


@router.get("/day/{day}")
def get_day(
    day: int,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_meal_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    if day > today.day and today.month == plan.month and today.year == plan.year:
        return {
            "day": day,
            "is_cheat_day": False,
            "locked": True,
            "message": f"This day's plan will be available on {today.replace(day=day).strftime('%B %d')}",
        }
    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Day not found")
    from src.services.meal_planner_service import _entry_to_day_dict

    return _entry_to_day_dict(entry, locked=False)


@router.get("/month")
def get_month(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_meal_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    return meal_plan_month_response(plan, local_date)


@router.post("/regenerate-remaining")
def post_regenerate_remaining(
    body: RegenerateRemainingRequest,
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        plan = regenerate_remaining_meals(db, current_user, from_day=body.from_day, local_date=local_date)
        return meal_plan_current_response(plan, local_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


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


@router.delete("/current")
def delete_current(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = parse_local_date(local_date)
    plan = get_existing_meal_plan(db, current_user.id, today.month, today.year)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for this month")
    delete_meal_plan(db, plan)
    return {"deleted": True}
