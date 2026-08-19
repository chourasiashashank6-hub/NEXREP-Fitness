"""Feature flag for the tiered Coach redesign (default off)."""

from __future__ import annotations

from src.core.config import settings


def coach_redesign_enabled() -> bool:
    raw = getattr(settings, "COACH_REDESIGN_ENABLED", False)
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)
