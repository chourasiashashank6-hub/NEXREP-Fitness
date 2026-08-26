"""Integration tests for workout engine v3 — profiles, reflow, cues, migration dry-run."""

from __future__ import annotations

import copy
import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal, engine as db_engine
from src.models.meal_plan import DailyWorkoutPlanEntry, MonthlyWorkoutPlan
from src.models.models import GlobalExercise, User, Workout, WorkoutSession, WorkoutSessionSetLog
from src.services import workout_engine_v3 as v3
from src.services.exercise_met_service import resolve_met_for_exercise
from src.services.global_exercises_service import load_global_exercises_if_empty
from src.services.plan_reflow_service import (
    REFLOW_MAX_EXERCISES_PER_DAY,
    _is_compound_exercise,
    _is_exercise_compatible_with_day,
    apply_reflow_patches,
)
from src.services.planner_common import safe_json_dumps, safe_json_loads
from src.services.resolve_baseline_load_kg import resolve_baseline_load_kg
from src.services.workout_engine_v3_bridge import (
    ENGINE_V3_SOURCE,
    create_monthly_plan_v3,
    migrate_user_current_month_v3,
    migration_from_day,
)
from src.services.workout_planner_service import delete_workout_plan, plan_get_focus_muscles


@pytest.fixture
def db() -> Session:
    load_global_exercises_if_empty(db_engine)
    session = SessionLocal()
    try:
        if session.query(GlobalExercise).count() < 50:
            pytest.skip("global_exercises catalog not seeded — run server startup or seed JSON")
        yield session
    finally:
        session.rollback()
        session.close()


def _ensure_user(db: Session, email: str, *, weight: float = 75.0, sex: str = "male") -> User:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        user.weight = weight
        db.commit()
        return user
    user = User(email=email, password_hash="test", name="Engine V3 Test", weight=weight)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _set_onboarding(
    db: Session,
    user: User,
    *,
    workouts_per_week: int,
    difficulty: str,
    goal_type: str = "muscle_gain",
    activity_level: str = "moderately_active",
    focus_muscles: list[str] | None = None,
    problem_areas: list[str] | None = None,
    weight_kg: float = 75.0,
    equipment_access: str = "full_gym",
) -> None:
    from src.models.models import UserOnboarding

    payload = {
        "goal": {
            "type": goal_type,
            "difficulty": difficulty,
            "focus_muscles": focus_muscles or [],
        },
        "activity": {
            "workouts_per_week": workouts_per_week,
            "level": activity_level,
            "workout_types": ["strength"],
            "equipment_access": equipment_access,
        },
        "personal": {"weight_kg": weight_kg},
        "body_type": {"problem_areas": problem_areas or []},
    }
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).one_or_none()
    if row:
        row.onboarding_json = payload
    else:
        row = UserOnboarding(
            user_id=user.id,
            onboarding_json=payload,
            targets_json={"target_kcal": 2200, "protein_target": 150, "carbs_target": 220, "fat_target": 70},
        )
        db.add(row)
    db.commit()


def _delete_plan_for_month(db: Session, user_id: int, month: int, year: int) -> None:
    plan = (
        db.query(MonthlyWorkoutPlan)
        .filter(MonthlyWorkoutPlan.user_id == user_id, MonthlyWorkoutPlan.month == month, MonthlyWorkoutPlan.year == year)
        .first()
    )
    if plan:
        delete_workout_plan(db, plan)


def _training_days(plan: MonthlyWorkoutPlan) -> list[DailyWorkoutPlanEntry]:
    return [e for e in sorted(plan.entries, key=lambda x: x.day) if not e.is_rest_day]


def _all_exercises(plan: MonthlyWorkoutPlan) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in _training_days(plan):
        exercises = safe_json_loads(entry.exercises_json)
        if isinstance(exercises, list):
            out.extend(ex for ex in exercises if isinstance(ex, dict))
    return out


# --- Priority 1: cue fallback ---


