"""Day 6 correctness — fasting relaxation, allergies, goal timeline, squad meals, XP, feed."""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

from src.models.recipes import Recipe
from src.routes.calories import _weeks_to_goal
from src.services import meal_engine_v3 as v3
from src.services.meal_engine_v3 import EmptyRecipePoolError, EMPTY_RECIPE_POOL_USER_MESSAGE
from src.services.activity_feed_service import unreact_from_event
from src.services.recipe_allergy import filter_recipes_by_allergies, recipe_contains_allergen
from src.services.squad_service import member_activity_for_date
from src.services import xp_service


def _recipe(**kwargs) -> Recipe:
    base = dict(
        id=1,
        external_id=1,
        name="Test Dish",
        category="Test",
        diet="vegetarian",
        servings=1,
        serving_grams=200,
        kcal=400,
        protein_g=20,
        fat_g=10,
        carbs_g=40,
        fibre_g=5,
        protein_pct_kcal=20,
        prep_min=10,
        items=[{"key": "paneer", "label": "Paneer", "grams": 100}],
        steps=[],
        slots=["lunch"],
        dietary_tags=[],
    )
    base.update(kwargs)
    return Recipe(**base)


def test_recipe_allergy_excludes_dairy_ingredient():
    recipe = _recipe(items=[{"key": "paneer", "label": "Paneer", "grams": 80}])
    assert recipe_contains_allergen(recipe, "dairy") is True
    filtered = filter_recipes_by_allergies([recipe], ["dairy"])
    assert filtered == []


def test_recipe_allergy_allows_safe_recipe():
    recipe = _recipe(items=[{"key": "brown_rice_cooked", "label": "Rice", "grams": 150}], diet="vegan")
    assert recipe_contains_allergen(recipe, "nuts") is False
    assert filter_recipes_by_allergies([recipe], ["dairy", "nuts"]) == [recipe]


def test_weeks_to_goal_fat_loss_at_target_is_zero():
    weeks, reached = _weeks_to_goal("fat_loss", 65.0, 70.0, 0.5)
    assert weeks == 0
    assert reached is True


def test_weeks_to_goal_fat_loss_still_losing():
    weeks, reached = _weeks_to_goal("fat_loss", 80.0, 70.0, 0.5)
    assert weeks == 20
    assert reached is False


def test_weeks_to_goal_muscle_gain_at_target():
    weeks, reached = _weeks_to_goal("muscle_gain", 75.0, 70.0, 0.25)
    assert weeks == 0
    assert reached is True


@patch("src.services.squad_service._workout_logged_on_date", return_value=True)
@patch("src.services.squad_service._expected_meal_slots", return_value=3)
@patch("src.services.squad_service._logged_meal_count", return_value=2)
def test_squad_meals_requires_all_planned_slots(mock_logged, mock_expected, mock_workout):
    activity = member_activity_for_date(MagicMock(), user_id=1, log_date=date(2026, 8, 29))
    assert activity["workout_logged"] is True
    assert activity["meals_logged"] is False


@patch("src.services.squad_service._workout_logged_on_date", return_value=True)
@patch("src.services.squad_service._expected_meal_slots", return_value=3)
@patch("src.services.squad_service._logged_meal_count", return_value=3)
def test_squad_meals_complete_when_all_planned_logged(mock_logged, mock_expected, mock_workout):
    activity = member_activity_for_date(MagicMock(), user_id=1, log_date=date(2026, 8, 29))
    assert activity["meals_logged"] is True


def test_guided_warmup_xp_award_uses_session_idempotency(monkeypatch):
    awarded: list[str] = []

    def fake_award(db, *, user_id, event_type, base_xp, idempotency_key, metadata):
        awarded.append(idempotency_key)

    monkeypatch.setattr(xp_service, "_award_xp", fake_award)
    db = MagicMock()
    xp_service.award_xp_for_guided_warmup(db, user_id=9, session_id="sess-abc")
    assert awarded == ["guided_warmup:sess-abc"]


def test_empty_recipe_pool_error_is_user_friendly():
    err = EmptyRecipePoolError(diet="vegan", slot="lunch", allergies=["dairy"])
    assert str(err) == EMPTY_RECIPE_POOL_USER_MESSAGE


@patch("src.services.meal_engine_v3.fetch_slot_pool")
def test_fasting_pool_relaxes_by_dropping_fasting_tag(mock_fetch):
    relaxed = [_recipe(id=2, diet="vegan", dietary_tags=[])]
    mock_fetch.side_effect = [[], [], relaxed]

    pool, meta = v3._resolve_slot_pool(
        MagicMock(),
        diet="vegan",
        slot="lunch",
        fasting_tag="fasting_navratri",
        allergies=[],
        exclude_recipe_ids=set(),
        user_id=1,
        plan_date=date(2026, 8, 29),
    )
    assert len(pool) == 1
    assert pool[0].id == 2
    assert meta["relaxed_fasting"] is True


def test_unreact_from_event_deletes_row():
    db = MagicMock()
    reaction = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = reaction
    event = MagicMock(id=5)
    actor = MagicMock(id=2)
    assert unreact_from_event(db, event=event, actor=actor, reaction_type="flame") is True
    db.delete.assert_called_once_with(reaction)
    db.commit.assert_called_once()
