"""Tests for fasting-aware meal preferences and meal engine integration."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import User
from src.models.recipes import Recipe, UserFastingPreference, UserMealPlan
from src.scripts.import_recipe_seed import load_seed, upsert_recipes
from src.services import meal_engine_v3 as v3
from src.services.fasting_service import (
    deactivate_fasting_preference,
    fasting_tag_for_period,
    get_active_fasting_period,
    get_active_fasting_tag,
    list_fasting_preferences,
    upsert_fasting_preference,
)

SEED = Path(__file__).resolve().parents[1] / "nexrep_recipes_seed.json"
FASTING_SEED = Path(__file__).resolve().parents[1] / "nexrep_fasting_recipes_seed.json"


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    try:
        count = session.query(Recipe).count()
        if count < 100 and SEED.exists():
            upsert_recipes(session, load_seed(SEED))
        if FASTING_SEED.exists():
            upsert_recipes(session, load_seed(FASTING_SEED))
        yield session
    finally:
        session.close()


def _ensure_user(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        return int(user.id)
    user = User(email=email, password_hash="test", name="Fasting Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def _clean_fasting(db: Session, user_id: int) -> None:
    db.query(UserFastingPreference).filter(UserFastingPreference.user_id == user_id).delete()
    db.commit()


def _clean_plans(db: Session, user_id: int) -> None:
    db.query(UserMealPlan).filter(UserMealPlan.user_id == user_id).delete()
    db.commit()


def test_new_occasions_reuse_existing_recipe_pools():
    assert fasting_tag_for_period("karva_chauth") == "fasting_ekadashi"
    assert fasting_tag_for_period("janmashtami") == "fasting_navratri"
    assert fasting_tag_for_period("chhath_puja") == "fasting_custom"


def test_case1_custom_period_saves_and_filters_meals(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "fasting_case1@test.local")
    _clean_fasting(db, user_id)
    _clean_plans(db, user_id)

    row = upsert_fasting_preference(
        db,
        user_id,
        period_type="custom",
        start_date=date(2032, 4, 1),
        end_date=date(2032, 4, 7),
        active=True,
    )
    assert row.id is not None
    saved = list_fasting_preferences(db, user_id)
    assert any(p.id == row.id and p.period_type == "custom" for p in saved)
    assert get_active_fasting_tag(db, user_id, "2032-04-03") == "fasting_custom"

    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=date(2032, 4, 3),
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
        fasting_tag=get_active_fasting_tag(db, user_id, "2032-04-03"),
    )
    assert len(rows) == 3
    for meal in rows:
        recipe = db.query(Recipe).filter(Recipe.id == meal.recipe_id).one()
        assert "fasting_custom" in (recipe.dietary_tags or [])
    db.commit()


def test_case2_end_before_start_rejected(db: Session):
    user_id = _ensure_user(db, "fasting_case2@test.local")
    _clean_fasting(db, user_id)
    with pytest.raises(ValueError, match="end_date must be on or after start_date"):
        upsert_fasting_preference(
            db,
            user_id,
            period_type="navratri",
            start_date=date(2032, 5, 10),
            end_date=date(2032, 5, 1),
            active=True,
        )


def test_case3_overlapping_periods_last_start_wins(db: Session):
    user_id = _ensure_user(db, "fasting_case3@test.local")
    _clean_fasting(db, user_id)

    upsert_fasting_preference(
        db,
        user_id,
        period_type="navratri",
        start_date=date(2032, 6, 1),
        end_date=date(2032, 6, 9),
        active=True,
    )
    upsert_fasting_preference(
        db,
        user_id,
        period_type="custom",
        start_date=date(2032, 6, 5),
        end_date=date(2032, 6, 12),
        active=True,
    )

    active = get_active_fasting_period(db, user_id, "2032-06-07")
    assert active is not None
    assert active.period_type == "custom"
    assert get_active_fasting_tag(db, user_id, "2032-06-07") == "fasting_custom"


def test_case4_no_active_period_uses_regular_pool(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "fasting_case4@test.local")
    _clean_fasting(db, user_id)
    _clean_plans(db, user_id)

    assert get_active_fasting_tag(db, user_id, "2032-7-15") is None
    plan_date = date(2032, 7, 15)
    kwargs = dict(
        user_id=user_id,
        plan_date=plan_date,
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
    )
    rows_regular = v3.ensure_day_plan(db, fasting_tag=None, **kwargs)
    _clean_plans(db, user_id)
    rows_via_service = v3.ensure_day_plan(db, fasting_tag=get_active_fasting_tag(db, user_id, "2032-07-15"), **kwargs)
    assert [r.recipe_id for r in rows_regular] == [r.recipe_id for r in rows_via_service]
    db.commit()


def test_case5_small_pool_full_week_relaxes_cooldown(db: Session, caplog):
    import logging

    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    caplog.set_level(logging.INFO, logger="src.services.meal_engine_v3")
    user_id = _ensure_user(db, "fasting_case5@test.local")
    _clean_plans(db, user_id)

    start = date(2032, 8, 1)
    all_rows: list[UserMealPlan] = []
    for offset in range(7):
        plan_date = start + timedelta(days=offset)
        rows = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet="vegetarian",
            goal="maintain",
            daily_kcal=2200,
            meals_per_day=3,
            force=True,
            fasting_tag="fasting_ekadashi",
        )
        all_rows.extend(rows)
        for row in rows:
            recipe = db.query(Recipe).filter(Recipe.id == row.recipe_id).one()
            assert "fasting_ekadashi" in (recipe.dietary_tags or [])

    assert len(all_rows) == 21
    relaxed = [rec for rec in caplog.records if rec.message == "meal_engine_v3.cooldown_relaxed"]
    assert relaxed, "expected cooldown relaxation when ekadashi pool is smaller than 7-day demand"
    db.commit()


def test_case6_inactive_period_falls_back_to_regular_pool(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "fasting_case6@test.local")
    _clean_fasting(db, user_id)
    _clean_plans(db, user_id)

    row = upsert_fasting_preference(
        db,
        user_id,
        period_type="navratri",
        start_date=date(2032, 9, 1),
        end_date=date(2032, 9, 9),
        active=True,
    )
    assert get_active_fasting_tag(db, user_id, "2032-09-05") == "fasting_navratri"

    deactivate_fasting_preference(db, user_id, row.id)
    assert get_active_fasting_tag(db, user_id, "2032-09-05") is None

    plan_date = date(2032, 9, 5)
    kwargs = dict(
        user_id=user_id,
        plan_date=plan_date,
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
    )
    rows_regular = v3.ensure_day_plan(db, fasting_tag=None, **kwargs)
    _clean_plans(db, user_id)
    rows_after_deactivate = v3.ensure_day_plan(
        db,
        fasting_tag=get_active_fasting_tag(db, user_id, "2032-09-05"),
        **kwargs,
    )
    assert [r.recipe_id for r in rows_regular] == [r.recipe_id for r in rows_after_deactivate]
    db.commit()


def test_case7_deactivate_does_not_mutate_existing_meal_plans(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "fasting_case7@test.local")
    _clean_fasting(db, user_id)
    _clean_plans(db, user_id)

    row = upsert_fasting_preference(
        db,
        user_id,
        period_type="ekadashi",
        start_date=date(2032, 10, 1),
        end_date=date(2032, 10, 7),
        active=True,
    )
    plan_date = date(2032, 10, 3)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
        fasting_tag="fasting_ekadashi",
    )
    before_ids = sorted(r.recipe_id for r in rows)

    deactivate_fasting_preference(db, user_id, row.id)

    stored = (
        db.query(UserMealPlan)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == plan_date)
        .all()
    )
    after_ids = sorted(r.recipe_id for r in stored)
    assert before_ids == after_ids
    db.commit()
