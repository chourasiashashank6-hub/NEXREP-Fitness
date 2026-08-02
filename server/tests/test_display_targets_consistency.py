"""Home, Calorie Log, and Meal Planner must share calorie_log_targets display numbers."""

from __future__ import annotations

from types import SimpleNamespace

from src.services.meal_planner_service import _plan_targets_dict


def test_plan_targets_dict_ignores_stored_v3_columns(monkeypatch):
    """Meal Planner Daily Summary must not show v3 kcal_mult-adjusted stored targets."""
    canonical = {
        "target_kcal": 2017,
        "protein_target": 150,
        "carbs_target": 201,
        "fat_target": 60,
        "fiber_target": 30,
    }

    monkeypatch.setattr(
        "src.services.meal_planner_service.get_user_nutrition_targets",
        lambda db, user: canonical,
    )

    stale_v3_plan = SimpleNamespace(
        target_kcal=1714,
        target_protein_g=120,
        target_carbs_g=100,
        target_fat_g=50,
    )
    out = _plan_targets_dict(stale_v3_plan, db=None, user=None)  # type: ignore[arg-type]
    assert out["kcal"] == 2017
    assert out["kcal"] != 1714
    assert out["protein_g"] == 150


def test_get_or_create_daily_log_uses_calorie_log_targets(monkeypatch):
    """Calorie Log daily target must come from get_calorie_log_targets, not resolve_user_targets."""
    from src.routes.calories import _get_or_create_daily_log

    canonical = {
        "target_calories": 2017,
        "target_protein_g": 150,
        "target_carbs_g": 201,
        "target_fat_g": 60,
        "target_fiber_g": 30,
        "target_water_l": 2.5,
    }
    calls: list[str] = []

    def fake_get_calorie_log_targets(db, user):
        calls.append("calorie_log_targets")
        return canonical

    def fake_resolve(db, user):
        calls.append("resolve_user_targets")
        return {**canonical, "target_calories": 1940}

    monkeypatch.setattr(
        "src.services.calorie_log_targets.get_calorie_log_targets",
        fake_get_calorie_log_targets,
    )
    monkeypatch.setattr(
        "src.routes.calories.resolve_user_targets",
        fake_resolve,
    )

    existing_log = SimpleNamespace(
        user_id=1,
        log_date=None,
        target_calories=0,
        target_protein_g=0,
        target_carbs_g=0,
        target_fat_g=0,
        target_fiber_g=0,
        target_water_l=0,
    )

    class FakeQuery:
        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return existing_log

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def flush(self):
            pass

    monkeypatch.setattr("src.routes.calories._ensure_water_row", lambda *a, **k: None)

    log = _get_or_create_daily_log(FakeSession(), SimpleNamespace(id=1), None)  # type: ignore[arg-type]
    assert calls == ["calorie_log_targets"]
    assert int(log.target_calories) == 2017
