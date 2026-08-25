"""
Run: cd server && python -m pytest tests/test_resolve_burn_target_weight_kg.py -q
"""

from types import SimpleNamespace

from src.services.resolve_burn_target_weight_kg import resolve_burn_target_weight_kg


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _FakeDb:
    def __init__(self, weight_log, onboarding_json=None):
        self.weight_log = weight_log
        self.onboarding_json = onboarding_json

    def query(self, model):
        name = getattr(model, "__name__", "")
        if name == "WeightLog":
            return _FakeQuery(self.weight_log)
        if name == "UserOnboarding":
            if self.onboarding_json is None:
                return _FakeQuery(None)
            return _FakeQuery(SimpleNamespace(onboarding_json=self.onboarding_json))
        return _FakeQuery(None)


def test_prefers_weight_log_over_profile():
    user = SimpleNamespace(id=1, weight=80.0)
    log = SimpleNamespace(weight_kg=74.0)
    db = _FakeDb(weight_log=log)
    assert resolve_burn_target_weight_kg(db, user) == 74.0


def test_falls_back_to_profile_without_log():
    user = SimpleNamespace(id=1, weight=81.0)
    db = _FakeDb(weight_log=None)
    assert resolve_burn_target_weight_kg(db, user) == 81.0


def test_falls_back_to_onboarding_without_profile():
    user = SimpleNamespace(id=1, weight=None)
    db = _FakeDb(
        weight_log=None,
        onboarding_json={"personal": {"weight_kg": 68}},
    )
    assert resolve_burn_target_weight_kg(db, user) == 68.0
