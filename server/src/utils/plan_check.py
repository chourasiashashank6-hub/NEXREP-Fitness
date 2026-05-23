from datetime import datetime

from fastapi import HTTPException

from src.models.models import User


def require_plan(user: User, minimum_plan: str) -> None:
    """
    Raise 403 if user's plan is below the minimum required.
    Plan hierarchy: free < pro < elite
    Also checks if plan has expired.
    """
    hierarchy = {"free": 0, "pro": 1, "elite": 2}
    user_level = hierarchy.get(user.plan_id or "free", 0)
    required_level = hierarchy.get(minimum_plan, 0)

    if user.plan_id != "free" and user.plan_expires_at:
        if user.plan_expires_at.replace(tzinfo=None) < datetime.utcnow():
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "PLAN_EXPIRED",
                    "message": "Your subscription has expired. Please renew to continue.",
                    "current_plan": user.plan_id,
                    "required_plan": minimum_plan,
                },
            )

    if user_level < required_level:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PLAN_UPGRADE_REQUIRED",
                "message": f"This feature requires the {minimum_plan} plan.",
                "current_plan": user.plan_id,
                "required_plan": minimum_plan,
            },
        )
