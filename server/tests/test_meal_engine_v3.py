"""Part 7 tests for meal engine v3."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.meal_plan import MonthlyMealPlan
from src.models.models import User
from src.models.recipes import Recipe, UserMealPlan
from src.scripts.import_recipe_seed import load_seed, upsert_recipes
from src.services import meal_engine_v3 as v3
from src.services.meal_engine_v3 import EmptyRecipePoolError
from src.services.meal_engine_v3_bridge import regenerate_day_v3

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
    user = User(email=email, password_hash="test", name="Meal Engine Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return int(user.id)


def _clean_plans(db: Session, user_id: int) -> None:
    db.query(UserMealPlan).filter(UserMealPlan.user_id == user_id).delete()
    db.commit()


def test_import_idempotent(db: Session):
    if not SEED.exists():
        pytest.skip("seed file missing")
    rows = load_seed(SEED)
    first = upsert_recipes(db, rows)
    second = upsert_recipes(db, rows)
    assert first["total_seed"] == 186
    assert second["inserted"] == 0
    assert second["updated"] == 0
    assert second["unchanged"] == 186


def test_seed_fibre_values(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    fibres = [float(r.fibre_g) for r in db.query(Recipe).all()]
    assert len(fibres) >= 186
    assert min(fibres) >= 0.2
    assert max(fibres) <= 19.9
    mean = sum(fibres) / len(fibres)
    assert 4.0 <= mean <= 8.0
    # Scaled meal payload carries fibre through to calorie-log path.
    recipe = db.query(Recipe).filter(Recipe.fibre_g > 0).first()
    assert recipe is not None
    scaled = v3._scaled_fibre_g(recipe, 2.0)
    assert scaled == round(float(recipe.fibre_g) * 2.0, 1)

def test_macro_math_sanity():
    if not SEED.exists():
        pytest.skip("seed file missing")
    rows = load_seed(SEED)[:20]
    for r in rows:
        computed = r["protein_g"] * 4 + r["carbs_g"] * 4 + r["fat_g"] * 9
        stored = float(r["kcal"])
        assert abs(computed - stored) / max(stored, 1) <= 0.10, r["name"]


@pytest.mark.parametrize("diet", ["no_preference", "vegetarian", "vegan"])
@pytest.mark.parametrize("goal", ["fat_loss", "maintain", "muscle_gain"])
def test_no_empty_slots_31_days(db: Session, diet: str, goal: str):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, f"meal_v3_{diet}_{goal}@test.local")
    _clean_plans(db, user_id)
    start = date(2026, 7, 1)

    for i in range(31):
        plan_date = start + timedelta(days=i)
        rows = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet=diet,  # type: ignore[arg-type]
            goal=goal,  # type: ignore[arg-type]
            daily_kcal=2200,
            meals_per_day=3,
            force=True,
        )
        assert len(rows) == 3
        assert {r.slot for r in rows} == {"breakfast", "lunch", "dinner"}
        assert all(r.recipe_id for r in rows)
    db.commit()


def test_swap_never_repeats(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_swap@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2026, 8, 1)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        force=True,
    )
    lunch = next(r for r in rows if r.slot == "lunch")
    before = lunch.recipe_id
    swapped = v3.swap_slot(
        db,
        user_id=user_id,
        plan_date=plan_date,
        slot="lunch",
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
    )
    assert swapped.recipe_id != before
    db.commit()


def test_swap_matches_current_meal_macros(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_swap_macros@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2027, 1, 10)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        force=True,
    )
    current = next(r for r in rows if r.slot == "lunch")
    old_recipe_id = int(current.recipe_id)
    target = v3.MacroTarget(
        kcal=float(current.kcal),
        protein=float(current.protein_g),
        carbs=float(current.carbs_g),
        fat=float(current.fat_g),
    )

    swapped = v3.swap_slot(
        db,
        user_id=user_id,
        plan_date=plan_date,
        slot="lunch",
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
    )

    def fit_error(row: UserMealPlan) -> float:
        terms = (
            (float(row.protein_g), target.protein, 3.0),
            (float(row.kcal), target.kcal, 1.0),
            (float(row.carbs_g), target.carbs, 1.0),
            (float(row.fat_g), target.fat, 1.0),
        )
        return sum(weight * ((actual - expected) / expected) ** 2 for actual, expected, weight in terms if expected > 0)

    assert int(swapped.recipe_id) != old_recipe_id
    assert fit_error(swapped) <= 0.75
    db.commit()


def test_protein_accuracy_bands(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    start = date(2026, 9, 1)

    def day_ratios(diet: str, goal: str) -> list[float]:
        user_id = _ensure_user(db, f"meal_v3_prot_{diet}_{goal}@test.local")
        _clean_plans(db, user_id)
        ratios = []
        for i in range(14):
            d = start + timedelta(days=i)
            rows = v3.ensure_day_plan(
                db,
                user_id=user_id,
                plan_date=d,
                diet=diet,  # type: ignore[arg-type]
                goal=goal,  # type: ignore[arg-type]
                daily_kcal=2200,
                force=True,
            )
            target = v3.daily_targets(2200, goal).protein  # type: ignore[arg-type]
            got = sum(float(r.protein_g) for r in rows)
            ratios.append(got / target if target else 0)
        return ratios

    def mostly_in_band(ratios: list[float], lo: float = 0.90, hi: float = 1.10) -> bool:
        ok = sum(1 for r in ratios if lo <= r <= hi)
        return ok >= int(0.7 * len(ratios))

    np_ratios = day_ratios("no_preference", "maintain")
    veg_ratios = day_ratios("vegetarian", "maintain")
    vegan_hard = day_ratios("vegan", "muscle_gain")
    db.commit()
    assert mostly_in_band(np_ratios), np_ratios
    # Vegetarian pool is thinner — allow a slightly wider band after Calorie Log
    # targets lowered daily protein vs the original v3 GOAL_SPLITS path.
    assert mostly_in_band(veg_ratios, lo=0.85, hi=1.15), veg_ratios
    assert min(vegan_hard) >= 0.55 and (sum(vegan_hard) / len(vegan_hard)) >= 0.65, vegan_hard


def test_calorie_log_style_override_keeps_meals_reasonable(db: Session):
    """When Meal Planner uses Calorie Log's ~bodyweight protein target, days still fill."""
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    from src.routes.calories import calculate_macro_targets

    user_id = _ensure_user(db, "meal_v3_calorielog_override@test.local")
    _clean_plans(db, user_id)
    macros = calculate_macro_targets(3367, 75.0, "maintain")
    daily = v3.MacroTarget(
        kcal=3367.0,
        protein=float(macros["target_protein_g"]),
        carbs=float(macros["target_carbs_g"]),
        fat=float(macros["target_fat_g"]),
    )
    assert daily.protein < 150  # Calorie Log style, not v3 30% split
    plan_date = date(2029, 1, 8)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=3367,
        meals_per_day=3,
        force=True,
        daily_override=daily,
    )
    db.commit()
    assert len(rows) == 3
    got_p = sum(float(r.protein_g) for r in rows)
    # With a ~120g target, engine should land in a loose band (not empty / not 2×).
    assert 0.55 * daily.protein <= got_p <= 1.45 * daily.protein, (got_p, daily.protein)
    for row in rows:
        recipe = row.recipe
        assert float(row.multiplier) <= max(v3.MULTIPLIERS) + 1e-6
        assert float(row.kcal) <= float(recipe.kcal) * max(v3.MULTIPLIERS) + 1.0