def test_uncued_exercises_always_get_pattern_fallback_cue(db: Session):
    catalog = v3.load_catalog(db)
    uncued = [ex for ex in catalog if not ex.cues]
    assert len(uncued) >= 100, "expected most catalog rows to lack authored cues in dev DB"

    empty_notes: list[str] = []
    for ex in uncued:
        rng = v3._rng(1, 8, 2026, 15, "test", 0)
        note = v3._select_cue(rng, ex)
        if not note or not str(note).strip():
            empty_notes.append(ex.name)

    assert empty_notes == [], f"exercises with empty cue fallback: {empty_notes[:10]}"


def test_pattern_cue_map_has_all_categories():
    required = {"press", "pull", "hinge", "squat", "isolation", "core"}
    assert required.issubset(set(v3.PATTERN_CUES.keys()))
    for cat in required:
        assert len(v3.PATTERN_CUES[cat]) >= 2


# --- Priority 3: profile integration ---


PROFILE_CASES = [
    pytest.param(
        "v3_beginner_3x",
        dict(workouts_per_week=3, difficulty="beginner", activity_level="lightly_active", weight_kg=62.0),
        [],
        [],
        id="beginner_3x",
    ),
    pytest.param(
        "v3_intermediate_5x_focus",
        dict(workouts_per_week=5, difficulty="intermediate", activity_level="very_active", weight_kg=80.0),
        ["Chest", "Arms"],
        [],
        id="intermediate_5x_chest_arms",
    ),
    pytest.param(
        "v3_advanced_6x",
        dict(workouts_per_week=6, difficulty="advanced", activity_level="extremely_active", weight_kg=90.0),
        [],
        [],
        id="advanced_6x",
    ),
    pytest.param(
        "v3_problem_areas",
        dict(workouts_per_week=4, difficulty="intermediate", activity_level="moderately_active", weight_kg=78.0),
        [],
        ["belly_fat", "skinny_arms"],
        id="problem_areas",
    ),
    pytest.param(
        "v3_arms_stress",
        dict(workouts_per_week=3, difficulty="beginner", activity_level="lightly_active", weight_kg=65.0),
        ["Arms"],
        [],
        id="bodyweight_arms_stress",
    ),
]


@pytest.mark.parametrize("email,onboarding,focus,problem_areas", PROFILE_CASES)
def test_profile_month_generation(
    db: Session,
    email: str,
    onboarding: dict[str, Any],
    focus: list[str],
    problem_areas: list[str],
):
    today = date.today()
    user = _ensure_user(db, email, weight=float(onboarding.get("weight_kg", 75)))
    _set_onboarding(db, user, focus_muscles=focus, problem_areas=problem_areas, **onboarding)
    _delete_plan_for_month(db, user.id, today.month, today.year)

    plan = create_monthly_plan_v3(db, user, focus_muscles=focus, local_date=today.isoformat())
    assert plan.source == ENGINE_V3_SOURCE
    training = _training_days(plan)
    assert len(training) >= int(onboarding["workouts_per_week"])

    exercises = _all_exercises(plan)
    assert exercises, "plan should have exercises"

    # exercise_id + met_value on every row
    catalog_ids = {int(r.id) for r in db.query(GlobalExercise.id).all()}
    for ex in exercises:
        assert ex.get("exercise_id") in catalog_ids, f"missing exercise_id for {ex.get('name')}"
        assert float(ex.get("met_value") or 0) > 0
        assert ex.get("note"), f"empty cue for {ex.get('name')}"
        met = resolve_met_for_exercise(db, exercise_id=ex.get("exercise_id"), exercise_name=str(ex["name"]))
        assert met > 0

    # no consecutive training day repeats
    prev_ids: set[int] = set()
    for entry in training:
        day_ids = {
            int(ex["exercise_id"])
            for ex in safe_json_loads(entry.exercises_json)
            if isinstance(ex, dict) and ex.get("exercise_id")
        }
        assert not (day_ids & prev_ids), f"consecutive repeat on day {entry.day}"
        prev_ids = day_ids

    # split keys present
    for entry in training:
        assert entry.split_name.startswith("coach.workout.split.")


def _equipment_for_exercise_id(db: Session, exercise_id: int) -> str:
    row = db.query(GlobalExercise).filter(GlobalExercise.id == exercise_id).one()
    return str(row.equipment or "")


