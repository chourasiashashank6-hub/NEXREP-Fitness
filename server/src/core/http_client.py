"""HTTPS helpers for external AI APIs (Groq, Gemini).

Uses requests + certifi so Groq/Gemini calls work on macOS/Python installs
where urllib's default SSL context lacks the system CA bundle.
"""

from __future__ import annotations

from typing import Any

import certifi
import requests


class ExternalHTTPError(RuntimeError):
    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"HTTP {status_code}: {body[:260]}")


def post_json(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: int = 30,
) -> dict[str, Any]:
    try:
        resp = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=timeout,
            verify=certifi.where(),
        )
    except requests.exceptions.SSLError as e:
        raise RuntimeError(f"SSL error: {e}") from e
    except requests.exceptions.Timeout as e:
        raise RuntimeError(f"Request timed out after {timeout}s") from e
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Network error: {e}") from e

    if resp.status_code >= 400:
        raise ExternalHTTPError(resp.status_code, resp.text)

    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("Expected JSON object response")
    return data
