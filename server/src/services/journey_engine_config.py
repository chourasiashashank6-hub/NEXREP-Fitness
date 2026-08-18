"""Feature flag for the Coach Journey Engine (default off)."""

from __future__ import annotations

from src.core.config import settings


def journey_engine_enabled() -> bool:
    raw = getattr(settings, "JOURNEY_ENGINE_ENABLED", False)
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)


JOURNEY_DETECTION_HOUR_UTC = 3