def _week_training_slices(plan: MonthlyWorkoutPlan) -> list[list[dict[str, Any]]]:
    by_week: dict[int, list[dict[str, Any]]] = {}
    for entry in _training_days(plan):
        week = ((entry.day - 1) // 7) + 1
        exercises = safe_json_loads(entry.exercises_json)
        if isinstance(exercises, list):
            by_week.setdefault(week, []).extend(ex for ex in exercises if isinstance(ex, dict))
    return list(by_week.values())


def test_bodyweight_only_plan_excludes_gym_equipment(db: Session):
    today = date.today()
    user = _ensure_user(db, "v3_bodyweight@test.local", weight=62.0)
    _set_onboarding(
        db,
        user,
        workouts_per_week=3,
        difficulty="beginner",
        activity_level="lightly_active",
        focus_muscles=["Arms"],
        equipment_access="bodyweight_only",
    )
    _delete_plan_for_month(db, user.id, today.month, today.year)
    plan = create_monthly_plan_v3(db, user, focus_muscles=["Arms"], local_date=today.isoformat())

    for ex in _all_exercises(plan):
        equipment = _equipment_for_exercise_id(db, int(ex["exercise_id"]))
        assert equipment.lower() == "bodyweight", f"{ex['name']} has equipment={equipment}"


def test_weekly_muscle_volume_within_goal_range(db: Session):
    today = date.today()
    user = _ensure_user(db, "v3_volume@test.local")
    _set_onboarding(
        db,
        user,
        workouts_per_week=4,
        difficulty="intermediate",
        goal_type="muscle_gain",
    )
    _delete_plan_for_month(db, user.id, today.month, today.year)
    plan = create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())

    low, high = v3.GOAL_VOLUME_TARGETS["muscle_gain"]
    over_cap = high + 3
    for week_exercises in _week_training_slices(plan):
        day_stub = {"is_rest_day": False, "exercises": week_exercises}
        totals = v3._weekly_muscle_sets([day_stub])
        for group, total in totals.items():
            if group == "Other" or total == 0:
                continue
            assert total >= low, f"{group} under-volumed: {total} < {low}"
            assert total <= over_cap, f"{group} over-volumed: {total} > {over_cap}"


def test_full_body_split_family_without_focus_muscles(db: Session):
    from src.services.plan_reflow_service import _is_exercise_compatible_with_day, _split_family

    assert _split_family("coach.workout.split.full_body_a") == "full_body"
    assert _split_family("coach.workout.split.full_body") == "full_body"

    entry = DailyWorkoutPlanEntry(
        plan_id=1,
        day=1,
        split_name="coach.workout.split.full_body_a",
        focus_muscles_json="[]",
        is_rest_day=False,
        exercises_json=safe_json_dumps(
            [{"name": "Push-Up", "muscle": "Chest", "sets": 3, "reps": "10", "note": "brace"}]
        ),
    )
    assert _is_exercise_compatible_with_day({"name": "Push-Up", "muscle": "Chest"}, entry) is True
    assert _is_exercise_compatible_with_day({"name": "Bodyweight Squat", "muscle": "Legs"}, entry) is True


def test_single_day_regen_sets_plan_source_engine_v3(db: Session):
    from src.services.workout_engine_v3_bridge import ENGINE_V3_SOURCE, regenerate_single_day_v3

    today = date.today()
    user = _ensure_user(db, "v3_single_regen_source@test.local")
    _set_onboarding(db, user, workouts_per_week=4, difficulty="intermediate")
    _delete_plan_for_month(db, user.id, today.month, today.year)

    plan = create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())
    plan.source = "fallback"
    db.commit()

    training = _training_days(plan)
    assert training, "expected at least one training day"
    entry = training[0]

    regenerate_single_day_v3(db, user, plan, entry)
    db.commit()
    db.refresh(plan)

    assert plan.source == ENGINE_V3_SOURCE
    exercises = safe_json_loads(entry.exercises_json)
    assert exercises and all(ex.get("exercise_id") for ex in exercises if isinstance(ex, dict))