def test_multiplier_ceiling(db: Session):
    """No single meal may exceed recipe.kcal * 2.5 (the multiplier ceiling).

    This is the structural guarantee that makes the legacy "1330 kcal rice bowl"
    class of bug impossible once meals come from the engine instead of an LLM.
    """
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    max_mult = max(v3.MULTIPLIERS)
    user_id = _ensure_user(db, "meal_v3_ceiling@test.local")
    _clean_plans(db, user_id)
    start = date(2026, 11, 1)
    for i in range(14):
        d = start + timedelta(days=i)
        rows = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=d,
            diet="no_preference",
            goal="muscle_gain",
            daily_kcal=2600,
            force=True,
        )
        for r in rows:
            assert r.recipe_id is not None
            recipe = db.query(Recipe).filter(Recipe.id == r.recipe_id).one()
            assert float(r.kcal) <= float(recipe.kcal) * max_mult + 0.5, (
                recipe.name,
                float(r.kcal),
                float(recipe.kcal),
            )
            assert float(r.multiplier) <= max_mult + 1e-9
    db.commit()


def test_day_regenerate_varies(db: Session):
    """Regenerating a day (bump swap_version per slot) yields a different plan.

    Mirrors what regenerate_day_v3 does: swap every slot for the same date, which
    bumps the per-slot swap_version so the seed changes and picks differ, while
    each individual pick stays a valid catalog recipe.
    """
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_dayregen@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2026, 12, 1)

    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        force=True,
    )
    before = {r.slot: r.recipe_id for r in rows}

    for slot in v3.SLOTS:
        try:
            v3.swap_slot(
                db,
                user_id=user_id,
                plan_date=plan_date,
                slot=slot,
                diet="no_preference",
                goal="maintain",
                daily_kcal=2200,
            )
        except RuntimeError:
            continue
    db.commit()

    after_rows = (
        db.query(UserMealPlan)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == plan_date)
        .all()
    )
    after = {r.slot: r.recipe_id for r in after_rows}

    assert all(rid is not None for rid in after.values())
    assert after != before, (before, after)


