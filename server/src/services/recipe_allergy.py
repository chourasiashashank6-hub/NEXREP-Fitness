"""Map onboarding allergy tags to recipe ingredient keys for meal-engine filtering."""

from __future__ import annotations

from src.models.recipes import Recipe

# Ingredient `key` substrings that indicate an allergen presence.
ALLERGY_INGREDIENT_MARKERS: dict[str, tuple[str, ...]] = {
    "dairy": (
        "milk",
        "paneer",
        "curd",
        "yogurt",
        "cheese",
        "ghee",
        "butter",
        "whey",
        "hung_curd",
        "cottage",
        "feta",
        "cream",
    ),
    "gluten": (
        "wheat",
        "bread",
        "pasta",
        "seitan",
        "wrap",
        "noodle",
        "atta",
        "barley",
        "rye",
    ),
    "nuts": (
        "peanut",
        "almond",
        "cashew",
        "walnut",
        "pistachio",
        "hazelnut",
        "pecan",
        "macadamia",
    ),
    "eggs": ("egg",),
    "soy": ("soy", "tofu", "tempeh", "edamame"),
    "shellfish": ("prawn", "shrimp", "crab", "lobster", "mussel", "oyster", "shellfish"),
}


def _ingredient_keys(recipe: Recipe) -> list[str]:
    keys: list[str] = []
    for item in recipe.items or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip().lower()
        label = str(item.get("label") or "").strip().lower()
        if key:
            keys.append(key)
        if label and label not in keys:
            keys.append(label)
    return keys


def recipe_contains_allergen(recipe: Recipe, allergy: str) -> bool:
    markers = ALLERGY_INGREDIENT_MARKERS.get(str(allergy).strip().lower())
    if not markers:
        return False
    keys = _ingredient_keys(recipe)
    return any(any(marker in key for marker in markers) for key in keys)


def filter_recipes_by_allergies(recipes: list[Recipe], allergies: list[str] | None) -> list[Recipe]:
    if not allergies:
        return recipes
    blocked = {str(a).strip().lower() for a in allergies if str(a).strip()}
    if not blocked:
        return recipes
    return [r for r in recipes if not any(recipe_contains_allergen(r, allergy) for allergy in blocked)]
