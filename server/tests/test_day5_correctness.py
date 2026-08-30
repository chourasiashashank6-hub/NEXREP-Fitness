"""Day 5 correctness — high-risk behavioral regressions (no live DB required)."""

from __future__ import annotations

from datetime import date, datetime
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from src.main import _seed_initial_weight_log
from src.models.models import User
from src.models.weight_log import WeightLog
from src.services.plan_reflow_service import day_planner_exercises_fully_logged
from src.services.social_challenge_service import leaderboard_for_user
from src.services import xp_service
from src.services.xp_service import XP_EXERCISE_LOGGED, XP_WORKOUT_DAY_COMPLETED, award_xp_for_workout_log

IST = ZoneInfo("Asia/Kolkata")


def _fake_user(user_id: int, name: str) -> User:
    user = User(id=user_id, name=name, email=f"user{user_id}@day5.test", password_hash="test")
    return user


@patch("src.services.social_challenge_service.today_ist", return_value=date(2026, 8, 29))
@patch("src.services.social_challenge_service.week_window")
@patch("src.services.social_challenge_service.get_leaderboard_settings", return_value={"opted_in": True})
@patch("src.services.social_challenge_service.calculate_user_streak", return_value={"current_streak": 2})
@patch("src.services.social_challenge_service.workout_days_between", return_value=[])
@patch("src.services.social_challenge_service.accepted_friend_ids", return_value={2, 3})
def test_leaderboard_includes_viewer_in_rank(
    mock_friends,
    mock_workouts,
    mock_streak,
    mock_settings,
    mock_week_window,
    mock_today,
):
    week_start = date(2026, 8, 24)
    next_reset = datetime(2026, 8, 31, 0, 0, 0, tzinfo=IST)
    mock_week_window.return_value = (week_start, date(2026, 8, 31), next_reset)

    viewer = _fake_user(1, "Viewer")
    friend_a = _fake_user(2, "Friend A")
    friend_b = _fake_user(3, "Friend B")

    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = [viewer, friend_a, friend_b]

    payload = leaderboard_for_user(db, user_id=viewer.id)

    viewer_rows = [row for row in payload["items"] if row["user"]["user_id"] == viewer.id]
    assert len(viewer_rows) == 1
    assert viewer_rows[0]["is_self"] is True
    assert viewer_rows[0]["rank"] >= 1
    assert payload["unlocked"] is True
    assert len(payload["items"]) == 3


@patch("src.services.social_challenge_service.today_ist", return_value=date(2026, 8, 29))
@patch("src.services.social_challenge_service.week_window")
@patch("src.services.social_challenge_service.get_leaderboard_settings", return_value={"opted_in": True})
@patch("src.services.social_challenge_service.calculate_user_streak", return_value={"current_streak": 0})
@patch("src.services.social_challenge_service.workout_days_between", return_value=[])
@patch("src.services.social_challenge_service.accepted_friend_ids", return_value={2})
def test_leaderboard_locked_when_only_one_friend_plus_self(
    mock_friends,
    mock_workouts,
    mock_streak,
    mock_settings,
    mock_week_window,
    mock_today,
):
    week_start = date(2026, 8, 24)
    next_reset = datetime(2026, 8, 31, 0, 0, 0, tzinfo=IST)
    mock_week_window.return_value = (week_start, date(2026, 8, 31), next_reset)

    viewer = _fake_user(10, "Solo Viewer")
    friend = _fake_user(11, "Only Friend")
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = [viewer, friend]

    payload = leaderboard_for_user(db, user_id=viewer.id)
    assert payload["unlocked"] is False
    assert any(row["is_self"] for row in payload["items"])