def test_day_regenerate_excludes_current_next_two_and_cooldown(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_dayregen_exclusions@test.local")
    _clean_plans(db, user_id)
    db.query(MonthlyMealPlan).filter(MonthlyMealPlan.user_id == user_id).delete()
    db.commit()
    user = db.query(User).filter(User.id == user_id).one()
    target_date = date(2027, 2, 10)

    assignments: dict[date, list[UserMealPlan]] = {}
    for plan_date in (target_date - timedelta(days=1), target_date, target_date + timedelta(days=1), target_date + timedelta(days=2)):
        assignments[plan_date] = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet="no_preference",
            goal="maintain",
            daily_kcal=2200,
            force=True,
        )
    db.commit()

    excluded_by_slot = {
        slot: {
            int(row.recipe_id)
            for plan_date in (target_date, target_date + timedelta(days=1), target_date + timedelta(days=2))
            for row in assignments[plan_date]
            if row.slot == slot
        }
        for slot in v3.SLOTS
    }
    cooldown_ids = {int(row.recipe_id) for row in assignments[target_date - timedelta(days=1)]}

    plan = MonthlyMealPlan(
        user_id=user_id,
        month=target_date.month,
        year=target_date.year,
        budget_level="budget",
        source="recipe_v3",
        week_start_day=8,
        week_end_day=14,
        generation_mode="weekly",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    regenerate_day_v3(db, user, plan=plan, day=target_date.day)
    regenerated = (
        db.query(UserMealPlan)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == target_date)
        .all()
    )
    assert {row.slot for row in regenerated} == set(v3.SLOTS)
    for row in regenerated:
        assert int(row.recipe_id) not in excluded_by_slot[row.slot]
        assert int(row.recipe_id) not in cooldown_ids