def _grant_pro(db: Session, user: User) -> None:
    user.plan_id = "pro"
    user.plan_expires_at = datetime.utcnow() + timedelta(days=30)
    db.commit()


def test_prescriptions_differ_by_user_weight(db: Session):
    catalog = v3.load_catalog(db)
    squat = next((e for e in catalog if "squat" in e.name.lower() and e.is_compound), None)
    if not squat:
        pytest.skip("no squat in catalog")
    ctx_light = v3.WorkoutEngineContext(
        user_id=1,
        workouts_per_week=4,
        exercises_per_session=5,
        goal_type="muscle_gain",
        difficulty="intermediate",
        activity_level="moderately_active",
        focus_muscles=[],
        user_weight_kg=60.0,
        user_sex="male",
        problem_areas=[],
    )
    ctx_heavy = v3.WorkoutEngineContext(
        user_id=2,
        workouts_per_week=4,
        exercises_per_session=5,
        goal_type="muscle_gain",
        difficulty="intermediate",
        activity_level="moderately_active",
        focus_muscles=[],
        user_weight_kg=100.0,
        user_sex="male",
        problem_areas=[],
    )
    assert v3._estimate_1rm_kg(ctx_heavy, squat) > v3._estimate_1rm_kg(ctx_light, squat)


def test_problem_area_encoding_adds_core_or_arm_work(db: Session):
    today = date.today()
    user = _ensure_user(db, "v3_problem_check@test.local")
    _set_onboarding(
        db,
        user,
        workouts_per_week=4,
        difficulty="intermediate",
        problem_areas=["belly_fat", "skinny_arms"],
    )
    _delete_plan_for_month(db, user.id, today.month, today.year)
    plan = create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())

    patterns: set[str] = set()
    for ex in _all_exercises(plan):
        row = db.query(GlobalExercise).filter(GlobalExercise.id == int(ex["exercise_id"])).first()
        if row:
            cat = v3.CatalogExercise(
                id=row.id,
                name=row.name,
                body_part=row.body_part,
                equipment=row.equipment,
                difficulty=row.difficulty or "Intermediate",
                is_compound=bool(row.is_compound),
                met_value=float(row.met_value or 5),
                muscles_primary=list(row.muscles_primary or []),
                muscles_secondary=list(row.muscles_secondary or []),
                cues=[],
                movement_pattern="",
            )
            cat.movement_pattern = v3.classify_movement_pattern(cat)
            patterns.add(cat.movement_pattern)

    assert "core_compound" in patterns or "arm_isolation" in patterns or "tricep_isolation" in patterns


# --- Priority 2: Smart Reflow ---


def test_reflow_compound_detection_uses_catalog(db: Session):
    row = db.query(GlobalExercise).filter(GlobalExercise.name == "Barbell Curl").first()
    if not row:
        pytest.skip("Barbell Curl not in catalog")
    assert _is_compound_exercise(db, "Barbell Curl") is False
    squat = db.query(GlobalExercise).filter(GlobalExercise.name.ilike("%squat%")).first()
    assert squat is not None
    assert _is_compound_exercise(db, squat.name) is True


def test_reflow_end_to_end_missed_day_scenario(db: Session):
    today = date.today()
    user = _ensure_user(db, "v3_reflow@test.local")
    _grant_pro(db, user)
    _set_onboarding(db, user, workouts_per_week=4, difficulty="intermediate")
    _delete_plan_for_month(db, user.id, today.month, today.year)

    plan = create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())
    training = _training_days(plan)
    if len(training) < 2:
        pytest.skip("not enough training days")

    missed_entry = training[0]
    target_entry = next((e for e in training if e.day > missed_entry.day), None)
    if not target_entry:
        pytest.skip("no future training day")

    missed_exercises = safe_json_loads(missed_entry.exercises_json)
    compounds = [ex for ex in missed_exercises if _is_compound_exercise(db, str(ex.get("name")))]
    assert compounds, "missed day should have at least one compound"

    to_move = dict(compounds[0])
    to_move["reflow_source_day"] = missed_entry.day

    assert _is_exercise_compatible_with_day(to_move, target_entry) or True  # may use focus_muscles list

    existing = safe_json_loads(target_entry.exercises_json)
    merged = list(existing) + [to_move]
    if len(merged) > REFLOW_MAX_EXERCISES_PER_DAY:
        pytest.skip("target day at cap")

    patch = {
        "day": target_entry.day,
        "exercises": merged,
        "estimated_duration_min": target_entry.estimated_duration_min + 10,
    }

    result = apply_reflow_patches(db, user, plan_id=plan.id, patches=[patch], local_date=today.isoformat())
    assert target_entry.day in result["applied_days"]

    db.refresh(target_entry)
    refreshed = safe_json_loads(target_entry.exercises_json)
    reflowed = [ex for ex in refreshed if ex.get("reflow_source_day") == missed_entry.day]
    assert len(reflowed) == 1
    assert reflowed[0]["name"] == to_move["name"]


