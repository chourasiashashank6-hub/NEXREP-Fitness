"""Tests for Razorpay payment amount validation and subscription idempotency."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.models.admin_models import Subscription
from src.models.models import User
from src.routes.payments import RazorpayOrderRequest, create_razorpay_order
from src.services.subscription_service import activate_subscription, get_plan_amount_inr


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
