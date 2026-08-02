from __future__ import annotations

from fastapi import HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from src.core.config import settings


def email_from_firebase_id_token(raw_token: str) -> str:
    """Verify a Firebase ID token (JWT) and return the user's email."""
    token = raw_token.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Firebase token")

    project_id = (settings.FIREBASE_PROJECT_ID or "").strip()
    if not project_id:
        raise HTTPException(
            status_code=500,
            detail="Server missing FIREBASE_PROJECT_ID (set to your Firebase project id, e.g. repwise-8338b)",
        )

    # Allow small clock drift between this machine and Google/Firebase (avoids "Token used too early").
    clock_skew = max(0, int(getattr(settings, "FIREBASE_TOKEN_CLOCK_SKEW_SECONDS", 60)))

    try:
        claims = google_id_token.verify_firebase_token(
            token,
            google_requests.Request(),
            audience=project_id,
            clock_skew_in_seconds=clock_skew,
        )
    except ValueError as exc:
        msg = str(exc)
        if "used too early" in msg.lower() or "clock" in msg.lower():
            raise HTTPException(
                status_code=401,
                detail="Login token timing mismatch. Set your Mac date/time to automatic, wait a few seconds, and try again.",
            ) from None
        raise HTTPException(status_code=401, detail=f"Invalid or expired Firebase token: {exc}") from None
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot verify Firebase login ({exc}). Ensure this machine can reach googleapis.com.",
        ) from None

    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Firebase account has no email")
    return str(email).strip().lower()