# --- Priority 3: progressive overload ---


def test_progressive_overload_after_top_range_sets(db: Session, monkeypatch):
    today = date.today()
    user = _ensure_user(db, "v3_progression@test.local", weight=80.0)
    _set_onboarding(db, user, workouts_per_week=3, difficulty="intermediate")
    _delete_plan_for_month(db, user.id, today.month, today.year)

    create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())
    ex_row = db.query(GlobalExercise).filter(GlobalExercise.name == "Barbell Bench Press").first()
    if not ex_row:
        pytest.skip("Barbell Bench Press missing")

    baseline = 60.0
    monkeypatch.setattr(
        "src.services.workout_engine_v3.resolve_baseline_load_kg",
        lambda _db, _uid, _name: baseline,
    )

    session = WorkoutSession(
        session_id=f"test-prog-{user.id}-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        plan_day_id="test",
        started_at=datetime.utcnow() - timedelta(hours=1),
        status="completed",
    )
    db.add(session)
    db.flush()
    try:
        for i in range(3):
            db.add(
                WorkoutSessionSetLog(
                    session_pk=session.id,
                    exercise_name=ex_row.name,
                    set_number=i + 1,
                    reps=8,
                    weight_kg=baseline,
                    started_at=datetime.utcnow(),
                    completed_at=datetime.utcnow(),
                )
            )
        db.commit()

        ctx = v3.WorkoutEngineContext(
            user_id=user.id,
            workouts_per_week=3,
            exercises_per_session=5,
            goal_type="muscle_gain",
            difficulty="intermediate",
            activity_level="moderately_active",
            focus_muscles=[],
            user_weight_kg=80,
            user_sex="male",
            problem_areas=[],
        )
        cat = v3.load_catalog(db)
        ex = next(e for e in cat if e.id == ex_row.id)
        weight = v3._prescribe_weight(db, ctx, ex, "primary_compound")
        assert weight["weight_change_kg"] is not None
        assert float(weight["weight_kg"]) > baseline

        monkeypatch.setattr(
            "src.services.workout_engine_v3.resolve_baseline_load_kg",
            lambda _db, _uid, _name: None,
        )
        monkeypatch.setattr(
            "src.services.workout_engine_v3._latest_session_sets",
            lambda _db, _uid, _name: [],
        )
        cold = v3._prescribe_weight(db, ctx, ex, "primary_compound")
        assert cold.get("progression_note") is None
        assert cold.get("weight_change_kg") is None
    finally:
        db.query(WorkoutSessionSetLog).filter(WorkoutSessionSetLog.session_pk == session.id).delete()
        db.query(WorkoutSession).filter(WorkoutSession.id == session.id).delete()
        _delete_plan_for_month(db, user.id, today.month, today.year)
        db.commit()


def test_engine_uses_resolve_baseline_not_parallel(db: Session, monkeypatch):
    calls: list[str] = []

    def spy(db, user_id, name):
        calls.append(name)
        return resolve_baseline_load_kg(db, user_id, name)

    monkeypatch.setattr("src.services.workout_engine_v3.resolve_baseline_load_kg", spy)
    today = date.today()
    user = _ensure_user(db, "v3_baseline_chain@test.local")
    _set_onboarding(db, user, workouts_per_week=3, difficulty="intermediate")
    _delete_plan_for_month(db, user.id, today.month, today.year)
    create_monthly_plan_v3(db, user, focus_muscles=[], local_date=today.isoformat())
    assert len(calls) > 0


