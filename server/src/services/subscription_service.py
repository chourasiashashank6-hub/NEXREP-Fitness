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


def is_pro(db: Session, user_id: int) -> bool:
    """Server-side pro check — never trust client subscription flags."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    status = (user.subscription_status or "free").lower()
    plan = (user.plan_id or "free").lower()
    if status not in ("pro", "elite") and plan not in ("pro", "elite"):
        return False
    expiry = user.subscription_expiry or user.plan_expires_at
    if expiry and expiry.replace(tzinfo=None) < datetime.utcnow():
        return False
    return True


def _sync_user_subscription_fields(
    user: User,
    *,
    plan_id: str,
    status: str,
    expires_at: Optional[datetime],
    razorpay_subscription_id: Optional[str] = None,
) -> None:
    user.plan_id = plan_id
    user.plan_expires_at = expires_at
    user.subscription_status = status
    user.subscription_expiry = expires_at
    if razorpay_subscription_id is not None:
        user.razorpay_subscription_id = razorpay_subscription_id


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


def get_display_subscription(db: Session, user_id: int) -> Optional[Subscription]:
    """Active, trial, or cancelled but still within paid access period."""
    now = datetime.utcnow()
    rows = (
        db.query(Subscription)
        .filter(Subscription.user_id == user_id)
        .order_by(Subscription.created_at.desc())
        .all()
    )
    for sub in rows:
        if sub.status in ("active", "trial"):
            return sub
        if sub.status == "cancelled" and sub.expires_at:
            expires = sub.expires_at.replace(tzinfo=None) if sub.expires_at.tzinfo else sub.expires_at
            if expires > now:
                return sub
    return None


def start_trial(db: Session, user_id: int, plan_id: str = "pro") -> Subscription:
    now = datetime.utcnow()
    expires = now + timedelta(days=TRIAL_DAYS)
    sub = Subscription(
        user_id=user_id,
        plan_id=plan_id,
        billing_cycle="trial",
        status="trial",
        price_inr=0,
        started_at=now,
        trial_ends_at=expires,
        expires_at=expires,
    )
    db.add(sub)
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.trial_ends_at = sub.trial_ends_at
        _sync_user_subscription_fields(user, plan_id=plan_id, status="pro", expires_at=expires)
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
        user.trial_ends_at = None
        _sync_user_subscription_fields(
            user,
            plan_id=plan_id,
            status=plan_id if plan_id in ("pro", "elite") else "pro",
            expires_at=expires,
            razorpay_subscription_id=razorpay_subscription_id,
        )
    db.commit()
    db.refresh(sub)
    return sub


def revoke_subscription_immediately(db: Session, user_id: int) -> None:
    """Drop paid access now (dev/admin tooling)."""
    now = datetime.utcnow()
    rows = (
        db.query(Subscription)
        .filter(
            Subscription.user_id == user_id,
            Subscription.status.in_(["active", "trial", "cancelled"]),
        )
        .all()
    )
    for sub in rows:
        sub.status = "cancelled"
        sub.cancelled_at = now
        sub.expires_at = now
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        _sync_user_subscription_fields(user, plan_id="free", status="free", expires_at=None)
        user.razorpay_subscription_id = None
    db.commit()


def cancel_subscription(db: Session, user_id: int) -> Optional[Subscription]:
    """Cancel at period end — user keeps plan access until expires_at."""
    sub = get_active_subscription(db, user_id)
    if not sub:
        sub = get_display_subscription(db, user_id)
    if sub and sub.status in ("active", "trial"):
        sub.status = "cancelled"
        sub.cancelled_at = datetime.utcnow()
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        expires = sub.expires_at if sub else None
        _sync_user_subscription_fields(
            user,
            plan_id=(sub.plan_id if sub else user.plan_id) or "free",
            status="cancelled",
            expires_at=expires,
        )
    db.commit()
    if sub:
        db.refresh(sub)
    return sub
