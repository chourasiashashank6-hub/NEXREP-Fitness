from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from src.db.session import get_db

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/razorpay/webhook")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Razorpay webhook endpoint.
    Currently a stub — returns 200 immediately.

    TO ACTIVATE (when Razorpay bank account is ready):
    1. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server .env
    2. Add RAZORPAY_WEBHOOK_SECRET to server .env
    3. Uncomment the signature verification block below
    4. Uncomment the subscription activation call below
    5. Configure this URL in Razorpay dashboard:
       https://yourdomain.com/api/payments/razorpay/webhook
    """
    _ = (request, x_razorpay_signature, db)
    return {"status": "ok"}
