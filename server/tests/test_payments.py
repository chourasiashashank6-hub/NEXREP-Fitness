"""Tests for Razorpay payment amount validation and subscription idempotency."""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.models.admin_models import Subscription
from src.models.models import User
from src.routes.payments import RazorpayOrderRequest, create_razorpay_order
from src.routes.subscriptions import ReactivateSubscriptionBody, reactivate_subscription
from src.services.subscription_service import (
    activate_subscription,
    build_razorpay_receipt,
    downgrade_expired_users,
    get_plan_amount_inr,
    mark_subscription_past_due,
)


def test_get_plan_amount_inr_known_plans():
    assert get_plan_amount_inr("pro", "monthly") == 999
    assert get_plan_amount_inr("pro", "yearly") == 832 * 12
    assert get_plan_amount_inr("elite", "monthly") == 1999
    assert get_plan_amount_inr("elite", "yearly") == 1665 * 12


def test_get_plan_amount_inr_unknown_raises():
    with pytest.raises(ValueError):
        get_plan_amount_inr("gold", "monthly")


def test_create_order_rejects_tampered_amount():
    user = User(id=1, plan_id="free", email="u@test", password_hash="x", name="U")
    body = RazorpayOrderRequest(plan_id="pro", billing_cycle="monthly", amount_inr=1)
    with patch("src.routes.payments._razorpay_auth", return_value=("key", "secret")):
        with pytest.raises(HTTPException) as exc:
            create_razorpay_order(body=body, current_user=user)
    assert exc.value.status_code == 400
    assert "Amount does not match" in str(exc.value.detail)


@pytest.mark.parametrize(
    ("plan_id", "billing_cycle", "amount_inr"),
    [
        ("pro", "monthly", 999),
        ("pro", "yearly", 832 * 12),
        ("elite", "monthly", 1999),
        ("elite", "yearly", 1665 * 12),
    ],
)
def test_create_order_accepts_correct_amounts(plan_id, billing_cycle, amount_inr):
    user = User(id=2, plan_id="free", email="u2@test", password_hash="x", name="U2")
    body = RazorpayOrderRequest(plan_id=plan_id, billing_cycle=billing_cycle, amount_inr=amount_inr)
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "order_test123", "currency": "INR"}
    mock_resp.raise_for_status = MagicMock()
    with patch("src.routes.payments._razorpay_auth", return_value=("rzp_test", "secret")), patch(
        "src.routes.payments.requests.post",
        return_value=mock_resp,
    ) as post_mock:
        result = create_razorpay_order(body=body, current_user=user)
    assert result["order_id"] == "order_test123"
    assert result["amount"] == amount_inr * 100
    sent_payload = post_mock.call_args.kwargs["json"]
    assert sent_payload["amount"] == amount_inr * 100


def test_build_razorpay_receipt_is_unique_per_call():
    r1 = build_razorpay_receipt(1, "pro", "monthly")
    r2 = build_razorpay_receipt(1, "pro", "monthly")
    assert r1 != r2
    assert r1.startswith("nexrep_1_pro_monthly_")


def test_downgrade_expired_users_only_past_expiry():
    db = MagicMock()
    expired_user = User(
        id=10,
        plan_id="pro",
        email="exp@test",
        password_hash="x",
        name="Exp",
        plan_expires_at=datetime.utcnow() - timedelta(days=1),
    )
    active_user = User(
        id=11,
        plan_id="pro",
        email="act@test",
        password_hash="x",
        name="Act",
        plan_expires_at=datetime.utcnow() + timedelta(days=10),
    )
    db.query.return_value.filter.return_value.all.return_value = [expired_user, active_user]
    sub_query = MagicMock()
    sub_query.filter.return_value.all.return_value = []
    db.query.side_effect = lambda model: (
        MagicMock(filter=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[expired_user, active_user]))))
        if model is User
        else sub_query
    )

    count = downgrade_expired_users(db)

    assert count == 1
    assert expired_user.plan_id == "free"
    assert active_user.plan_id == "pro"


def test_downgrade_expired_users_downgrades_past_due_after_grace():
    """past_due users whose grace deadline has passed are downgraded to free."""
    db = MagicMock()
    past_due_user = User(
        id=21,
        plan_id="pro",
        email="grace@test",
        password_hash="x",
        name="Grace",
        subscription_status="past_due",
        plan_expires_at=datetime.utcnow() - timedelta(hours=1),
        subscription_expiry=datetime.utcnow() - timedelta(hours=1),
    )
    past_due_sub = Subscription(
        id=2,
        user_id=21,
        plan_id="pro",
        billing_cycle="monthly",
        status="past_due",
        price_inr=999,
        started_at=datetime.utcnow() - timedelta(days=30),
        expires_at=datetime.utcnow() - timedelta(hours=1),
    )
    user_query = MagicMock()
    user_query.filter.return_value.all.return_value = [past_due_user]
    sub_query = MagicMock()
    sub_query.filter.return_value.all.return_value = [past_due_sub]
    db.query.side_effect = lambda model: user_query if model is User else sub_query

    count = downgrade_expired_users(db)

    assert count == 1
    assert past_due_user.plan_id == "free"
    assert past_due_user.subscription_status == "free"
    assert past_due_sub.status == "expired"