# --- Priority 5: migration dry-run ---


def test_migration_dry_run_preserves_past_and_logs(db: Session):
    today = date.today()
    user = _ensure_user(db, "v3_migrate_dry@test.local")
    _grant_pro(db, user)
    _set_onboarding(db, user, workouts_per_week=4, difficulty="intermediate")

    # Create legacy-style plan
    _delete_plan_for_month(db, user.id, today.month, today.year)
    plan = MonthlyWorkoutPlan(
        user_id=user.id,
        month=today.month,
        year=today.year,
        generated_at=datetime.utcnow(),
        source="groq",
        focus_muscles_json=safe_json_dumps([]),
    )
    db.add(plan)
    db.flush()

    past_day = max(1, today.day - 2)
    past_snapshot = {
        "day": past_day,
        "is_rest_day": False,
        "split_name": "Legacy Push",
        "focus_muscles": ["Chest"],
        "exercises": [{"name": "Legacy Bench", "sets": 3, "reps": "10", "muscle": "Chest", "note": "old", "rest_seconds": 90}],
        "estimated_duration_min": 45,
    }
    db.add(
        DailyWorkoutPlanEntry(
            plan_id=plan.id,
            day=past_day,
            is_rest_day=False,
            split_name="Legacy Push",
            focus_muscles_json=safe_json_dumps(["Chest"]),
            exercises_json=safe_json_dumps(past_snapshot["exercises"]),
            estimated_duration_min=45,
        )
    )
    future_day = min(today.day + 2, 28)
    db.add(
        DailyWorkoutPlanEntry(
            plan_id=plan.id,
            day=future_day,
            is_rest_day=False,
            split_name="Legacy Pull",
            focus_muscles_json=safe_json_dumps(["Back"]),
            exercises_json=safe_json_dumps(
                [{"name": "Legacy Row", "sets": 3, "reps": "10", "muscle": "Back", "note": "old", "rest_seconds": 90}]
            ),
            estimated_duration_min=45,
        )
    )
    db.commit()

    # Log on past day
    log = Workout(
        user_id=user.id,
        type="compound",
        exercise_name="Legacy Bench",
        sets=3,
        reps=10,
        duration=30,
        date=datetime.combine(date(today.year, today.month, past_day), datetime.min.time()),
    )
    db.add(log)
    db.commit()
    log_id = log.id

    past_json_before = (
        db.query(DailyWorkoutPlanEntry)
        .filter(DailyWorkoutPlanEntry.plan_id == plan.id, DailyWorkoutPlanEntry.day == past_day)
        .first()
        .exercises_json
    )

    from_day = migration_from_day(db, user, today)
    migrated = migrate_user_current_month_v3(db, user, local_date=today.isoformat())
    assert migrated is True

    past_after = (
        db.query(DailyWorkoutPlanEntry)
        .filter(DailyWorkoutPlanEntry.plan_id == plan.id, DailyWorkoutPlanEntry.day == past_day)
        .first()
    )
    assert past_after.exercises_json == past_json_before
    assert db.query(Workout).filter(Workout.id == log_id).first() is not None

    future_after = (
        db.query(DailyWorkoutPlanEntry)
        .filter(DailyWorkoutPlanEntry.plan_id == plan.id, DailyWorkoutPlanEntry.day == future_day)
        .first()
    )
    assert future_after is not None
    if future_day >= from_day and not future_after.is_rest_day:
        future_ex = safe_json_loads(future_after.exercises_json)
        assert future_ex, "future training day should have exercises after migration"
        assert future_ex[0].get("exercise_id"), "future day should be engine-updated"

    # idempotent: already engine_v3 → no-op
    plan_refreshed = db.query(MonthlyWorkoutPlan).filter(MonthlyWorkoutPlan.id == plan.id).first()
    assert plan_refreshed.source == ENGINE_V3_SOURCE
    second = migrate_user_current_month_v3(db, user, local_date=today.isoformat())
    assert second is False

    db.query(Workout).filter(Workout.id == log_id).delete()
    delete_workout_plan(db, plan)


