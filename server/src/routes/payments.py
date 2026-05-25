# NOTE: Apple and Google require their own IAP for digital subscriptions
# sold through App Store / Play Store. Research RevenueCat if needed.

import hashlib
import hmac
import json
import logging
from typing import Any, Literal, Optional

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.core.config import settings, warn_missing_razorpay_webhook_secret
from src.db.session import get_db
from src.models.admin_models import Subscription
from src.models.models import User
from src.services.subscription_service import activate_subscription, cancel_subscription
from src.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments", tags=["payments"])

warn_missing_razorpay_webhook_secret()


class RazorpayOrderRequest(BaseModel):
    plan_id: Literal["pro", "elite"]
    billing_cycle: Literal["monthly", "yearly"]
    amount_inr: int = Field(ge=1, le=500_000)
    payment_method: str = "razorpay"


class RazorpayVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    plan_id: Literal["pro", "elite"]
    billing_cycle: Literal["monthly", "yearly"]


def _razorpay_auth() -> tuple[str, str]:
    key_id = (settings.RAZORPAY_KEY_ID or "").strip()
    key_secret = (settings.RAZORPAY_KEY_SECRET or "").strip()
    if not key_id or not key_secret:
        raise HTTPException(status_code=503, detail="Razorpay is not configured on the server")
    return key_id, key_secret


def verify_razorpay_signature(payload_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _user_id_from_payload(payload: dict[str, Any]) -> Optional[int]:
    for key in ("payment", "subscription", "order"):
        entity = payload.get(key, {}).get("entity", {})
        notes = entity.get("notes") or {}
        if isinstance(notes, dict):
            for note_key in ("user_id", "userId", "fitness_user_id"):
                raw = notes.get(note_key)
                if raw is not None:
                    try:
                        return int(raw)
                    except (TypeError, ValueError):
                        pass
    return None


def _resolve_user(db: Session, payload: dict[str, Any], event: str) -> Optional[User]:
    user_id = _user_id_from_payload(payload)
    if user_id:
        return db.query(User).filter(User.id == user_id).first()

    razorpay_sub_id = None
    sub_entity = payload.get("subscription", {}).get("entity", {})
    if sub_entity:
        razorpay_sub_id = sub_entity.get("id")
    if razorpay_sub_id:
        row = (
            db.query(Subscription)
            .filter(Subscription.razorpay_subscription_id == razorpay_sub_id)
            .order_by(Subscription.created_at.desc())
            .first()
        )
        if row:
            return db.query(User).filter(User.id == row.user_id).first()
        user = db.query(User).filter(User.razorpay_subscription_id == razorpay_sub_id).first()
        if user:
            return user
    return None


def _plan_from_payload(payload: dict[str, Any]) -> tuple[str, str]:
    notes = {}
    for key in ("payment", "subscription", "order"):
        entity = payload.get(key, {}).get("entity", {})
        if entity.get("notes"):
            notes = entity["notes"]
            break
    plan_id = str(notes.get("plan_id") or notes.get("planId") or "pro").lower()
    billing_cycle = str(notes.get("billing_cycle") or notes.get("billingCycle") or "monthly").lower()
    if plan_id not in ("pro", "elite"):
        plan_id = "pro"
    if billing_cycle not in ("monthly", "yearly"):
        billing_cycle = "monthly"
    return plan_id, billing_cycle


@router.post("/razorpay/order")
def create_razorpay_order(
    body: RazorpayOrderRequest,
    current_user: User = Depends(get_current_user),
):
    key_id, key_secret = _razorpay_auth()
    amount_paise = int(body.amount_inr) * 100
    payload = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": f"nexrep_{current_user.id}_{body.plan_id}_{body.billing_cycle}",
        "notes": {
            "user_id": str(current_user.id),
            "plan_id": body.plan_id,
            "billing_cycle": body.billing_cycle,
            "payment_method": body.payment_method,
        },
    }
    try:
        resp = requests.post(
            "https://api.razorpay.com/v1/orders",
            json=payload,
            auth=(key_id, key_secret),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.exception("Razorpay order creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not create payment order") from exc

    return {
        "key_id": key_id,
        "order_id": data["id"],
        "amount": amount_paise,
        "currency": data.get("currency", "INR"),
    }


@router.post("/razorpay/verify")
def verify_razorpay_payment(
    body: RazorpayVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, key_secret = _razorpay_auth()
    message = f"{body.razorpay_order_id}|{body.razorpay_payment_id}"
    expected = hmac.new(key_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    sub = activate_subscription(
        db=db,
        user_id=current_user.id,
        plan_id=body.plan_id,
        billing_cycle=body.billing_cycle,
        razorpay_order_id=body.razorpay_order_id,
        razorpay_payment_id=body.razorpay_payment_id,
        razorpay_signature=body.razorpay_signature,
    )
    return {
        "status": "active",
        "plan_id": sub.plan_id,
        "billing_cycle": sub.billing_cycle,
        "payment_id": body.razorpay_payment_id,
    }


@router.post("/dev/activate-plan")
def dev_activate_plan(
    body: RazorpayOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if (settings.APP_ENV or "").lower() != "development":
        raise HTTPException(status_code=403, detail="Not available")
    sub = activate_subscription(
        db=db,
        user_id=current_user.id,
        plan_id=body.plan_id,
        billing_cycle=body.billing_cycle,
        razorpay_payment_id=f"dev_{current_user.id}",
    )
    return {"status": "active", "plan_id": sub.plan_id, "payment_id": f"dev_{current_user.id}"}


@router.post("/razorpay/webhook")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(None, alias="X-Razorpay-Signature"),
    db: Session = Depends(get_db),
):
    raw_body = await request.body()
    secret = (settings.RAZORPAY_WEBHOOK_SECRET or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    if not x_razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing signature")
    if not verify_razorpay_signature(raw_body, x_razorpay_signature, secret):
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    event = str(body.get("event") or "")
    payload = body.get("payload") or {}
    user = _resolve_user(db, payload, event)
    if not user:
        logger.warning("Razorpay webhook %s: could not resolve user", event)
        return {"status": "ignored", "reason": "user_not_found"}

    plan_id, billing_cycle = _plan_from_payload(payload)
    razorpay_sub_id = payload.get("subscription", {}).get("entity", {}).get("id")
    razorpay_payment_id = payload.get("payment", {}).get("entity", {}).get("id")
    razorpay_order_id = payload.get("order", {}).get("entity", {}).get("id")

    if event in ("payment.captured", "subscription.activated", "subscription.charged"):
        activate_subscription(
            db=db,
            user_id=user.id,
            plan_id=plan_id,
            billing_cycle=billing_cycle,
            razorpay_subscription_id=razorpay_sub_id,
            razorpay_order_id=razorpay_order_id,
            razorpay_payment_id=razorpay_payment_id,
        )
    elif event in ("subscription.cancelled", "payment.failed"):
        cancel_subscription(db, user.id)
    else:
        logger.info("Razorpay webhook event not handled: %s", event)

    return {"status": "ok"}
