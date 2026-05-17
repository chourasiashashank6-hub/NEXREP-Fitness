"""Protein gap suggestions (Groq + fallback) and rule-based supplement recommendations."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.http_client import post_json
from src.models.meal_plan import MonthlyMealPlan
from src.models.models import User
from src.services.planner_common import parse_local_date, safe_json_loads

logger = logging.getLogger(__name__)

PROTEIN_SUGGESTION_SYSTEM_PROMPT = """
You are a sports nutritionist. The user has a protein gap for today.
Return ONLY a JSON object with key "suggestions" containing an array of exactly 3-5 objects.

Each suggestion object has keys:
- "icon": one of "shake", "bar", "egg", "meal", "dairy", "legume", "meat"
- "title": string, max 8 words (e.g. "Add a whey protein shake")
- "description": string, 1-2 sentences explaining what to take and how much
- "protein_g": number (how many grams of protein this adds)
- "time_suggestion": string (e.g. "Post-workout", "Before bed", "Mid-morning", "With dinner")
- "estimated_cost_inr": number (realistic cost in INR)

Rules:
- Suggestions must be practical and immediately actionable.
- Mix quick options (shake, bar) with food options (eggs, curd, paneer).
- Prefer budget-friendly options if budget_level is "budget".
- Respect diet_type (no meat suggestions for vegetarian users).
- Respect allergies strictly.
- Suggestions should collectively cover the full protein_gap_g.
- Keep each suggestion realistic — do not suggest 200g of chicken if gap is only 20g.
"""

PROTEIN_FALLBACK_BY_DIET: dict[str, list[dict[str, Any]]] = {
    "vegetarian": [
        {
            "icon": "shake",
            "title": "Whey protein shake",
            "description": "Mix 1 scoop (30g) whey protein in 250ml water or milk.",
            "protein_g": 24,
            "time_suggestion": "Post-workout or morning",
            "estimated_cost_inr": 80,
        },
        {
            "icon": "dairy",
            "title": "Paneer snack (100g)",
            "description": "Have 100g raw or grilled paneer as a snack.",
            "protein_g": 18,
            "time_suggestion": "Mid-afternoon",
            "estimated_cost_inr": 35,
        },
        {
            "icon": "egg",
            "title": "Boiled eggs (3)",
            "description": "3 boiled eggs add clean protein with minimal prep.",
            "protein_g": 18,
            "time_suggestion": "With breakfast or as a snack",
            "estimated_cost_inr": 18,
        },
        {
            "icon": "dairy",
            "title": "Greek yogurt / thick curd (200g)",
            "description": "200g hung curd or Greek yogurt before bed supports overnight recovery.",
            "protein_g": 14,
            "time_suggestion": "Before bed",
            "estimated_cost_inr": 30,
        },
    ],
    "vegan": [
        {
            "icon": "shake",
            "title": "Plant protein shake",
            "description": "Mix 1 scoop pea or soy protein in water.",
            "protein_g": 20,
            "time_suggestion": "Post-workout",
            "estimated_cost_inr": 90,
        },
        {
            "icon": "legume",
            "title": "Sprouted moong (150g)",
            "description": "150g sprouted moong chaat gives plant protein and fibre.",
            "protein_g": 15,
            "time_suggestion": "Evening snack",
            "estimated_cost_inr": 15,
        },
        {
            "icon": "legume",
            "title": "Roasted chana (60g)",
            "description": "60g roasted Bengal gram is a high-protein portable snack.",
            "protein_g": 12,
            "time_suggestion": "Mid-morning",
            "estimated_cost_inr": 10,
        },
    ],
    "standard": [
        {
            "icon": "shake",
            "title": "Whey protein shake",
            "description": "Mix 1 scoop (30g) whey protein in 250ml water or milk.",
            "protein_g": 24,
            "time_suggestion": "Post-workout or morning",
            "estimated_cost_inr": 80,
        },
        {
            "icon": "egg",
            "title": "Boiled eggs (3)",
            "description": "3 boiled eggs add clean protein with minimal prep.",
            "protein_g": 18,
            "time_suggestion": "With breakfast or as a snack",
            "estimated_cost_inr": 18,
        },
        {
            "icon": "meat",
            "title": "Grilled chicken breast (150g)",
            "description": "150g grilled chicken adds 47g protein — ideal for lunch or dinner add-on.",
            "protein_g": 47,
            "time_suggestion": "With lunch or dinner",
            "estimated_cost_inr": 80,
        },
        {
            "icon": "dairy",
            "title": "Cottage cheese / paneer (100g)",
            "description": "100g paneer adds 18g protein and is easy to add to any meal.",
            "protein_g": 18,
            "time_suggestion": "Any meal",
            "estimated_cost_inr": 35,
        },
    ],
}

_protein_suggestion_cache: dict[str, dict[str, Any]] = {}
_supplement_cache: dict[str, dict[str, Any]] = {}

_PROTEIN_CACHE_SECONDS = 1800
_SUPPLEMENT_CACHE_SECONDS = 86400


def _supplement_onboarding_ctx(db: Session, user_id: int) -> dict[str, Any]:
    from src.services.meal_planner_service import _onboarding_context

    onboarding, _ = _onboarding_context(db, user_id)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    return {
        "goal": str(goal.get("type") or "maintain"),
        "diet_type": str(dietary.get("diet_type") or "standard"),
        "activity_level": str(activity.get("level") or "moderately_active"),
        "age": int(personal.get("age") or 25),
        "region": str(app_setup.get("region") or "IN"),
    }


def get_fallback_protein_suggestions(diet_type: str, protein_gap: int) -> list[dict[str, Any]]:
    options = PROTEIN_FALLBACK_BY_DIET.get(diet_type, PROTEIN_FALLBACK_BY_DIET["standard"])
    suggestions: list[dict[str, Any]] = []
    covered = 0
    for s in options:
        if covered >= protein_gap:
            break
        suggestions.append(dict(s))
        covered += int(s["protein_g"])
    return suggestions[:5]


def _get_cached_protein(user_id: int, day: int, local_date: str) -> dict[str, Any] | None:
    key = f"{user_id}:{day}:{local_date}"
    cached = _protein_suggestion_cache.get(key)
    if cached and (datetime.now() - cached["cached_at"]).total_seconds() < _PROTEIN_CACHE_SECONDS:
        return cached["data"]
    return None


def _set_cached_protein(user_id: int, day: int, local_date: str, data: dict[str, Any]) -> None:
    key = f"{user_id}:{day}:{local_date}"
    _protein_suggestion_cache[key] = {"data": data, "cached_at": datetime.now()}


def _get_cached_supplements(user_id: int) -> dict[str, Any] | None:
    cached = _supplement_cache.get(str(user_id))
    if cached and (datetime.now() - cached["cached_at"]).total_seconds() < _SUPPLEMENT_CACHE_SECONDS:
        return cached["data"]
    return None


def _set_cached_supplements(user_id: int, data: dict[str, Any]) -> None:
    _supplement_cache[str(user_id)] = {"data": data, "cached_at": datetime.now()}


def _groq_protein_suggestions(system_prompt: str, user_msg: dict[str, Any]) -> list[dict[str, Any]]:
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
            "temperature": 0.4,
            "max_tokens": 600,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_msg)},
            ],
        },
        timeout=30,
    )
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = json.loads(content.replace("```json", "").replace("```", "").strip())
    suggestions = parsed.get("suggestions") if isinstance(parsed, dict) else None
    if not isinstance(suggestions, list):
        raise ValueError("Invalid protein suggestions response")
    out: list[dict[str, Any]] = []
    for s in suggestions[:5]:
        if isinstance(s, dict) and s.get("title"):
            out.append(s)
    return out


def compute_supplement_recommendations(onboarding_ctx: dict) -> dict[str, Any]:
    """
    Returns 4-5 supplements laser-focused on the user's primary goal.
    No universal filler — every supplement must directly serve the goal.
    """
    goal = onboarding_ctx.get("goal", "maintain")
    diet_type = onboarding_ctx.get("diet_type", "standard")

    is_vegetarian = diet_type in ("vegetarian", "vegan")
    is_vegan = diet_type == "vegan"

    if goal == "muscle_gain":
        supplements = [
            {
                "name": "Creatine Monohydrate",
                "icon": "power",
                "dose": "5g daily",
                "when": "Post-workout with carbs",
                "benefit": "Increases strength and muscle volume — most researched supplement for muscle gain.",
                "tags": ["Strength", "Muscle gain"],
            },
            {
                "name": "Whey Protein" if not is_vegan else "Plant Protein (Pea/Soy)",
                "icon": "shake",
                "dose": "1 scoop (25-30g protein) per day",
                "when": "Within 30 min post-workout or between meals",
                "benefit": "Fills protein gaps that food alone often can't cover. Critical for muscle repair and growth.",
                "tags": ["Muscle repair", "Protein"],
            },
            {
                "name": "Vitamin D3 + K2",
                "icon": "sun",
                "dose": "2000 IU D3 + 100mcg K2",
                "when": "With your largest meal",
                "benefit": "Low D3 directly suppresses testosterone and muscle protein synthesis. Most Indians are deficient.",
                "tags": ["Testosterone", "Muscle function"],
            },
            {
                "name": "Magnesium Glycinate",
                "icon": "mineral",
                "dose": "300-400mg",
                "when": "30 min before bed",
                "benefit": "Supports deep sleep — where 80% of muscle repair happens. Also reduces next-day soreness.",
                "tags": ["Recovery", "Sleep quality"],
            },
            {
                "name": "Zinc" if not is_vegetarian else "Zinc + Iron",
                "icon": "mineral",
                "dose": "25-40mg zinc",
                "when": "With dinner (away from calcium foods)",
                "benefit": "Heavy training depletes zinc through sweat. Low zinc = low testosterone = poor muscle growth.",
                "tags": ["Testosterone", "Immunity"],
            },
        ]

    elif goal == "fat_loss":
        supplements = [
            {
                "name": "Whey Protein" if not is_vegan else "Plant Protein (Pea/Soy)",
                "icon": "shake",
                "dose": "1 scoop (25-30g) per day",
                "when": "With breakfast or post-workout",
                "benefit": "High protein preserves muscle while in a calorie deficit — without it you lose muscle, not just fat.",
                "tags": ["Muscle preservation", "Satiety"],
            },
            {
                "name": "L-Carnitine",
                "icon": "metabolic",
                "dose": "1.5-2g",
                "when": "30 min before cardio on an empty stomach",
                "benefit": "Transports fat into mitochondria to be burned as energy. Most effective when combined with cardio.",
                "tags": ["Fat burning", "Energy"],
            },
            {
                "name": "Vitamin D3",
                "icon": "sun",
                "dose": "2000 IU",
                "when": "With your main meal",
                "benefit": "Vitamin D deficiency is linked to fat storage and metabolic slowdown. Correcting it supports fat loss.",
                "tags": ["Metabolism", "Hormones"],
            },
            {
                "name": "Magnesium Glycinate",
                "icon": "mineral",
                "dose": "300mg",
                "when": "Before bed",
                "benefit": "Poor sleep increases cortisol and hunger hormones — making fat loss nearly impossible. Magnesium fixes this.",
                "tags": ["Sleep", "Cortisol control"],
            },
            {
                "name": "Green Tea Extract (EGCG)",
                "icon": "leaf",
                "dose": "400mg EGCG or 2-3 cups green tea",
                "when": "Morning or pre-workout (not after 3 PM)",
                "benefit": "Mildly boosts fat oxidation and metabolism. Works best when combined with exercise.",
                "tags": ["Fat oxidation", "Metabolism"],
            },
        ]

    elif goal == "strength":
        supplements = [
            {
                "name": "Creatine Monohydrate",
                "icon": "power",
                "dose": "5g daily",
                "when": "Any time — consistency over timing",
                "benefit": "The single most evidence-backed supplement for strength. Increases ATP output for heavier lifts.",
                "tags": ["Strength", "Power output"],
            },
            {
                "name": "Whey Protein" if not is_vegan else "Plant Protein",
                "icon": "shake",
                "dose": "1-2 scoops per day",
                "when": "Post-workout",
                "benefit": "Strength training demands high protein. Whey ensures fast delivery to muscles after heavy sessions.",
                "tags": ["Muscle repair", "Recovery"],
            },
            {
                "name": "Magnesium Glycinate",
                "icon": "mineral",
                "dose": "400mg",
                "when": "Before bed",
                "benefit": "Supports neuromuscular function — the connection between your nervous system and muscles. Critical for lifting heavy.",
                "tags": ["Neuromuscular", "Sleep", "Recovery"],
            },
            {
                "name": "Vitamin D3 + K2",
                "icon": "sun",
                "dose": "3000 IU D3 + 100mcg K2",
                "when": "With a meal",
                "benefit": "D3 directly supports muscle fiber strength and testosterone. K2 keeps calcium in bones — not joints.",
                "tags": ["Bone strength", "Testosterone"],
            },
            {
                "name": "Omega-3 Fish Oil" if not is_vegan else "Algae Omega-3",
                "icon": "fish",
                "dose": "3g EPA+DHA",
                "when": "With meals",
                "benefit": "Reduces joint inflammation from heavy lifting. Protects tendons and connective tissue over time.",
                "tags": ["Joint health", "Anti-inflammatory"],
            },
        ]

    elif goal == "recomp":
        supplements = [
            {
                "name": "Creatine Monohydrate",
                "icon": "power",
                "dose": "5g daily",
                "when": "Post-workout",
                "benefit": "Supports muscle gain while in a slight deficit — the exact requirement for body recomposition.",
                "tags": ["Muscle gain", "Strength"],
            },
            {
                "name": "Whey Protein" if not is_vegan else "Plant Protein",
                "icon": "shake",
                "dose": "1-2 scoops per day",
                "when": "Post-workout or between meals",
                "benefit": "High protein is the #1 requirement for recomp — you need to simultaneously lose fat and build muscle.",
                "tags": ["Muscle preservation", "Fat loss"],
            },
            {
                "name": "Vitamin D3 + K2",
                "icon": "sun",
                "dose": "2000 IU D3",
                "when": "With your main meal",
                "benefit": "Supports hormonal balance required for simultaneous fat loss and muscle gain.",
                "tags": ["Hormones", "Metabolism"],
            },
            {
                "name": "Magnesium Glycinate",
                "icon": "mineral",
                "dose": "300-400mg",
                "when": "Before bed",
                "benefit": "Deep sleep is critical for recomp — muscle repairs and fat is metabolized during sleep.",
                "tags": ["Recovery", "Sleep"],
            },
            {
                "name": "Omega-3 Fish Oil" if not is_vegan else "Algae Omega-3",
                "icon": "fish",
                "dose": "2-3g EPA+DHA",
                "when": "With meals",
                "benefit": "Reduces muscle inflammation from training while supporting fat oxidation — dual benefit for recomp.",
                "tags": ["Anti-inflammatory", "Fat oxidation"],
            },
        ]

    else:
        supplements = [
            {
                "name": "Vitamin D3 + K2",
                "icon": "sun",
                "dose": "2000 IU D3 + 100mcg K2",
                "when": "With your main meal",
                "benefit": "The most common deficiency in India. Affects energy, immunity, mood, and bone health.",
                "tags": ["Immunity", "Energy", "Bone health"],
            },
            {
                "name": "Magnesium Glycinate",
                "icon": "mineral",
                "dose": "300mg",
                "when": "Before bed",
                "benefit": "Most people are deficient. Improves sleep quality, reduces stress, and prevents muscle cramps.",
                "tags": ["Sleep", "Stress", "Recovery"],
            },
            {
                "name": "Omega-3 Fish Oil" if not is_vegan else "Algae Omega-3",
                "icon": "fish",
                "dose": "2g EPA+DHA",
                "when": "With meals",
                "benefit": "Supports heart health, reduces inflammation, improves skin quality and joint comfort.",
                "tags": ["Heart health", "Skin", "Joints"],
            },
            {
                "name": "Vitamin B12",
                "icon": "pill",
                "dose": "500mcg",
                "when": "Morning with breakfast",
                "benefit": "Deficiency causes fatigue, brain fog, and nerve damage. Critical if you eat limited animal products.",
                "tags": ["Energy", "Brain health"],
            },
        ]

    if is_vegetarian and goal not in ("maintain",):
        iron_supp = {
            "name": "Iron + Vitamin C",
            "icon": "mineral",
            "dose": "25mg elemental iron + 500mg Vitamin C",
            "when": "Morning on empty stomach",
            "benefit": "Plant-based diets have poor iron absorption. Low iron causes fatigue that tanks workout performance.",
            "tags": ["Energy", "Endurance"],
        }
        supplements[-1] = iron_supp

    goal_labels = {
        "muscle_gain": "Muscle Gain",
        "fat_loss": "Fat Loss",
        "strength": "Strength",
        "recomp": "Body Recomposition",
        "maintain": "General Health",
    }

    return {
        "goal": goal,
        "goal_label": goal_labels.get(goal, "Your Goal"),
        "supplements": supplements,
        "total_count": len(supplements),
    }


def _resolve_plan_for_day(
    db: Session, user_id: int, month: int, year: int, day: int, plan_id: int | None
) -> MonthlyMealPlan | None:
    if plan_id:
        return (
            db.query(MonthlyMealPlan)
            .filter(MonthlyMealPlan.id == plan_id, MonthlyMealPlan.user_id == user_id)
            .first()
        )
    weekly = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
            MonthlyMealPlan.week_start_day <= day,
            MonthlyMealPlan.week_end_day >= day,
        )
        .first()
    )
    if weekly:
        return weekly
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "monthly",
        )
        .first()
    )


def protein_suggestions_response(
    db: Session,
    user: User,
    *,
    day: int,
    plan_id: int | None,
    local_date: str | None,
) -> dict[str, Any]:
    from src.services.meal_planner_service import _build_meal_ctx, _plan_targets_dict

    today = parse_local_date(local_date)
    local_key = today.isoformat()

    cached = _get_cached_protein(user.id, day, local_key)
    if cached:
        return cached

    plan = _resolve_plan_for_day(db, user.id, today.month, today.year, day, plan_id)

    if not plan:
        return {
            "protein_gap_g": 0,
            "target_protein_g": 0,
            "consumed_protein_g": 0,
            "gap_pct": 0,
            "show_suggestions": False,
            "suggestions": [],
        }

    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        return {
            "protein_gap_g": 0,
            "target_protein_g": 0,
            "consumed_protein_g": 0,
            "gap_pct": 0,
            "show_suggestions": False,
            "suggestions": [],
        }

    targets = _plan_targets_dict(plan, db, user)
    target_protein = int(targets.get("protein_g") or 0)
    consumed = int(entry.total_protein_g or 0)
    gap = max(0, target_protein - consumed)
    gap_pct = int(round((gap / target_protein) * 100)) if target_protein > 0 else 0

    base = {
        "protein_gap_g": gap,
        "target_protein_g": target_protein,
        "consumed_protein_g": consumed,
        "gap_pct": gap_pct,
        "show_suggestions": gap > 10,
        "suggestions": [],
    }

    if gap <= 10:
        _set_cached_protein(user.id, day, local_key, base)
        return base

    ctx = _build_meal_ctx(db, user)
    meals = safe_json_loads(entry.meals_json)
    meal_types = [
        str(m.get("meal_type"))
        for m in (meals if isinstance(meals, list) else [])
        if isinstance(m, dict) and m.get("meal_type")
    ]

    user_msg = {
        "protein_gap_g": gap,
        "already_consumed_protein_g": consumed,
        "target_protein_g": target_protein,
        "meals_already_planned": meal_types,
        "time_of_day": f"hour {datetime.now().hour}",
        "diet_type": ctx["diet_type"],
        "allergies": ctx["allergies"],
        "budget_level": plan.budget_level or "budget",
        "goal": ctx["goal"],
        "region": ctx["region"],
    }

    suggestions: list[dict[str, Any]] = []
    try:
        if settings.GROQ_API_KEY:
            suggestions = _groq_protein_suggestions(PROTEIN_SUGGESTION_SYSTEM_PROMPT, user_msg)
    except Exception as exc:
        logger.warning("[ProteinSuggestions] Groq failed: %s", exc)
        suggestions = []

    if not suggestions:
        suggestions = get_fallback_protein_suggestions(str(ctx["diet_type"]), gap)

    result = {**base, "suggestions": suggestions}
    _set_cached_protein(user.id, day, local_key, result)
    return result


def _is_goal_focused_supplement_payload(data: dict[str, Any]) -> bool:
    if "goal_label" not in data:
        return False
    supps = data.get("supplements")
    if not isinstance(supps, list) or not supps:
        return True
    first = supps[0]
    return isinstance(first, dict) and "benefit" in first and "tags" in first


def supplement_recommendations_response(db: Session, user: User) -> dict[str, Any]:
    cached = _get_cached_supplements(user.id)
    if cached and _is_goal_focused_supplement_payload(cached):
        return cached

    ctx = _supplement_onboarding_ctx(db, user.id)
    result = compute_supplement_recommendations(ctx)
    _set_cached_supplements(user.id, result)
    return result