def test_downgrade_expired_users_is_idempotent():
    db = MagicMock()
    free_user = User(
        id=12,
        plan_id="free",
        email="free@test",
        password_hash="x",
        name="Free",
        plan_expires_at=datetime.utcnow() - timedelta(days=1),
    )
    db.query.return_value.filter.return_value.all.return_value = [free_user]
    sub_query = MagicMock()
    sub_query.filter.return_value.all.return_value = []
    db.query.side_effect = lambda model: (
        MagicMock(filter=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[free_user]))))
        if model is User
        else sub_query
    )

    assert downgrade_expired_users(db) == 0
    db.commit.assert_not_called()


def test_mark_subscription_past_due_keeps_plan_during_grace():
    db = MagicMock()
    future_expiry = datetime.utcnow() + timedelta(days=20)
    user = User(id=20, plan_id="pro", email="pd@test", password_hash="x", name="PD")
    sub = Subscription(
        id=1,
        user_id=20,
        plan_id="pro",
        billing_cycle="monthly",
        status="active",
        price_inr=999,
        started_at=datetime.utcnow(),
        expires_at=future_expiry,
    )
    user_query = MagicMock()
    user_query.filter.return_value.first.return_value = user
    sub_query = MagicMock()
    sub_query.filter.return_value.order_by.return_value.first.return_value = sub
    db.query.side_effect = lambda model: user_query if model is User else sub_query

    result = mark_subscription_past_due(db, 20)

    assert result is sub
    assert sub.status == "past_due"
    assert user.subscription_status == "past_due"
    assert user.plan_id == "pro"
    assert sub.expires_at == future_expiry
    assert user.plan_expires_at == future_expiry
    db.commit.assert_called()


def test_mark_subscription_past_due_preserves_mid_cycle_paid_time():
    """Mid-cycle payment.failed keeps remaining paid time instead of truncating to 3 days."""
    db = MagicMock()
    now = datetime.utcnow()
    paid_through = now + timedelta(days=10)
    user = User(
        id=22,
        plan_id="pro",
        email="mid@test",
        password_hash="x",
        name="Mid",
        plan_expires_at=paid_through,
        subscription_expiry=paid_through,
    )
    sub = Subscription(
        id=3,
        user_id=22,
        plan_id="pro",
        billing_cycle="monthly",
        status="active",
        price_inr=999,
        started_at=now - timedelta(days=20),
        expires_at=paid_through,
    )
    user_query = MagicMock()
    user_query.filter.return_value.first.return_value = user
    sub_query = MagicMock()
    sub_query.filter.return_value.order_by.return_value.first.return_value = sub
    db.query.side_effect = lambda model: user_query if model is User else sub_query

    mark_subscription_past_due(db, 22)

    grace_floor = now + timedelta(days=3)
    assert user.plan_expires_at == paid_through
    assert user.plan_expires_at > grace_floor
    assert sub.expires_at == paid_through
    assert (user.plan_expires_at - now).days >= 9


def test_reactivate_creates_chargeable_razorpay_order():
    """Reactivate hits Razorpay with a valid order payload (amount, currency, receipt, notes)."""
    user = User(id=30, plan_id="free", email="re@test", password_hash="x", name="Re")
    body = ReactivateSubscriptionBody(userId="30", planTier="PRO", billingCycle="monthly")
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "order_reactivate_live", "currency": "INR"}
    mock_resp.raise_for_status = MagicMock()
    with patch("src.routes.payments._razorpay_auth", return_value=("rzp_test", "secret")), patch(
        "src.routes.payments.requests.post",
        return_value=mock_resp,
    ) as post_mock:
        result = reactivate_subscription(body=body, db=MagicMock(), current_user=user)

    assert result["status"] == "checkout"
    assert result["order_id"] == "order_reactivate_live"
    assert result["amount"] == 999 * 100
    assert result["amount_inr"] == 999
    assert result["key_id"] == "rzp_test"
    assert result["currency"] == "INR"

    post_mock.assert_called_once()
    call_kwargs = post_mock.call_args.kwargs
    assert call_kwargs["json"]["amount"] == 999 * 100
    assert call_kwargs["json"]["currency"] == "INR"
    assert call_kwargs["json"]["receipt"].startswith("nexrep_30_pro_monthly_")
    assert call_kwargs["json"]["notes"] == {
        "user_id": "30",
        "plan_id": "pro",
        "billing_cycle": "monthly",
        "payment_method": "razorpay",
    }
    assert post_mock.call_args.args[0] == "https://api.razorpay.com/v1/orders"


def test_activate_subscription_is_idempotent_on_payment_id():
    db = MagicMock()
    existing_sub = Subscription(
        id=10,
        user_id=5,
        plan_id="pro",
        billing_cycle="monthly",
        status="active",
        price_inr=999,
        started_at=datetime.utcnow(),
        razorpay_payment_id="pay_duplicate123",
    )
    query_chain = MagicMock()
    query_chain.filter.return_value.order_by.return_value.first.return_value = existing_sub
    db.query.return_value = query_chain

    result = activate_subscription(
        db=db,
        user_id=5,
        plan_id="elite",
        billing_cycle="monthly",
        razorpay_payment_id="pay_duplicate123",
    )

    assert result is existing_sub
    db.add.assert_not_called()
    db.commit.assert_not_called()
