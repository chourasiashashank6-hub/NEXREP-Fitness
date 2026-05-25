from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.models.models import User
from src.services.subscription_service import is_pro


def require_plan(user: User, minimum_plan: str, db: Session) -> None:
    """
    Raise 403 if user's plan is below the minimum required.
    Plan hierarchy: free < pro < elite. Uses server-side is_pro() for pro checks.
    """
    hierarchy = {"free": 0, "pro": 1, "elite": 2}
    if minimum_plan == "pro" and not is_pro(db, user.id):
        user_level = 0
    else:
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
