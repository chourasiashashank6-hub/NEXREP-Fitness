"""Planner limits bypass for designated QA / test accounts."""

from __future__ import annotations

from src.models.models import User

PLANNER_TEST_EMAILS = frozenset({"prashant@gmail.com", "shashank1@gmail.com"})

# Unlock all calendar days in meal + workout planners (view/regenerate future days).
PLANNER_UNLOCK_ALL_DAYS_EMAILS = frozenset({"shashank1@gmail.com"})


def is_planner_test_user(user: User | None) -> bool:
    if not user or not getattr(user, "email", None):
        return False
    return user.email.strip().lower() in PLANNER_TEST_EMAILS


def is_meal_planner_test_user(user: User | None) -> bool:
    return is_planner_test_user(user)


def is_planner_days_unlocked_user(user: User | None) -> bool:
    if not user or not getattr(user, "email", None):
        return False
    return user.email.strip().lower() in PLANNER_UNLOCK_ALL_DAYS_EMAILS


def planner_unlimited_regen_stats() -> dict[str, int | bool]:
    return {
        "day_regens_used": 0,
        "day_regens_limit": 999,
        "day_regens_remaining": 999,
        "month_plan_regens_used": 0,
        "month_plan_regens_limit": 999,
        "month_plan_regens_remaining": 999,
        "planner_limits_exempt": True,
    }


def meal_planner_unlimited_regen_stats() -> dict[str, int | bool]:
    return planner_unlimited_regen_stats()


def planner_limits_exempt_flag(user: User | None) -> dict[str, bool]:
    if is_planner_test_user(user):
        return {"planner_limits_exempt": True}
    return {}


def meal_planner_limits_exempt_flag(user: User | None) -> dict[str, bool]:
    return planner_limits_exempt_flag(user)


def planner_days_unlocked_flag(user: User | None) -> dict[str, bool]:
    if is_planner_days_unlocked_user(user):
        return {"planner_days_unlocked": True}
    return {}
