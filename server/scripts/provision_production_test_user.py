"""
Create or upgrade a production test user with Elite access and complete onboarding.

Usage (from server/ with production DATABASE_URL):
  DATABASE_URL="postgresql+psycopg://..." python scripts/provision_production_test_user.py \\
    --email nexrep.prod.test@gmail.com \\
    --password 'NexRep@Test2026!' \\
    --name "NexRep Tester"

Then in the mobile app: Sign up with the same email + password (Firebase + API).
If the Postgres account already exists, signup falls back to login automatically.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from sqlalchemy import func  # noqa: E402

from src.db.session import SessionLocal  # noqa: E402
from src.models.admin_models import Subscription  # noqa: E402
from src.models.models import User, UserOnboarding  # noqa: E402
from src.services.auth_service import hash_password  # noqa: E402


def _default_onboarding(name: str) -> dict:
    today = date.today().isoformat()
    return {
        "personal": {
            "name": name,
            "age": 28,
            "sex": "male",
            "unit_system": "metric",
            "height_cm": 175,
            "height_in": None,
            "weight_kg": 75,
            "weight_lb": None,
            "body_fat_percentage": 18,
            "bf_measurement_method": "visual_estimate",
        },
        "goal": {
            "type": "muscle_gain",
            "pace": "moderate",
            "difficulty": "intermediate",
            "focus_muscles": ["Chest", "Arms"],
            "focus_muscle": None,
            "target_lifts": [],
            "target_weight_kg": 80,
            "target_weight_lb": None,
            "target_date": None,
        },
        "activity": {
            "level": "moderately_active",
            "workouts_per_week": 4,
            "tdee_multiplier": 1.55,
            "workout_types": ["strength_training", "walking"],
        },
        "dietary": {
            "diet_type": "standard",
            "allergies": [],
            "meals_per_day": 3,
            "regional_food_styles": ["north_indian"],
        },
        "body_type": {
            "gender": "male",
            "current_body_id": "male_avg",
            "goal_body_id": "male_athletic",
            "problem_areas": [],
        },
        "app_setup": {
            "weigh_in_reminder_enabled": True,
            "reminder_time": "7:00 AM",
            "water_intake_goal_liters": 3.0,
            "notifications": {
                "meal_logging": True,
                "coach_insights": True,
                "weekly_summary": True,
                "streak_alerts": True,
            },
            "region": "IN",
            "preferred_language": "en",
        },
        "goal_started_at": today,
    }


def _default_targets() -> dict:
    return {
        "calculated_at": datetime.now(timezone.utc).isoformat(),
        "formula_version": "v1.3",
        "bmr": {"formula_used": "katch_mcardle", "value_kcal": 1685},
        "tdee": {"activity_multiplier": 1.55, "value_kcal": 2612},
        "target_kcal": 2887,
        "macros": {
            "protein_g": 217,
            "protein_kcal": 866,
            "protein_pct": 30,
            "carbs_g": 347,
            "carbs_kcal": 1386,
            "carbs_pct": 48,
            "fat_g": 71,
            "fat_kcal": 635,
            "fat_pct": 22,
            "fiber_g": 40,
            "water_l": 3.0,
        },
        "timeline": {
            "weeks_to_goal": 18,
            "estimated_completion_date": (date.today() + timedelta(weeks=18)).isoformat(),
            "weekly_change_kg": 0.25,
            "daily_delta_kcal": 275,
            "exercise_share": 0.2,
            "diet_share": 0.8,
            "exercise_delta_kcal": 55,
            "diet_delta_kcal": 220,
            "pace_label": "moderate",
        },
        "safety": {
            "floor_kcal": 1854,
            "is_safe": True,
            "was_clamped": False,
            "warning": None,
        },
        "coach_message": "Production test account — full Elite access for QA.",
    }


def _sync_profile_from_onboarding(user: User, onboarding: dict) -> None:
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}

    user.name = str(personal.get("name") or user.name)[:120]
    if personal.get("age") is not None:
        user.age = int(personal["age"])
    if personal.get("weight_kg") is not None:
        user.weight = float(personal["weight_kg"])

    goal_labels = {
        "fat_loss": "Fat Loss",
        "muscle_gain": "Muscle Gain",
        "strength": "Strength",
        "recomp": "Recomp",
        "maintain": "Maintain",
    }
    goal_type = goal.get("type")
    if isinstance(goal_type, str) and goal_type in goal_labels:
        user.goal_tag = goal_labels[goal_type]
        user.goals = user.goal_tag

    difficulty = goal.get("difficulty")
    if isinstance(difficulty, str) and difficulty.strip():
        user.difficulty = difficulty.strip().capitalize()

    level = (activity.get("level") or "").strip().lower()
    if level in {"very_active", "extremely_active"}:
        user.difficulty = "Advanced"
    elif level == "moderately_active":
        user.difficulty = "Intermediate"

    lang = app_setup.get("preferred_language")
    if isinstance(lang, str) and lang.strip():
        user.preferred_language = lang.strip()[:32]


def _grant_elite(db, user: User, *, years: int = 10) -> Subscription:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=365 * years)

    for sub in (
        db.query(Subscription)
        .filter(
            Subscription.user_id == user.id,
            Subscription.status.in_(["active", "trial", "cancelled"]),
        )
        .all()
    ):
        sub.status = "cancelled"
        sub.cancelled_at = now
        sub.expires_at = now

    sub = Subscription(
        user_id=user.id,
        plan_id="elite",
        billing_cycle="yearly",
        status="active",
        price_inr=1665 * 12,
        started_at=now,
        expires_at=expires,
        trial_ends_at=None,
        cancelled_at=None,
    )
    db.add(sub)

    user.plan_id = "elite"
    user.plan_expires_at = expires
    user.subscription_status = "elite"
    user.subscription_expiry = expires
    user.trial_ends_at = None
    return sub


def provision_test_user(
    db,
    *,
    email: str,
    password: str,
    name: str,
    reset_password: bool,
) -> dict:
    email_norm = email.strip().lower()
    onboarding = _default_onboarding(name)
    targets = _default_targets()

    user = db.query(User).filter(func.lower(User.email) == email_norm).first()
    created = False
    if not user:
        user = User(
            name=name,
            email=email_norm,
            password_hash=hash_password(password),
        )
        db.add(user)
        db.flush()
        created = True
    elif reset_password:
        user.password_hash = hash_password(password)
        user.needs_password_reset = False

    _sync_profile_from_onboarding(user, onboarding)
    _grant_elite(db, user)

    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    if row:
        row.onboarding_json = onboarding
        row.targets_json = targets
    else:
        db.add(
            UserOnboarding(
                user_id=user.id,
                onboarding_json=onboarding,
                targets_json=targets,
            )
        )

    db.commit()
    db.refresh(user)

    return {
        "created": created,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "plan_id": user.plan_id,
        "subscription_expiry": user.subscription_expiry.isoformat() if user.subscription_expiry else None,
        "onboarding_seeded": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision a full-access production test user.")
    parser.add_argument("--email", default="nexrep.prod.test@gmail.com")
    parser.add_argument("--password", default="NexRep@Test2026!")
    parser.add_argument("--name", default="NexRep Tester")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Update password hash when the user already exists.",
    )
    args = parser.parse_args()

    if len(args.password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        result = provision_test_user(
            db,
            email=args.email,
            password=args.password,
            name=args.name,
            reset_password=args.reset_password,
        )
        print(json.dumps(result, indent=2))
        print(
            "\nNext step: open the NexRep app → Sign up with this email and password.\n"
            "Firebase will be created; if Postgres already has this email, login continues automatically.\n"
            "Elite + onboarding are already on the server — no paywall, planners and AI should work."
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
