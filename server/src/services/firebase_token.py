import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException

from src.core.config import settings


def email_from_firebase_id_token(id_token: str) -> str:
    """Resolve email from a Firebase ID token using the Identity Toolkit REST API."""
    api_key = settings.FIREBASE_WEB_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server missing FIREBASE_WEB_API_KEY (same value as Expo EXPO_PUBLIC_FIREBASE_API_KEY)",
        )
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={api_key}"
    payload = json.dumps({"idToken": id_token}).encode("utf-8")
    req = Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
    except (HTTPError, URLError):
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token") from None
    users = body.get("users") or []
    if not users:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token")
    email = users[0].get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token")
    return str(email).strip().lower()
