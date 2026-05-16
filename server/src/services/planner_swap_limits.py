"""In-memory daily swap counters (per user, per local date)."""

from __future__ import annotations

SWAP_LIMIT_PER_DAY = 5


class SwapLimitExceeded(Exception):
    """Raised when user exceeds daily swap quota."""

_meal_swap_counts: dict[str, int] = {}
_exercise_swap_counts: dict[str, int] = {}


def _key(user_id: int, kind: str, local_date: str) -> str:
    return f"{kind}:{user_id}:{local_date}"


def get_swap_count(user_id: int, kind: str, local_date: str) -> int:
    store = _meal_swap_counts if kind == "meal" else _exercise_swap_counts
    return store.get(_key(user_id, kind, local_date), 0)


def check_swap_allowed(user_id: int, kind: str, local_date: str) -> bool:
    return get_swap_count(user_id, kind, local_date) < SWAP_LIMIT_PER_DAY


def increment_swap(user_id: int, kind: str, local_date: str) -> int:
    store = _meal_swap_counts if kind == "meal" else _exercise_swap_counts
    k = _key(user_id, kind, local_date)
    store[k] = store.get(k, 0) + 1
    return store[k]