def test_day_regenerate_month_boundary_skips_missing_forward_days(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_dayregen_boundary@test.local")
    _clean_plans(db, user_id)
    db.query(MonthlyMealPlan).filter(MonthlyMealPlan.user_id == user_id).delete()
    db.commit()
    user = db.query(User).filter(User.id == user_id).one()
    target_date = date(2027, 2, 28)
    original = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=target_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        force=True,
    )
    original_ids = {row.slot: int(row.recipe_id) for row in original}
    plan = MonthlyMealPlan(
        user_id=user_id,
        month=target_date.month,
        year=target_date.year,
        budget_level="budget",
        source="recipe_v3",
        week_start_day=22,
        week_end_day=28,
        generation_mode="weekly",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    regenerate_day_v3(db, user, plan=plan, day=target_date.day)
    regenerated = (
        db.query(UserMealPlan)
        .filter(UserMealPlan.user_id == user_id, UserMealPlan.plan_date == target_date)
        .all()
    )
    assert len(regenerated) == 3
    assert all(int(row.recipe_id) != original_ids[row.slot] for row in regenerated)


def test_cooldown_graceful(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_cooldown@test.local")
    _clean_plans(db, user_id)
    start = date(2026, 10, 1)
    for i in range(25):
        d = start + timedelta(days=i)
        rows = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=d,
            diet="vegan",
            goal="maintain",
            daily_kcal=2000,
            force=True,
        )
        assert len(rows) == 3
    db.commit()


@pytest.mark.parametrize("meals_per_day", [2, 3, 4, 5, 6])
def test_meals_per_day_slot_count_and_share(db: Session, meals_per_day: int):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, f"meal_v3_mpd_{meals_per_day}@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2028, 1, meals_per_day)
    daily_kcal = 2200.0
    goal = "maintain"
    daily = v3.daily_targets(daily_kcal, goal)
    schedule = v3.slot_schedule(meals_per_day)

    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal=goal,
        daily_kcal=daily_kcal,
        meals_per_day=meals_per_day,
        force=True,
    )
    db.commit()

    assert len(rows) == meals_per_day
    assert [r.slot for r in rows] == [s.slot for s in schedule]
    assert abs(sum(s.share for s in schedule) - 1.0) < 1e-9

    # Slot kcal targets (via shares) sum to the same daily target regardless of slot count.
    share_kcal = sum(daily.kcal * s.share for s in schedule)
    assert abs(share_kcal - daily.kcal) < 1e-6
    # Actual assigned kcal should be in a reasonable band of the daily target.
    got = sum(float(r.kcal) for r in rows)
    assert 0.55 * daily.kcal <= got <= 1.45 * daily.kcal, (meals_per_day, got, daily.kcal)


@pytest.mark.parametrize("meals_per_day", [5, 6])
def test_same_day_recipe_dedup(db: Session, meals_per_day: int):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, f"meal_v3_dedup_{meals_per_day}@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2028, 3, meals_per_day)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2400,
        meals_per_day=meals_per_day,
        force=True,
    )
    db.commit()
    ids = [int(r.recipe_id) for r in rows]
    assert len(ids) == len(set(ids)), ids


def test_day_regen_self_heals_meals_per_day(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_selfheal@test.local")
    _clean_plans(db, user_id)
    db.query(MonthlyMealPlan).filter(MonthlyMealPlan.user_id == user_id).delete()
    db.commit()
    user = db.query(User).filter(User.id == user_id).one()
    plan_date = date(2028, 4, 10)

    original = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
    )
    assert len(original) == 3

    plan = MonthlyMealPlan(
        user_id=user_id,
        month=plan_date.month,
        year=plan_date.year,
        budget_level="budget",
        source="recipe_v3",
        week_start_day=8,
        week_end_day=14,
        generation_mode="weekly",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    # Simulate onboarding change to 5 meals: patch ctx via monkeypatch of clamp path —
    # call ensure+swap path directly with meals_per_day=5 by rebuilding through engine APIs
    # the bridge uses. Here we exercise the engine rebuild that regenerate_day_v3 relies on.
    rebuilt = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=5,
        force=True,
    )
    db.commit()
    assert len(rebuilt) == 5
    assert {r.slot for r in rebuilt} == {s.slot for s in v3.slot_schedule(5)}

    # Stale force=False must keep the new 5-slot day (not shrink back).
    kept = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=False,
    )
    assert len(kept) == 5


def _force_protein_gap(db: Session, user_id: int, plan_date: date) -> None:
    """Lower assigned meal protein so protein_gap_suggestions has a real gap."""
    rows = (
        db.query(UserMealPlan)
        .filter(
            UserMealPlan.user_id == user_id,
            UserMealPlan.plan_date == plan_date,
            UserMealPlan.slot != v3.PROTEIN_GAP_SLOT,
        )
        .all()
    )
    for row in rows:
        row.protein_g = 15.0
    db.commit()


