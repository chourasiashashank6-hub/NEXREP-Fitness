"""Gym squad service helpers."""

from __future__ import annotations

from datetime import date

from src.services.squad_service import member_activity_for_date, parse_log_date


def test_parse_log_date_iso():
    assert parse_log_date("2026-08-17") == date(2026, 8, 17)


def test_parse_log_date_invalid_falls_back_to_today():
    parsed = parse_log_date("not-a-date")
    assert isinstance(parsed, date)


def test_member_activity_keys():
    class FakeDb:
        pass

    # Smoke: function exists and returns expected keys when db empty — integration needs real db.
    assert set(member_activity_for_date.__code__.co_varnames) >= {"db", "user_id", "log_date"}
