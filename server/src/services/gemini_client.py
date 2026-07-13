import logging
from typing import Any
from urllib.parse import urlencode

from src.core.config import settings
from src.core.http_client import ExternalHTTPError, post_json

logger = logging.getLogger(__name__)


def gemini_api_keys() -> list[str]:
    keys: list[str] = []
    for key in (settings.GEMINI_API_KEY, settings.GEMINI_API_KEY_FALLBACK):
        k = (key or "").strip()
        if k and k not in keys:
            keys.append(k)
    return keys


def has_gemini_key() -> bool:
    return bool(gemini_api_keys())


def is_gemini_quota_error(exc: BaseException) -> bool:
    if isinstance(exc, ExternalHTTPError):
        if exc.status_code == 429:
            return True
        body = (exc.body or "").lower()
        return "quota" in body or "rate limit" in body or "resource_exhausted" in body
    msg = str(exc).lower()
    return "429" in msg or "quota" in msg or "rate limit" in msg or "resource_exhausted" in msg


def gemini_generate_content(
    model_name: str,
    payload: dict[str, Any],
    *,
    timeout: int = 30,
) -> tuple[dict[str, Any], bool]:
    keys = gemini_api_keys()
    if not keys:
        raise RuntimeError("GEMINI_API_KEY missing on server")

    last_err: Exception | None = None
    for idx, api_key in enumerate(keys):
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
            return result, idx > 0
        except ExternalHTTPError as exc:
            last_err = exc
            if is_gemini_quota_error(exc) and idx < len(keys) - 1:
                logger.warning("[Gemini] Primary key quota/rate limited, retrying with fallback Gemini key")
                continue
            raise

    if last_err:
        raise last_err
    raise RuntimeError("Gemini request failed")


def gemini_generate_content_models(
    model_candidates: list[str],
    payload: dict[str, Any],
    *,
    timeout: int = 30,
) -> tuple[dict[str, Any], str, bool]:
    keys = gemini_api_keys()
    if not keys:
        raise RuntimeError("GEMINI_API_KEY missing on server")

    last_err: str | None = None
    for model_name in model_candidates:
        for key_idx, api_key in enumerate(keys):
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
                return result, model_name, key_idx > 0
            except ExternalHTTPError as exc:
                if exc.status_code == 404 and (
                    "not found" in exc.body.lower() or "not supported" in exc.body.lower()
                ):
                    last_err = f"{model_name}: not available"
                    break
                if is_gemini_quota_error(exc) and key_idx < len(keys) - 1:
                    logger.warning("[Gemini] Primary key quota/rate limited, retrying with fallback Gemini key")
                    continue
                raise RuntimeError(f"Gemini HTTP {exc.status_code}: {exc.body[:260]}") from exc

    raise RuntimeError(f"No compatible Gemini model available. Last tried: {last_err or 'unknown'}")
