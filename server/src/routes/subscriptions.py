import logging
from datetime import datetime
from typing import Any, Literal, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.core.config import settings
from src.db.session import get_db
from src.models.admin_models import Subscription
from src.models.models import User
from src.routes.payments import _razorpay_auth
from src.services.subscription_service import (
    PLAN_PRICES_INR,
    activate_subscription,
    cancel_subscription,
    get_display_subscription,
)
from src.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


def _assert_user_access(current_user: User, user_id: str) -> int:
    try:
        requested = int(user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid user id") from exc
    if requested != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return requested


def _tier_from_plan(plan_id: str) -> str:
    pid = (plan_id or "free").lower()
    if pid == "elite":
        return "ELITE"
    if pid == "pro":
        return "PRO"
    return "FREE"


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.isoformat()


def _map_subscription_status(sub: Optional[Subscription], user: User) -> str:
    if user.subscription_status == "past_due":
        return "past_due"
    if not sub:
        return "active" if (user.plan_id or "free") == "free" else "expired"
    if sub.status == "trial":
        return "trial"
    if sub.status == "cancelled":
        return "cancelled"
    if sub.status == "active":
        return "active"
    return sub.status


def _subscription_payload(sub: Subscription, user: User) -> dict[str, Any]:
    billing = sub.billing_cycle if sub.billing_cycle != "trial" else "monthly"
    period_end = sub.expires_at or sub.trial_ends_at
    period_start = sub.started_at
    price = int(float(sub.price_inr or 0))
    if not price and sub.plan_id in ("pro", "elite"):
        price = PLAN_PRICES_INR.get((sub.plan_id, billing), 0)

    return {
        "id": str(sub.id),
        "userId": str(user.id),
        "tier": _tier_from_plan(sub.plan_id),
        "status": _map_subscription_status(sub, user),
        "billingCycle": billing,
        "priceINR": price,
        "startDate": _iso(sub.started_at),
        "currentPeriodStart": _iso(period_start),
        "currentPeriodEnd": _iso(period_end),
        "cancelledAt": _iso(sub.cancelled_at),
        "trialEndsAt": _iso(sub.trial_ends_at),
        "razorpaySubscriptionId": sub.razorpay_subscription_id,
        "razorpayCustomerId": None,
    }


def _free_subscription_payload(user: User) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    return {
        "id": f"free-{user.id}",
        "userId": str(user.id),
        "tier": "FREE",
        "status": "active",
        "billingCycle": "monthly",
        "priceINR": 0,
        "startDate": _iso(user.created_at) or now,
        "currentPeriodStart": _iso(user.created_at) or now,
        "currentPeriodEnd": now,
        "cancelledAt": None,
        "trialEndsAt": None,
        "razorpaySubscriptionId": None,
        "razorpayCustomerId": None,
    }


def _build_plan_history(user: User, rows: list[Subscription]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    if user.created_at:
        history.append(
            {
                "tier": "FREE",
                "startDate": _iso(user.created_at),
                "endDate": _iso(rows[0].started_at) if rows else None,
                "reason": "initial",
            }
        )
    for i, sub in enumerate(rows):
        tier = _tier_from_plan(sub.plan_id)
        prev = rows[i - 1] if i > 0 else None
        if sub.status == "cancelled":
            reason = "cancelled"
        elif sub.billing_cycle == "trial":
            reason = "upgrade" if prev else "initial"
        elif prev and prev.plan_id != sub.plan_id:
            reason = "upgrade" if _plan_rank(sub.plan_id) > _plan_rank(prev.plan_id) else "downgrade"
        elif prev:
            reason = "renewal"
        else:
            reason = "initial"
        history.append(
            {
                "tier": tier,
                "startDate": _iso(sub.started_at),
                "endDate": _iso(sub.expires_at) if sub.status in ("cancelled", "expired") else None,
                "reason": reason,
            }
        )
    if history:
        history[-1]["endDate"] = None
    return history


def _plan_rank(plan_id: str) -> int:
    return {"free": 0, "pro": 1, "elite": 2}.get((plan_id or "free").lower(), 0)


def _payment_records_for_user(rows: list[Subscription]) -> list[dict[str, Any]]:
    payments: list[dict[str, Any]] = []
    for sub in rows:
        if sub.billing_cycle == "trial":
            continue
        amount = int(float(sub.price_inr or 0))
        if amount <= 0:
            continue
        started = sub.started_at or datetime.utcnow()
        month_label = started.strftime("%b %Y")
        tier = _tier_from_plan(sub.plan_id)
        status = "paid"
        if sub.status == "cancelled" and sub.cancelled_at and sub.started_at == sub.cancelled_at:
            status = "refunded"
        payments.append(
            {
                "id": f"pay-{sub.id}",
                "userId": str(sub.user_id),
                "subscriptionId": str(sub.id),
                "amount": amount,
                "currency": "INR",
                "status": status,
                "description": f"{tier} Plan – {month_label}",
                "date": _iso(started),
                "invoiceUrl": (
                    f"https://dashboard.razorpay.com/app/payments/{sub.razorpay_payment_id}"
                    if sub.razorpay_payment_id and not str(sub.razorpay_payment_id).startswith("dev_")
                    else None
                ),
                "razorpayPaymentId": sub.razorpay_payment_id,
            }
        )
    payments.sort(key=lambda p: p.get("date") or "", reverse=True)
    return payments


@router.get("/{user_id}/payments")
def get_payments(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid = _assert_user_access(current_user, user_id)
    rows = (
        db.query(Subscription)
        .filter(Subscription.user_id == uid, Subscription.billing_cycle != "trial")
        .order_by(Subscription.created_at.desc())
        .all()
    )
    return {"payments": _payment_records_for_user(rows)}


@router.get("/{user_id}")
def get_subscription(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid = _assert_user_access(current_user, user_id)
    if (current_user.plan_id or "free").lower() == "free":
        all_rows = (
            db.query(Subscription)
            .filter(Subscription.user_id == uid)
            .order_by(Subscription.created_at.asc())
            .all()
        )
        return {
            "subscription": _free_subscription_payload(current_user),
            "planHistory": _build_plan_history(current_user, all_rows),
        }
    sub = get_display_subscription(db, uid)
    all_rows = (
        db.query(Subscription)
        .filter(Subscription.user_id == uid)
        .order_by(Subscription.created_at.asc())
        .all()
    )
    plan_history = _build_plan_history(current_user, all_rows)

    if not sub or (sub.plan_id or "free").lower() == "free":
        tier = _tier_from_plan(current_user.plan_id or "free")
        if tier == "FREE":
            return {"subscription": _free_subscription_payload(current_user), "planHistory": plan_history}
    return {
        "subscription": _subscription_payload(sub, current_user),
        "planHistory": plan_history,
    }


class CancelSubscriptionBody(BaseModel):
    userId: str
    subscriptionId: str
    reason: Optional[str] = None


class ReactivateSubscriptionBody(BaseModel):
    userId: str
    planTier: Literal["PRO", "ELITE"] = "PRO"
    billingCycle: Literal["monthly", "yearly"] = "monthly"


@router.post("/cancel")
def cancel_user_subscription(
    body: CancelSubscriptionBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _assert_user_access(current_user, body.userId)
    sub = get_display_subscription(db, current_user.id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")

    razorpay_sub_id = sub.razorpay_subscription_id
    if razorpay_sub_id:
        try:
            key_id, key_secret = _razorpay_auth()
            resp = requests.post(
                f"https://api.razorpay.com/v1/subscriptions/{razorpay_sub_id}/cancel",
                json={"cancel_at_cycle_end": 1},
                auth=(key_id, key_secret),
                timeout=30,
            )
            if resp.status_code >= 400:
                logger.warning("Razorpay cancel failed: %s %s", resp.status_code, resp.text)
        except Exception as exc:
            logger.exception("Razorpay cancel error: %s", exc)

    cancelled = cancel_subscription(db, current_user.id)
    if not cancelled:
        raise HTTPException(status_code=400, detail="Could not cancel subscription")

    db.refresh(current_user)
    return {
        "subscription": _subscription_payload(cancelled, current_user),
        "message": "Subscription cancelled. Access continues until period end.",
    }


@router.post("/reactivate")
def reactivate_subscription(
    body: ReactivateSubscriptionBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _assert_user_access(current_user, body.userId)
    plan_id = body.planTier.lower()
    if plan_id not in ("pro", "elite"):
        plan_id = "pro"
    return {
        "status": "redirect",
        "plan_id": plan_id,
        "billing_cycle": body.billingCycle,
        "message": "Complete checkout on the pricing screen to reactivate.",
    }


invoices_router = APIRouter(prefix="/api/invoices", tags=["invoices"])


@invoices_router.get("/export/{user_id}")
def export_invoices(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid = _assert_user_access(current_user, user_id)
    rows = (
        db.query(Subscription)
        .filter(Subscription.user_id == uid, Subscription.razorpay_payment_id.isnot(None))
        .order_by(Subscription.created_at.desc())
        .all()
    )
    invoices = []
    for sub in rows:
        pid = sub.razorpay_payment_id
        if not pid or str(pid).startswith("dev_"):
            continue
        invoices.append(
            {
                "paymentId": pid,
                "date": _iso(sub.started_at),
                "amount": int(float(sub.price_inr or 0)),
                "url": f"https://dashboard.razorpay.com/app/payments/{pid}",
            }
        )
    return {"invoices": invoices, "count": len(invoices)}
