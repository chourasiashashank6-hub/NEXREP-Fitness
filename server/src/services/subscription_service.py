from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from src.models.admin_models import Subscription
from src.models.models import User

PLAN_PRICES_INR = {
    ("pro", "monthly"): 999,
    ("pro", "yearly"): 832 * 12,
    ("elite", "monthly"): 1999,
    ("elite", "yearly"): 1665 * 12,
    ("free", "trial"): 0,
}

TRIAL_DAYS = 7


def get_active_subscription(db: Session, user_id: int) -> Optional[Subscription]:
    return (
        db.query(Subscription)
        .filter(
            Subscription.user_id == user_id,
            Subscription.status.in_(["active", "trial"]),
        )
        .order_by(Subscription.created_at.desc())
        .first()
    )


def start_trial(db: Session, user_id: int, plan_id: str = "pro") -> Subscription:
    now = datetime.utcnow()
    sub = Subscription(
        user_id=user_id,
        plan_id=plan_id,
        billing_cycle="trial",
        status="trial",
        price_inr=0,
        started_at=now,
        trial_ends_at=now + timedelta(days=TRIAL_DAYS),
        expires_at=now + timedelta(days=TRIAL_DAYS),
    )
    db.add(sub)
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.plan_id = plan_id
        user.trial_ends_at = sub.trial_ends_at
        user.plan_expires_at = sub.expires_at
    db.commit()
    db.refresh(sub)
    return sub


def activate_subscription(
    db: Session,
    user_id: int,
    plan_id: str,
    billing_cycle: str,
    razorpay_subscription_id: Optional[str] = None,
    razorpay_order_id: Optional[str] = None,
    razorpay_payment_id: Optional[str] = None,
    razorpay_signature: Optional[str] = None,
) -> Subscription:
    now = datetime.utcnow()
    months = 12 if billing_cycle == "yearly" else 1
    expires = now + timedelta(days=30 * months)
    price = PLAN_PRICES_INR.get((plan_id, billing_cycle), 0)

    existing = (
        db.query(Subscription)
        .filter(
            Subscription.user_id == user_id,
            Subscription.status.in_(["active", "trial"]),
        )
        .all()
    )
    for entry in existing:
        entry.status = "cancelled"
        entry.cancelled_at = now

    sub = Subscription(
        user_id=user_id,
        plan_id=plan_id,
        billing_cycle=billing_cycle,
        status="active",
        price_inr=price,
        started_at=now,
        expires_at=expires,
        razorpay_subscription_id=razorpay_subscription_id,
        razorpay_order_id=razorpay_order_id,
        razorpay_payment_id=razorpay_payment_id,
        razorpay_signature=razorpay_signature,
    )
    db.add(sub)
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.plan_id = plan_id
        user.plan_expires_at = expires
        user.trial_ends_at = None
    db.commit()
    db.refresh(sub)
    return sub


def cancel_subscription(db: Session, user_id: int) -> None:
    sub = get_active_subscription(db, user_id)
    if sub:
        sub.status = "cancelled"
        sub.cancelled_at = datetime.utcnow()
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.plan_id = "free"
        user.plan_expires_at = None
    db.commit()