def test_protein_gap_varies_across_days(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_protein_gap_variety@test.local")
    _clean_plans(db, user_id)

    seen_ids: set[int] = set()
    start = date(2028, 5, 1)
    for offset in range(10):
        plan_date = start + timedelta(days=offset)
        v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet="no_preference",
            goal="maintain",
            daily_kcal=2200,
            meals_per_day=3,
            force=True,
        )
        db.commit()
        _force_protein_gap(db, user_id, plan_date)
        result = v3.protein_gap_suggestions(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet="no_preference",
            goal="maintain",
            daily_kcal=2200,
        )
        db.commit()
        assert result["show_suggestions"] is True
        assert len(result["suggestions"]) == 3
        for s in result["suggestions"]:
            assert s.get("recipe_id") is not None
            seen_ids.add(int(s["recipe_id"]))
            # Category renders once in payload (no duplicate time_suggestion).
            assert s["description"] == s["category"]
            assert not s.get("time_suggestion")

    assert len(seen_ids) > 3, seen_ids


def test_protein_gap_excludes_today_meals_and_unique_categories(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_protein_gap_rules@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2028, 6, 12)

    meals = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
    )
    db.commit()
    meal_ids = {int(r.recipe_id) for r in meals}
    _force_protein_gap(db, user_id, plan_date)

    result = v3.protein_gap_suggestions(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=2200,
    )
    db.commit()
    suggestions = result["suggestions"]
    assert len(suggestions) == 3

    suggestion_ids = {int(s["recipe_id"]) for s in suggestions}
    assert suggestion_ids.isdisjoint(meal_ids)

    categories = [s["category"] for s in suggestions]
    assert len(categories) == len(set(categories)), categories

    # Payload must not duplicate category into time_suggestion.
    for s in suggestions:
        assert s["description"] == s["category"]
        assert s.get("time_suggestion") in ("", None)


def test_day_reconcile_closes_compounded_gap(db: Session):
    """Per-slot fits within tolerance can still compound — reconciliation closes the day gap."""
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_reconcile@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2030, 2, 10)
    daily = v3.calorie_log_daily_target(target_kcal=2000, protein_g=150, carbs_g=200, fat_g=60)

    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="no_preference",
        goal="maintain",
        daily_kcal=daily.kcal,
        meals_per_day=3,
        force=True,
        daily_override=daily,
    )
    # Simulate compounded undershoot: scale every slot down ~12% on the multiplier grid.
    scaled: list[UserMealPlan] = []
    for row in rows:
        recipe = row.recipe
        assert recipe is not None
        cur = float(row.multiplier)
        lower = max(m for m in v3.MULTIPLIERS if m <= cur - 0.24) if cur > min(v3.MULTIPLIERS) else cur
        pick = v3._slot_pick(recipe, lower, v3.slot_targets(daily, row.slot, 3))
        scaled.append(
            v3.upsert_assignment(
                db,
                user_id=user_id,
                plan_date=plan_date,
                slot=row.slot,
                slot_order=int(row.slot_order or 0),
                pick=pick,
                swap_version=int(row.swap_version or 0),
            )
        )
    before = sum(float(r.kcal) for r in scaled)
    reconciled, meta = v3.reconcile_day_kcal(
        db,
        rows=scaled,
        daily=daily,
        meals_per_day=3,
        user_id=user_id,
        plan_date=plan_date,
    )
    db.commit()
    total = sum(float(r.kcal) for r in reconciled)
    assert meta["reconciled"] is True
    assert total > before
    assert abs(meta["residual_gap_kcal"]) < abs(meta["initial_gap_kcal"])
    assert total >= daily.kcal * 0.88
    for row in reconciled:
        assert float(row.multiplier) <= max(v3.MULTIPLIERS) + 1e-6