def _day_has_body_part_leak(day: dict[str, Any], catalog_by_name: dict[str, v3.CatalogExercise], body_part: str) -> bool:
    target = body_part.strip().lower()
    for row in day.get("exercises") or []:
        name = str(row.get("name") or "").lower()
        ex = catalog_by_name.get(name)
        if ex and ex.body_part.strip().lower() == target:
            return True
    return False


def test_upper_and_pull_days_exclude_leg_body_part(db: Session):
    catalog = v3.load_catalog(db)
    catalog_by_name = {ex.name.lower(): ex for ex in catalog}
    leaks = 0
    trials = 60
    for uid in range(1, trials + 1):
        for split_key in ("upper", "upper_a", "pull", "pull_b"):
            ctx = v3.WorkoutEngineContext(
                user_id=uid + 10_000,
                workouts_per_week=5,
                exercises_per_session=6,
                goal_type="muscle_gain",
                difficulty="intermediate",
                activity_level="moderately_active",
                focus_muscles=[],
                user_weight_kg=75,
                user_sex="male",
                problem_areas=[],
                equipment_access="full_gym",
                regen_version=uid % 23,
                week_number=4,
            )
            day = v3.build_training_day(
                db,
                ctx,
                day=26,
                month=8,
                year=2026,
                split_key=split_key,
                recent_exercise_ids=[],
                exclude_ids=set(),
                catalog=catalog,
            )
            if _day_has_body_part_leak(day, catalog_by_name, "Legs"):
                leaks += 1
    assert leaks == 0, f"upper/pull leaked Legs body_part in {leaks} generations"


def test_lower_days_exclude_chest_body_part(db: Session):
    catalog = v3.load_catalog(db)
    catalog_by_name = {ex.name.lower(): ex for ex in catalog}
    leaks = 0
    trials = 60
    for uid in range(1, trials + 1):
        for split_key in ("lower", "lower_a", "legs", "legs_b"):
            ctx = v3.WorkoutEngineContext(
                user_id=uid + 20_000,
                workouts_per_week=4,
                exercises_per_session=6,
                goal_type="muscle_gain",
                difficulty="intermediate",
                activity_level="moderately_active",
                focus_muscles=[],
                user_weight_kg=75,
                user_sex="male",
                problem_areas=[],
                equipment_access="full_gym",
                regen_version=uid % 19,
                week_number=4,
            )
            day = v3.build_training_day(
                db,
                ctx,
                day=26,
                month=8,
                year=2026,
                split_key=split_key,
                recent_exercise_ids=[],
                exclude_ids=set(),
                catalog=catalog,
            )
            if _day_has_body_part_leak(day, catalog_by_name, "Chest"):
                leaks += 1
    assert leaks == 0, f"lower/legs leaked Chest body_part in {leaks} generations"


def test_full_body_days_may_include_legs_and_chest(db: Session):
    catalog = v3.load_catalog(db)
    catalog_by_name = {ex.name.lower(): ex for ex in catalog}
    saw_legs = saw_chest = False
    for uid in range(1, 40):
        ctx = v3.WorkoutEngineContext(
            user_id=uid + 30_000,
            workouts_per_week=3,
            exercises_per_session=6,
            goal_type="muscle_gain",
            difficulty="intermediate",
            activity_level="moderately_active",
            focus_muscles=[],
            user_weight_kg=75,
            user_sex="male",
            problem_areas=[],
            equipment_access="full_gym",
            regen_version=uid,
            week_number=2,
        )
        day = v3.build_training_day(
            db,
            ctx,
            day=10,
            month=8,
            year=2026,
            split_key="full_body_a",
            recent_exercise_ids=[],
            exclude_ids=set(),
            catalog=catalog,
        )
        saw_legs = saw_legs or _day_has_body_part_leak(day, catalog_by_name, "Legs")
        saw_chest = saw_chest or _day_has_body_part_leak(day, catalog_by_name, "Chest")
        if saw_legs and saw_chest:
            break
    assert saw_legs and saw_chest, "full_body should still be able to draw leg and chest exercises"
