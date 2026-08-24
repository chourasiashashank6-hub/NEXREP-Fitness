"""
Grant workout planner regeneration tokens for a user (all monthly_workout_plans rows).

Usage (from server/):
  python scripts/grant_workout_regen_tokens.py --email nexrep.prod.test@gmail.com --day-tokens 5 --month-tokens 5

Production:
  DATABASE_URL="postgresql+psycopg://..." python scripts/grant_workout_regen_tokens.py \\
    --email nexrep.prod.test@gmail.com --day-tokens 5 --month-tokens 5
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from sqlalchemy import func  # noqa: E402

from src.db.session import SessionLocal  # noqa: E402
from src.models.meal_plan import MonthlyWorkoutPlan  # noqa: E402
from src.models.models import User  # noqa: E402


def grant_tokens(
    db,
    *,
    email: str,
    day_tokens: int | None,
    month_tokens: int | None,
    reset_used: bool,
) -> dict:
    if day_tokens is None and month_tokens is None:
        raise ValueError("Set at least one of --day-tokens or --month-tokens")

    user = db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()
    if not user:
        raise ValueError(f"No user found for email: {email}")

    plans = (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.user_id == user.id)
        .order_by(MonthlyWorkoutPlan.year.desc(), MonthlyWorkoutPlan.month.desc())
        .all()
    )

    updated = []
    for plan in plans:
        if day_tokens is not None:
            if reset_used:
                plan.day_regens_used = 0
            plan.day_regens_limit = day_tokens
        if month_tokens is not None:
            if reset_used:
                plan.month_plan_regens_used = 0
            plan.month_plan_regens_limit = month_tokens
        updated.append(
            {
                "plan_id": plan.id,
                "month": plan.month,
                "year": plan.year,
                "day_regens_used": plan.day_regens_used,
                "day_regens_limit": plan.day_regens_limit,
                "day_regens_remaining": max(0, plan.day_regens_limit - plan.day_regens_used),
                "month_plan_regens_used": plan.month_plan_regens_used,
                "month_plan_regens_limit": plan.month_plan_regens_limit,
                "month_plan_regens_remaining": max(
                    0, plan.month_plan_regens_limit - plan.month_plan_regens_used
                ),
            }
        )

    if updated:
        db.commit()

    return {
        "user_id": user.id,
        "email": user.email,
        "day_tokens_granted": day_tokens,
        "month_tokens_granted": month_tokens,
        "reset_used": reset_used,
        "plans_updated": len(updated),
        "plans": updated,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Grant workout planner regeneration tokens.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--day-tokens", type=int, default=None, help="Day-regen limit (optional)")
    parser.add_argument("--month-tokens", type=int, default=None, help="Month-plan regen limit (optional)")
    parser.add_argument(
        "--tokens",
        type=int,
        default=None,
        help="Shorthand: sets both day and month limits when --day-tokens/--month-tokens omitted",
    )
    parser.add_argument(
        "--no-reset-used",
        action="store_true",
        help="Keep used counters; only raise limits.",
    )
    args = parser.parse_args()

    day_tokens = args.day_tokens
    month_tokens = args.month_tokens
    if args.tokens is not None:
        if day_tokens is None:
            day_tokens = args.tokens
        if month_tokens is None:
            month_tokens = args.tokens

    if day_tokens is not None and day_tokens < 1:
        print("--day-tokens must be at least 1", file=sys.stderr)
        return 1
    if month_tokens is not None and month_tokens < 1:
        print("--month-tokens must be at least 1", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        result = grant_tokens(
            db,
            email=args.email,
            day_tokens=day_tokens,
            month_tokens=month_tokens,
            reset_used=not args.no_reset_used,
        )
        print(json.dumps(result, indent=2))
        if result["plans_updated"] == 0:
            print(
                "\nNo monthly_workout_plans rows for this user yet. "
                "Generate a workout plan first, then re-run this script — "
                "or new plans will use server overrides until updated.",
                file=sys.stderr,
            )
        return 0
    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