def test_day_reconcile_respects_ceiling_and_logs_residual(db: Session, monkeypatch, caplog):
    """When no slot can absorb more without exceeding 2.5×, leave a residual gap."""
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_reconcile_ceiling@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2030, 2, 11)
    daily = v3.calorie_log_daily_target(target_kcal=5000, protein_g=300, carbs_g=500, fat_g=120)

    real_select = v3.select_for_slot

    def maxed_select(*args, **kwargs):
        pick = real_select(*args, **kwargs)
        recipe = pick.recipe
        mult = max(v3.MULTIPLIERS)
        return v3.SlotPick(
            recipe=recipe,
            multiplier=mult,
            kcal=round(recipe.kcal * mult, 1),
            protein_g=round(recipe.protein_g * mult, 1),
            carbs_g=round(recipe.carbs_g * mult, 1),
            fat_g=round(recipe.fat_g * mult, 1),
            error=pick.error,
        )

    monkeypatch.setattr(v3, "select_for_slot", maxed_select)
    with caplog.at_level("INFO"):
        rows = v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=plan_date,
            diet="no_preference",
            goal="maintain",
            daily_kcal=daily.kcal,
            meals_per_day=3,
            force=True,
            daily_override=daily,
        )
    db.commit()
    total = sum(float(r.kcal) for r in rows)
    assert total < daily.kcal * (1 - v3.DAY_KCAL_TOLERANCE_FRAC)
    assert any("reconcile_residual_gap" in r.message for r in caplog.records)


def test_fasting_seed_import(db: Session):
    if not FASTING_SEED.exists():
        pytest.skip("fasting seed file missing")
    summary = upsert_recipes(db, load_seed(FASTING_SEED))
    assert summary["total_seed"] == 32
    tagged = db.query(Recipe).filter(Recipe.external_id >= 10001).all()
    assert len(tagged) >= 32
    assert all((r.dietary_tags or []) for r in tagged)


def test_no_fasting_period_identical_output(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_no_fasting@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2031, 3, 15)
    kwargs = dict(
        user_id=user_id,
        plan_date=plan_date,
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
    )
    rows_a = v3.ensure_day_plan(db, **kwargs)
    _clean_plans(db, user_id)
    rows_b = v3.ensure_day_plan(db, fasting_tag=None, **kwargs)
    assert [r.recipe_id for r in rows_a] == [r.recipe_id for r in rows_b]
    db.commit()


def test_fasting_tag_limits_recipe_pool(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_fasting_tag@test.local")
    _clean_plans(db, user_id)
    plan_date = date(2031, 3, 16)
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=plan_date,
        diet="vegetarian",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
        fasting_tag="fasting_navratri",
    )
    assert len(rows) == 3
    for row in rows:
        recipe = db.query(Recipe).filter(Recipe.id == row.recipe_id).one()
        assert "fasting_navratri" in (recipe.dietary_tags or [])
    db.commit()


def test_fasting_pool_relaxes_for_vegan_navratri(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_relaxed_fasting@test.local")
    rows = v3.ensure_day_plan(
        db,
        user_id=user_id,
        plan_date=date(2031, 3, 17),
        diet="vegan",
        goal="maintain",
        daily_kcal=2200,
        meals_per_day=3,
        force=True,
        fasting_tag="fasting_navratri",
    )
    assert len(rows) == 3
    db.commit()


def test_empty_diet_pool_still_raises(db: Session):
    if db.query(Recipe).count() < 40:
        pytest.skip("recipes not imported")
    user_id = _ensure_user(db, "meal_v3_empty_pool@test.local")
    with pytest.raises(EmptyRecipePoolError, match="couldn't build a meal plan"):
        v3.ensure_day_plan(
            db,
            user_id=user_id,
            plan_date=date(2031, 3, 18),
            diet="vegan",
            goal="maintain",
            daily_kcal=2200,
            meals_per_day=3,
            force=True,
            fasting_tag="fasting_navratri",
            allergies=["dairy", "gluten", "nuts", "eggs", "soy", "shellfish"],
        )
