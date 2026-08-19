"""Macro threshold parity across coach surfaces (Phase 3 — unified 0.8)."""

from __future__ import annotations

from src.routes.calories import _macro_status


def test_macro_status_uses_08_threshold():
    assert _macro_status(119, 165) == "low"
    assert _macro_status(132, 165) == "on_track"
    assert _macro_status(200, 165) == "high"
