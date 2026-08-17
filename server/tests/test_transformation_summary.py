"""Unit tests mirroring mobile buildTransformationSummary logic."""

from __future__ import annotations

from datetime import date


def _build_summary(
    *,
    from_date: str,
    to_date: str,
    weight_entries: list[dict],
    workout_items: list[dict],
    pr_count_override: int | None = None,
) -> dict:
    in_range = lambda d: from_date <= d <= to_date
    weights = sorted([e for e in weight_entries if in_range(e["log_date"])], key=lambda e: e["log_date"])
    start = weights[0]["weight_kg"] if weights else None
    end = weights[-1]["weight_kg"] if weights else None
    delta = round(end - start, 1) if start is not None and end is not None else None
    workouts = [w for w in workout_items if in_range(w["date"][:10])]
    days = {w["date"][:10] for w in workouts}
    pr_count = pr_count_override if pr_count_override is not None else sum(1 for w in workouts if w.get("is_pr"))
    return {"weight_delta_kg": delta, "workout_days": len(days), "pr_count": pr_count}


def test_summary_weight_and_workouts():
    summary = _build_summary(
        from_date="2026-01-01",
        to_date="2026-03-01",
        weight_entries=[
            {"log_date": "2026-01-05", "weight_kg": 80.0},
            {"log_date": "2026-02-20", "weight_kg": 77.5},
        ],
        workout_items=[
            {"date": "2026-01-10T08:00:00", "is_pr": False},
            {"date": "2026-01-11T08:00:00", "is_pr": True},
            {"date": "2025-12-01T08:00:00", "is_pr": True},
        ],
    )
    assert summary["weight_delta_kg"] == -2.5
    assert summary["workout_days"] == 2
    assert summary["pr_count"] == 1


def test_summary_works_with_zero_photos():
    summary = _build_summary(
        from_date=date.today().isoformat(),
        to_date=date.today().isoformat(),
        weight_entries=[],
        workout_items=[],
        pr_count_override=0,
    )
    assert summary["weight_delta_kg"] is None
    assert summary["workout_days"] == 0
