"""Catalog-wide allergy mapping audit — uses seed JSON, no live DB."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.services.recipe_allergy import (
    ALLERGY_INGREDIENT_MARKERS,
    filter_recipes_by_allergies,
    recipe_contains_allergen,
)

SEED_FILES = ("nexrep_recipes_seed.json", "nexrep_fasting_recipes_seed.json")

# Ingredient keys in the catalog that should always trip the corresponding allergy.
CATALOG_NUT_SYNONYMS = (
    "peanut",
    "peanuts",
    "almond",
    "cashew",
    "walnut",
    "pistachio",
    "hazelnut",
    "pecan",
    "macadamia",
)
CATALOG_DAIRY_SYNONYMS = (
    "paneer",
    "ghee",
    "milk",
    "curd",
    "cheese",
    "whey",
    "butter",
    "cottage",
    "feta",
    "cream",
    "hung_curd",
    "yogurt",
)


def _load_catalog_recipes() -> list[SimpleNamespace]:
    root = Path(__file__).resolve().parents[1]
    recipes: list[SimpleNamespace] = []
    for filename in SEED_FILES:
        path = root / filename
        if not path.exists():
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        for row in rows:
            recipes.append(SimpleNamespace(name=row.get("name"), items=row.get("items") or []))
    if not recipes:
        pytest.skip("recipe seed files not found")
    return recipes


def _ingredient_keys(recipe: SimpleNamespace) -> list[str]:
    keys: list[str] = []
    for item in recipe.items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip().lower()
        label = str(item.get("label") or "").strip().lower()
        if key:
            keys.append(key)
        if label:
            keys.append(label)
    return keys


@pytest.mark.parametrize("allergy,markers", list(ALLERGY_INGREDIENT_MARKERS.items()))
def test_allergy_marker_table_is_documented(allergy: str, markers: tuple[str, ...]):
    assert allergy in {"dairy", "gluten", "nuts", "eggs", "soy", "shellfish"}
    assert markers


def test_catalog_nut_synonyms_are_flagged_for_nuts_allergy():
    catalog = _load_catalog_recipes()
    misses: list[str] = []
    for recipe in catalog:
        keys = _ingredient_keys(recipe)
        if any(any(syn in key for syn in CATALOG_NUT_SYNONYMS) for key in keys):
            if not recipe_contains_allergen(recipe, "nuts"):
                misses.append(f"{recipe.name}: {keys}")
    assert not misses, "Nut-like ingredients not flagged:\n" + "\n".join(misses[:20])


def test_catalog_dairy_synonyms_are_flagged_for_dairy_allergy():
    catalog = _load_catalog_recipes()
    misses: list[str] = []
    for recipe in catalog:
        keys = _ingredient_keys(recipe)
        if any(any(syn in key for syn in CATALOG_DAIRY_SYNONYMS) for key in keys):
            if not recipe_contains_allergen(recipe, "dairy"):
                misses.append(f"{recipe.name}: {keys}")
    assert not misses, "Dairy-like ingredients not flagged:\n" + "\n".join(misses[:20])


def test_nuts_allergy_excludes_every_catalog_recipe_with_nut_synonyms():
    catalog = _load_catalog_recipes()
    nutty = [
        r
        for r in catalog
        if any(any(syn in key for syn in CATALOG_NUT_SYNONYMS) for key in _ingredient_keys(r))
    ]
    assert nutty, "expected at least one nut-containing recipe in catalog"
    safe = filter_recipes_by_allergies(catalog, ["nuts"])
    leaked = [r.name for r in nutty if r in safe]
    assert not leaked, f"nut allergy pool still includes: {leaked[:10]}"


def test_dairy_allergy_excludes_paneer_and_ghee_recipes():
    catalog = _load_catalog_recipes()
    dairy_recipes = [
        r
        for r in catalog
        if any(any(syn in key for syn in ("paneer", "ghee", "milk_whole", "curd_plain")) for key in _ingredient_keys(r))
    ]
    assert dairy_recipes, "expected dairy recipes in catalog"
    safe = filter_recipes_by_allergies(catalog, ["dairy"])
    leaked = [r.name for r in dairy_recipes if r in safe]
    assert not leaked, f"dairy allergy pool still includes: {leaked[:10]}"
