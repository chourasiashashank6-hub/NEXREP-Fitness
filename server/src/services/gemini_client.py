import logging
from typing import Any
from urllib.parse import urlencode

from src.core.config import settings
from src.core.http_client import ExternalHTTPError, post_json

logger = logging.getLogger(__name__)


def gemini_api_key() -> str:
    return (settings.GEMINI_API_KEY or "").strip()


def has_gemini_key() -> bool:
    return bool(gemini_api_key())


def gemini_generate_content(
    model_name: str,
    payload: dict[str, Any],
    *,
    timeout: int = 30,
) -> dict[str, Any]:
    api_key = gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY missing on server")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?"
        + urlencode({"key": api_key})
    )
    return post_json(
        url,
        headers={"Content-Type": "application/json"},
        payload=payload,
        timeout=timeout,
    )


def gemini_generate_content_models(
    model_candidates: list[str],
    payload: dict[str, Any],
    *,
    timeout: int = 30,
) -> tuple[dict[str, Any], str]:
    api_key = gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY missing on server")

    last_err: str | None = None
    for model_name in model_candidates:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?"
            + urlencode({"key": api_key})
        )
        try:
            result = post_json(
                url,
                headers={"Content-Type": "application/json"},
                payload=payload,
                timeout=timeout,
            )
            return result, model_name
        except ExternalHTTPError as exc:
            body_lower = (exc.body or "").lower()
            if exc.status_code == 404 and (
                "not found" in body_lower
                or "not supported" in body_lower
                or "no longer available" in body_lower
            ):
                last_err = f"{model_name}: not available"
                continue
            raise RuntimeError(f"Gemini HTTP {exc.status_code}: {exc.body[:260]}") from exc

    raise RuntimeError(f"No compatible Gemini model available. Last tried: {last_err or 'unknown'}")