def test_day_planner_exercises_fully_logged_true_when_all_checked_off():
    log_date = date(2026, 8, 15)
    entry = MagicMock()
    entry.day = 15
    entry.is_rest_day = False
    entry.exercises_json = '[{"name": "Bench Press"}, {"name": "Squat"}]'

    plan = MagicMock()
    plan.entries = [entry]

    workout_rows = [
        ("Bench Press", "source=workout_planner; body_part=Chest"),
        ("Squat", "source=workout_planner; body_part=Legs"),
    ]

    db = MagicMock()
    with patch("src.services.plan_reflow_service.get_existing_workout_plan", return_value=plan):
        db.query.return_value.filter.return_value.all.return_value = workout_rows
        assert day_planner_exercises_fully_logged(db, user_id=1, log_date=log_date) is True


def test_day_planner_exercises_fully_logged_false_when_one_missing():
    log_date = date(2026, 8, 15)
    entry = MagicMock()
    entry.day = 15
    entry.is_rest_day = False
    entry.exercises_json = '[{"name": "Bench Press"}, {"name": "Squat"}]'

    plan = MagicMock()
    plan.entries = [entry]

    db = MagicMock()
    with patch("src.services.plan_reflow_service.get_existing_workout_plan", return_value=plan):
        db.query.return_value.filter.return_value.all.return_value = [
            ("Bench Press", "source=workout_planner; body_part=Chest"),
        ]
        assert day_planner_exercises_fully_logged(db, user_id=1, log_date=log_date) is False


def test_award_xp_for_workout_log_grants_day_bonus_when_planner_day_complete(monkeypatch):
    awarded: list[tuple[str, str, int]] = []

    def fake_award(db, *, user_id, event_type, base_xp, idempotency_key, metadata):
        awarded.append((event_type, idempotency_key, base_xp))

    monkeypatch.setattr(xp_service, "_award_xp", fake_award)
    monkeypatch.setattr(xp_service, "_maybe_activate_comeback", lambda *args, **kwargs: None)
    monkeypatch.setattr(xp_service, "_day_workouts_fully_logged", lambda *args, **kwargs: True)

    db = MagicMock()
    log_date = date(2026, 8, 29)
    award_xp_for_workout_log(db, user_id=42, workout_id=99, log_date=log_date)

    assert ("exercise_logged", "workout:99", XP_EXERCISE_LOGGED) in awarded
    assert (
        "workout_day_completed",
        f"daily:{log_date.isoformat()}:workout_day_completed",
        XP_WORKOUT_DAY_COMPLETED,
    ) in awarded
    db.commit.assert_called_once()


def test_award_xp_for_workout_log_skips_day_bonus_when_incomplete(monkeypatch):
    awarded: list[str] = []

    def fake_award(db, *, user_id, event_type, base_xp, idempotency_key, metadata):
        awarded.append(event_type)

    monkeypatch.setattr(xp_service, "_award_xp", fake_award)
    monkeypatch.setattr(xp_service, "_maybe_activate_comeback", lambda *args, **kwargs: None)
    monkeypatch.setattr(xp_service, "_day_workouts_fully_logged", lambda *args, **kwargs: False)

    db = MagicMock()
    award_xp_for_workout_log(db, user_id=42, workout_id=100, log_date=date(2026, 8, 29))

    assert awarded == ["exercise_logged"]


@patch("src.main.today_ist", return_value=date(2026, 8, 29))
def test_seed_initial_weight_log_creates_baseline_row(mock_today):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    user = _fake_user(5, "Onboarding User")
    onboarding = {"personal": {"unit_system": "metric", "weight_kg": 72.5}}

    _seed_initial_weight_log(db, user, onboarding)

    db.add.assert_called_once()
    row = db.add.call_args[0][0]
    assert isinstance(row, WeightLog)
    assert row.user_id == user.id
    assert row.weight_kg == 72.5
    assert row.log_date == "2026-08-29"
    assert row.note == "Onboarding baseline"


def test_seed_initial_weight_log_skips_when_any_log_exists():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = WeightLog(
        user_id=5,
        weight_kg=80,
        log_date="2026-08-01",
    )

    user = _fake_user(5, "Returning User")
    onboarding = {"personal": {"unit_system": "metric", "weight_kg": 72.5}}

    _seed_initial_weight_log(db, user, onboarding)
    db.add.assert_not_called()
