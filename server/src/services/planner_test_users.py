"""Meal planner limits bypass for designated QA / test accounts."""

from __future__ import annotations

from src.models.models import User

MEAL_PLANNER_TEST_EMAILS = frozenset({"prashant@gmail.com"})


def is_meal_planner_test_user(user: User | None) -> bool:
    if not user or not getattr(user, "email", None):
        return False
    return user.email.strip().lower() in MEAL_PLANNER_TEST_EMAILS


def meal_planner_unlimited_regen_stats() -> dict[str, int]:
    return {
        "day_regens_used": 0,
        "day_regens_limit": 999,
        "day_regens_remaining": 999,
        "planner_limits_exempt": True,
    }


def meal_planner_limits_exempt_flag(user: User | None) -> dict[str, bool]:
    if is_meal_planner_test_user(user):
        return {"planner_limits_exempt": True}
    return {}
