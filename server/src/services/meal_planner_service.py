from __future__ import annotations

import json
import logging
import random
from datetime import date, datetime
from typing import Any

logger = logging.getLogger(__name__)

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.http_client import post_json
from src.models.meal_plan import DailyMealPlanEntry, MonthlyMealPlan
from src.models.models import User, UserOnboarding
from src.services.planner_common import (
    day_flags,
    days_chunks_from_range,
    days_in_month,
    month_chunks,
    parse_groq_json_array,
    parse_local_date,
    safe_json_dumps,
    safe_json_loads,
)
from src.services.planner_swap_limits import (
    SWAP_LIMIT_PER_DAY,
    SwapLimitExceeded,
    check_swap_allowed,
    get_swap_count,
    increment_swap,
)

MEAL_SYSTEM_PROMPT_BASE = """You are an expert Indian sports nutritionist who creates diverse, region-specific meal plans.
Generate a 7-day meal plan as a JSON object with key "days" containing an array of 7 day objects.

CRITICAL DIVERSITY RULES (MOST IMPORTANT):
- You MUST use at least 35 DIFFERENT food items across the 7 days. Do NOT repeat the same food more than twice in the entire week.
- Each day's breakfast MUST be a different dish (e.g. Day 1: Poha, Day 2: Idli-Sambar, Day 3: Paratha with curd, Day 4: Upma, Day 5: Dosa, Day 6: Besan chilla, Day 7: Oats with fruits).
- Each day's lunch MUST have a different main dish (e.g. Day 1: Rajma chawal, Day 2: Chole with roti, Day 3: Dal tadka with rice, Day 4: Kadhi chawal, Day 5: Paneer curry with paratha, Day 6: Chicken curry with rice, Day 7: Egg curry with roti).
- Each day's dinner MUST be a different combination from lunch.
- Snacks must vary: rotate between fruits, dry fruits, sprouts, makhana, roasted chana, protein shake, buttermilk, peanut butter toast, etc.
- Include regional variety: South Indian (dosa, idli, uttapam), North Indian (paratha, chole, rajma), West Indian (poha, dhokla, thepla), and common items (oats, eggs, salads).

Each day object has keys:
- "day": integer (the day number provided)
- "is_cheat_day": boolean
- "meals": array of meal objects

Each meal object has keys:
- "meal_type": one of "Breakfast", "Lunch", "Snack", "Dinner", "Pre_Workout", "Post_Workout"
- "time": string (suggested time, e.g. "8:00 AM")
- "items": array of food item objects (each meal should have 2-4 items, not just 1 lonely item)
- "total_calories": number
- "total_protein": number (grams)
- "total_carbs": number (grams)
- "total_fat": number (grams)
- "prep_time_min": number
- "estimated_cost_inr": number (realistic Indian prices: dal rice ~₹30-40, paratha ~₹15-20, chicken curry ~₹80-100, eggs ~₹10 each)

Each food item object has keys:
- "food": string (common Indian name, e.g. "Masoor dal" not "Red lentil soup")
- "quantity_g": number
- "calories": number
- "protein": number (grams)
- "carbs": number (grams)
- "fat": number (grams)

CHEAT DAY RULES (when is_cheat_day is true):
- Cheat day meals MUST include genuinely fun, indulgent foods that people actually crave.
- At least 2 of the day's meals should feature cheat foods.
- Cheat food examples (use these kinds of foods, pick different ones each cheat day):
  * Street food: Gol gappe/Pani puri, Samosa, Aloo tikki, Pav bhaji, Chole bhature, Vada pav, Dahi bhalla, Bhel puri, Sev puri, Kachori
  * Fast food: Burger, Pizza (2 slices), French fries, Fried chicken, Noodles, Momos, Frankie/wrap
  * Sweets/Desserts: Gulab jamun, Rasgulla, Jalebi, Ice cream (1 scoop), Chocolate bar, Waffles, Brownie, Gajar ka halwa, Kheer
  * Snacks: Chips packet, Maggi noodles, Biscuits (Parle-G, Oreo), Namkeen mixture, Bhujia
- Cheat day calories can exceed the daily target by up to 25%.
- Even on cheat days, try to include ONE balanced meal (like a proper lunch) so the day isn't entirely junk.
- Make cheat days feel like a REWARD, not a modified version of a healthy day.

GENERAL RULES:
- Target daily totals MUST closely match: {target_kcal} kcal, {protein_target}g protein, {carbs_target}g carbs, {fat_target}g fat, {fiber_target}g fiber.
- Meals per day: {meals_per_day}. Generate EXACTLY {meals_per_day} meals for each day.

Meal distribution by meals_per_day:
- 2 meals: Lunch, Dinner
- 3 meals: Breakfast, Lunch, Dinner
- 4 meals: Breakfast, Lunch, Snack, Dinner
- 5 meals: Breakfast, Mid-Morning Snack, Lunch, Evening Snack, Dinner
- 6 meals: Breakfast, Mid-Morning Snack, Lunch, Post_Workout, Evening Snack, Dinner

Use the meal_type values: "Breakfast", "Mid-Morning Snack", "Lunch", "Afternoon Snack", "Post_Workout", "Evening Snack", "Dinner", "Snack", "Pre_Workout"
Distribute calories proportionally: Breakfast 20-25%, Lunch 25-30%, Dinner 25-30%, Snacks 5-10% each.
Each meal MUST have 2-4 food items (not just 1 item).

- Region: {region}. Use foods commonly available and affordable in this region.
- Diet type: {diet_type}. Respect strictly.
- Allergies: {allergies}. NEVER include these.
- Budget level: {budget_level}.
- Each meal MUST have 2-4 food items (a complete plate), NOT a single item. For example, breakfast should be "Poha (200g) + Chai (150ml) + Banana (1)" not just "Banana (150g)".
- No markdown, no explanation, return ONLY the JSON object with key "days"."""

MEAL_SYSTEM_PROMPT_CHUNK_FOLLOWUP = """
The user message includes previous_week_breakfasts and previous_week_dinners — these are meals already planned in earlier weeks. Do NOT repeat any of these dishes. Use completely different recipes."""

MEAL_SWAP_SYSTEM_PROMPT = """You are an expert Indian nutritionist. Replace one meal with a different option.
Return ONLY a JSON object with key "meal" containing the replacement meal.

The replacement meal MUST:
- Be a completely different dish from the original (different main ingredient, different cuisine style).
- Match the original meal's calorie range within ±15%.
- Match the original meal's protein within ±5g.
- Be appropriate for the meal_type and time of day.
- Have 2-4 food items (a complete plate).
- Use foods available in region {region} and respect diet_type {diet_type} and allergies {allergies}.
- Include realistic estimated_cost_inr and prep_time_min.

The meal object must have keys: meal_type, time, items (array of {{food, quantity_g, calories, protein, carbs, fat}}), total_calories, total_protein, total_carbs, total_fat, prep_time_min, estimated_cost_inr."""


MEAL_SLOTS_BY_COUNT: dict[int, list[str]] = {
    2: ["Lunch", "Dinner"],
    3: ["Breakfast", "Lunch", "Dinner"],
    4: ["Breakfast", "Lunch", "Snack", "Dinner"],
    5: ["Breakfast", "Mid-Morning Snack", "Lunch", "Evening Snack", "Dinner"],
    6: ["Breakfast", "Mid-Morning Snack", "Lunch", "Post_Workout", "Evening Snack", "Dinner"],
}

MEAL_TIMES: dict[str, str] = {
    "Breakfast": "8:00 AM",
    "Mid-Morning Snack": "10:30 AM",
    "Lunch": "1:00 PM",
    "Afternoon Snack": "3:30 PM",
    "Post_Workout": "5:00 PM",
    "Snack": "4:00 PM",
    "Evening Snack": "6:00 PM",
    "Pre_Workout": "5:30 PM",
    "Dinner": "8:00 PM",
}

BUDGET_FOODS = [
    {"food": "Oats (cooked)", "cal_per_100g": 71, "protein_per_100g": 2.5},
    {"food": "Brown rice (cooked)", "cal_per_100g": 111, "protein_per_100g": 2.6},
    {"food": "Chole masala", "cal_per_100g": 270, "protein_per_100g": 15},
    {"food": "Dal (cooked)", "cal_per_100g": 116, "protein_per_100g": 9},
    {"food": "Paneer", "cal_per_100g": 265, "protein_per_100g": 18},
    {"food": "Boiled eggs", "cal_per_100g": 155, "protein_per_100g": 13},
    {"food": "Banana", "cal_per_100g": 89, "protein_per_100g": 1},
    {"food": "Mixed vegetables", "cal_per_100g": 50, "protein_per_100g": 2},
]


def _onboarding_context(db: Session, user_id: int) -> tuple[dict, dict]:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}
    targets = row.targets_json if row and isinstance(row.targets_json, dict) else {}
    return onboarding, targets


def _food_dataset_sample(db: Session, limit: int = 40) -> list[dict[str, Any]]:
    try:
        rows = (
            db.execute(
                text(
                    """
                    SELECT food_name, calories_per_100g, protein_g
                    FROM food_items
                    ORDER BY RANDOM()
                    LIMIT :lim
                    """
                ),
                {"lim": limit},
            )
            .mappings()
            .all()
        )
        if rows:
            return [
                {
                    "food": str(r["food_name"]),
                    "cal_per_100g": float(r["calories_per_100g"] or 0),
                    "protein_per_100g": float(r["protein_g"] or 0),
                }
                for r in rows
            ]
    except Exception:
        pass
    return BUDGET_FOODS


def _meal_slots_for_count(meals_per_day: int) -> list[str]:
    count = max(2, min(6, int(meals_per_day)))
    return list(MEAL_SLOTS_BY_COUNT.get(count, MEAL_SLOTS_BY_COUNT[3]))


def _build_meal_system_prompt(ctx: dict[str, Any], chunk_index: int, *, has_prior_context: bool = False) -> str:
    allergies = ctx.get("allergies") or []
    prompt = MEAL_SYSTEM_PROMPT_BASE.format(
        target_kcal=ctx["target_kcal"],
        protein_target=ctx["protein_target"],
        carbs_target=ctx["carbs_target"],
        fat_target=ctx["fat_target"],
        fiber_target=ctx["fiber_target"],
        meals_per_day=ctx["meals_per_day"],
        region=ctx["region"],
        diet_type=ctx["diet_type"],
        allergies=", ".join(allergies) if allergies else "none",
        budget_level=ctx["budget_level"],
    )
    if chunk_index >= 1 or has_prior_context:
        prompt += MEAL_SYSTEM_PROMPT_CHUNK_FOLLOWUP
    return prompt


def _include_cheat_for_chunk(chunk_index: int) -> bool:
    return chunk_index in (0, 2)


def _normalize_meal(meal: dict[str, Any]) -> dict[str, Any]:
    items = meal.get("items") if isinstance(meal.get("items"), list) else []
    cal = protein = carbs = fat = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        cal += int(item.get("calories") or 0)
        protein += int(item.get("protein") or 0)
        carbs += int(item.get("carbs") or 0)
        fat += int(item.get("fat") or 0)
    if cal > 0:
        meal["total_calories"] = cal
        meal["total_protein"] = protein
        meal["total_carbs"] = carbs
        meal["total_fat"] = fat
    return meal


def _extract_prev_week_meals(chunk_days: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    breakfasts: list[str] = []
    dinners: list[str] = []
    for day in chunk_days:
        for meal in day.get("meals") or []:
            if not isinstance(meal, dict):
                continue
            items = meal.get("items") or []
            main = items[0].get("food", "") if items and isinstance(items[0], dict) else ""
            if meal.get("meal_type") == "Breakfast" and main:
                breakfasts.append(str(main))
            elif meal.get("meal_type") == "Dinner" and main:
                dinners.append(str(main))
    return breakfasts, dinners


def _meal_chunk_max_tokens(meals_per_day: int) -> int:
    return 3000 if meals_per_day <= 4 else 4500


def _groq_meal_chunk(system_prompt: str, user_message: dict[str, Any]) -> list[dict[str, Any]]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing")
    meals_per_day = int(user_message.get("meals_per_day") or 3)
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
            "temperature": 0.6,
            "max_tokens": _meal_chunk_max_tokens(meals_per_day),
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_message)},
            ],
        },
        timeout=90,
    )
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    return parse_groq_json_array(content)


def _gemini_meal_chunk(system_prompt: str, user_message: dict[str, Any]) -> list[dict[str, Any]]:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing")
    meals_per_day = int(user_message.get("meals_per_day") or 3)
    model = settings.GEMINI_MODEL or "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.GEMINI_API_KEY}"
    raw = post_json(
        url,
        headers={"Content-Type": "application/json"},
        payload={
            "contents": [{"role": "user", "parts": [{"text": system_prompt + "\n\n" + json.dumps(user_message)}]}],
            "generationConfig": {
                "temperature": 0.6,
                "maxOutputTokens": _meal_chunk_max_tokens(meals_per_day),
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    parts = (raw.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    content = parts[0].get("text", "") if parts else ""
    return parse_groq_json_array(content)


def _validate_meal_day(day_obj: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(day_obj.get("day"), int):
        return None
    meals_raw = day_obj.get("meals")
    if not isinstance(meals_raw, list) or not meals_raw:
        return None
    meals = [_normalize_meal(m) for m in meals_raw if isinstance(m, dict)]
    if not meals:
        return None
    totals = {"cal": 0, "p": 0, "c": 0, "f": 0}
    for meal in meals:
        totals["cal"] += int(meal.get("total_calories") or 0)
        totals["p"] += int(meal.get("total_protein") or 0)
        totals["c"] += int(meal.get("total_carbs") or 0)
        totals["f"] += int(meal.get("total_fat") or 0)
    return {
        "day": int(day_obj["day"]),
        "is_cheat_day": bool(day_obj.get("is_cheat_day")),
        "meals": meals,
        "total_calories": max(totals["cal"], 1),
        "total_protein_g": max(totals["p"], 1),
        "total_carbs_g": max(totals["c"], 1),
        "total_fat_g": max(totals["f"], 1),
        "total_fiber_g": max(int(day_obj.get("total_fiber_g") or 25), 15),
    }


FALLBACK_DAY_TEMPLATES = [
    {
        "breakfast": [("Poha", 200), ("Chai", 150), ("Peanuts", 20)],
        "lunch": [("Rajma", 180), ("Brown rice", 150), ("Salad", 80)],
        "dinner": [("Dal tadka", 200), ("Jeera rice", 150), ("Raita", 100)],
    },
    {
        "breakfast": [("Idli", 200), ("Sambar", 150), ("Coconut chutney", 30)],
        "lunch": [("Chole", 200), ("Roti", 120), ("Onion salad", 50)],
        "dinner": [("Paneer bhurji", 150), ("Paratha", 100), ("Curd", 100)],
    },
    {
        "breakfast": [("Upma", 200), ("Coconut", 15), ("Banana", 100)],
        "lunch": [("Kadhi", 200), ("Rice", 150), ("Papad", 20)],
        "dinner": [("Egg curry", 180), ("Roti", 120), ("Kachumber", 60)],
    },
    {
        "breakfast": [("Besan chilla", 180), ("Mint chutney", 30), ("Tea", 150)],
        "lunch": [("Palak paneer", 200), ("Roti", 120), ("Salad", 70)],
        "dinner": [("Chicken curry", 180), ("Rice", 150), ("Raita", 80)],
    },
    {
        "breakfast": [("Masala dosa", 220), ("Sambar", 120), ("Chutney", 30)],
        "lunch": [("Dal makhani", 200), ("Rice", 150), ("Pickle", 15)],
        "dinner": [("Fish curry", 180), ("Rice", 150), ("Salad", 60)],
    },
    {
        "breakfast": [("Oats porridge", 200), ("Milk", 200), ("Almonds", 20)],
        "lunch": [("Vegetable pulao", 250), ("Raita", 100), ("Papad", 20)],
        "dinner": [("Mix veg", 200), ("Roti", 120), ("Curd", 100)],
    },
    {
        "breakfast": [("Paratha", 150), ("Curd", 150), ("Pickle", 15)],
        "lunch": [("Chana masala", 200), ("Rice", 150), ("Salad", 70)],
        "dinner": [("Moong dal", 200), ("Roti", 120), ("Bhindi", 100)],
    },
]

CHEAT_MEAL_TEMPLATE = {
    "breakfast": [("Samosa", 120), ("Chai", 150)],
    "lunch": [("Dal rice", 300), ("Salad", 80)],
    "dinner": [("Pav bhaji", 250), ("Gulab jamun", 80)],
}


def _items_from_template(template: list[tuple[str, int]], food_lookup: dict[str, dict]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for i, (name, qty) in enumerate(template):
        base = food_lookup.get(name.lower()) or BUDGET_FOODS[i % len(BUDGET_FOODS)]
        cal = int(base["cal_per_100g"] * qty / 100)
        p = int(base["protein_per_100g"] * qty / 100)
        items.append(
            {
                "food": name,
                "quantity_g": qty,
                "calories": cal,
                "protein": p,
                "carbs": int(cal * 0.55 / 4),
                "fat": int(cal * 0.25 / 9),
            }
        )
    return items


def _build_meal_from_items(meal_type: str, time: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    meal = {
        "meal_type": meal_type,
        "time": time,
        "items": items,
        "prep_time_min": 20,
        "estimated_cost_inr": 45,
    }
    return _normalize_meal(meal)


def _fallback_meal_days(
    days: list[int],
    *,
    target_kcal: int,
    protein: int,
    carbs: int,
    fat: int,
    fiber: int,
    meals_per_day: int,
    include_cheat: bool,
    day_offset: int = 0,
) -> list[dict[str, Any]]:
    lookup = {str(f["food"]).lower(): f for f in BUDGET_FOODS}
    meal_slots = _meal_slots_for_count(meals_per_day)
    slot_template_key = {
        "Breakfast": "breakfast",
        "Lunch": "lunch",
        "Dinner": "dinner",
        "Snack": "lunch",
        "Mid-Morning Snack": "breakfast",
        "Afternoon Snack": "lunch",
        "Post_Workout": "lunch",
        "Evening Snack": "dinner",
        "Pre_Workout": "breakfast",
    }
    out: list[dict[str, Any]] = []
    cheat_day = days[len(days) // 2] if include_cheat and days else None
    for i, d in enumerate(days):
        tpl = FALLBACK_DAY_TEMPLATES[(day_offset + i) % len(FALLBACK_DAY_TEMPLATES)]
        if d == cheat_day:
            tpl = CHEAT_MEAL_TEMPLATE
        meals = []
        for mt in meal_slots:
            key = slot_template_key.get(mt, "lunch")
            items = _items_from_template(tpl.get(key, tpl["lunch"]), lookup)
            meals.append(_build_meal_from_items(mt, MEAL_TIMES.get(mt, "1:00 PM"), items))
        totals = {"cal": 0, "p": 0, "c": 0, "f": 0}
        for m in meals:
            totals["cal"] += int(m.get("total_calories") or 0)
            totals["p"] += int(m.get("total_protein") or 0)
            totals["c"] += int(m.get("total_carbs") or 0)
            totals["f"] += int(m.get("total_fat") or 0)
        mult = 1.2 if d == cheat_day else 1.0
        scale = (target_kcal * mult) / max(totals["cal"], 1)
        if abs(scale - 1.0) > 0.05:
            for m in meals:
                m["total_calories"] = int(m["total_calories"] * scale)
                m["total_protein"] = int(m["total_protein"] * scale)
                m["total_carbs"] = int(m["total_carbs"] * scale)
                m["total_fat"] = int(m["total_fat"] * scale)
            totals["cal"] = sum(int(m["total_calories"]) for m in meals)
            totals["p"] = sum(int(m["total_protein"]) for m in meals)
            totals["c"] = sum(int(m["total_carbs"]) for m in meals)
            totals["f"] = sum(int(m["total_fat"]) for m in meals)
        out.append(
            {
                "day": d,
                "is_cheat_day": d == cheat_day,
                "meals": meals,
                "total_calories": int(totals["cal"]),
                "total_protein_g": protein,
                "total_carbs_g": carbs,
                "total_fat_g": fat,
                "total_fiber_g": fiber,
            }
        )
    return out


def _build_meal_ctx(db: Session, user: User) -> dict[str, Any]:
    onboarding, targets = _onboarding_context(db, user.id)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    macros = targets.get("macros") if isinstance(targets.get("macros"), dict) else {}
    meals_per_day = int(dietary.get("meals_per_day") or 3)
    return {
        "target_kcal": int(targets.get("target_kcal") or 2200),
        "protein_target": int(macros.get("protein_g") or 150),
        "carbs_target": int(macros.get("carbs_g") or 200),
        "fat_target": int(macros.get("fat_g") or 65),
        "fiber_target": int(macros.get("fiber_g") or 30),
        "meals_per_day": meals_per_day,
        "expected_meal_types": _meal_slots_for_count(meals_per_day),
        "region": str(app_setup.get("region") or "IN"),
        "diet_type": str(dietary.get("diet_type") or "standard"),
        "allergies": dietary.get("allergies") if isinstance(dietary.get("allergies"), list) else [],
        "budget_level": "budget",
        "user_weight_kg": float(personal.get("weight_kg") or user.weight or 70),
        "goal": str(goal.get("type") or "maintain"),
        "activity_level": str(activity.get("level") or "moderately_active"),
        "workout_types": activity.get("workout_types") if isinstance(activity.get("workout_types"), list) else [],
        "water_target_l": float(app_setup.get("water_intake_goal_liters") or 2.5),
        "food_dataset_sample": _food_dataset_sample(db),
    }


def _log_meal_day_counts(days: list[dict[str, Any]], meals_per_day: int) -> None:
    for day_data in days:
        actual_meals = len(day_data.get("meals") or [])
        if actual_meals != meals_per_day:
            logger.warning(
                "Day %s has %s meals, expected %s",
                day_data.get("day"),
                actual_meals,
                meals_per_day,
            )


def _diversity_from_entries(entries: list[DailyMealPlanEntry]) -> tuple[list[str], list[str]]:
    breakfasts: list[str] = []
    dinners: list[str] = []
    for entry in sorted(entries, key=lambda e: e.day):
        meals = safe_json_loads(entry.meals_json)
        if not isinstance(meals, list):
            continue
        for meal in meals:
            if not isinstance(meal, dict):
                continue
            items = meal.get("items") or []
            main = items[0].get("food", "") if items and isinstance(items[0], dict) else ""
            if meal.get("meal_type") == "Breakfast" and main:
                breakfasts.append(str(main))
            elif meal.get("meal_type") == "Dinner" and main:
                dinners.append(str(main))
    return breakfasts, dinners


def _generate_chunk_days(
    db: Session,
    *,
    days: list[int],
    chunk_index: int,
    ctx: dict[str, Any],
    prev_breakfasts: list[str] | None = None,
    prev_dinners: list[str] | None = None,
    include_cheat_override: bool | None = None,
    day_offset: int | None = None,
    has_prior_context: bool = False,
) -> tuple[list[dict[str, Any]], str]:
    include_cheat = include_cheat_override if include_cheat_override is not None else _include_cheat_for_chunk(chunk_index)
    system_prompt = _build_meal_system_prompt(ctx, chunk_index, has_prior_context=has_prior_context or bool(prev_breakfasts or prev_dinners))
    meals_per_day = int(ctx["meals_per_day"])
    user_msg: dict[str, Any] = {
        "days": days,
        "include_cheat_day": include_cheat,
        "target_kcal": ctx["target_kcal"],
        "protein_target": ctx["protein_target"],
        "carbs_target": ctx["carbs_target"],
        "fat_target": ctx["fat_target"],
        "fiber_target": ctx["fiber_target"],
        "meals_per_day": meals_per_day,
        "expected_meal_types": ctx["expected_meal_types"],
        "region": ctx["region"],
        "diet_type": ctx["diet_type"],
        "allergies": ctx["allergies"],
        "budget_level": ctx["budget_level"],
        "user_weight_kg": ctx["user_weight_kg"],
        "goal": ctx["goal"],
        "activity_level": ctx["activity_level"],
        "workout_types": ctx["workout_types"],
        "water_target_l": ctx["water_target_l"],
        "food_dataset_sample": ctx.get("food_dataset_sample", []),
    }
    if prev_breakfasts:
        user_msg["previous_week_breakfasts"] = prev_breakfasts
    if prev_dinners:
        user_msg["previous_week_dinners"] = prev_dinners
    for attempt in range(2):
        try:
            raw_days = _groq_meal_chunk(system_prompt, user_msg)
            validated = [_validate_meal_day(d) for d in raw_days]
            validated = [d for d in validated if d]
            if len(validated) >= len(days):
                result = validated[: len(days)]
                _log_meal_day_counts(result, meals_per_day)
                return result, "groq"
        except Exception:
            if attempt == 0:
                continue
        try:
            raw_days = _gemini_meal_chunk(system_prompt, user_msg)
            validated = [_validate_meal_day(d) for d in raw_days]
            validated = [d for d in validated if d]
            if len(validated) >= len(days):
                result = validated[: len(days)]
                _log_meal_day_counts(result, meals_per_day)
                return result, "gemini"
        except Exception:
            pass
    fallback = _fallback_meal_days(
            days,
            target_kcal=int(ctx["target_kcal"]),
            protein=int(ctx["protein_target"]),
            carbs=int(ctx["carbs_target"]),
            fat=int(ctx["fat_target"]),
            fiber=int(ctx["fiber_target"]),
            meals_per_day=int(ctx["meals_per_day"]),
            include_cheat=include_cheat,
            day_offset=day_offset if day_offset is not None else chunk_index * 7,
        )
    _log_meal_day_counts(fallback, meals_per_day)
    return fallback, "fallback"


def get_existing_meal_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyMealPlan | None:
    return (
        db.query(MonthlyMealPlan)
        .filter(MonthlyMealPlan.user_id == user_id, MonthlyMealPlan.month == month, MonthlyMealPlan.year == year)
        .first()
    )


def generate_meal_plan(
    db: Session,
    user: User,
    *,
    budget_level: str,
    local_date: str | None,
) -> MonthlyMealPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    existing = get_existing_meal_plan(db, user.id, month, year)
    if existing:
        return existing

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = budget_level
    logger.info(
        "[MealPlanner] Generating for user %s: meals_per_day=%s, target_kcal=%s, diet=%s, region=%s",
        user.id,
        ctx["meals_per_day"],
        ctx["target_kcal"],
        ctx["diet_type"],
        ctx["region"],
    )

    all_days: list[dict[str, Any]] = []
    source = "groq"
    prev_breakfasts: list[str] = []
    prev_dinners: list[str] = []
    for idx, chunk in enumerate(month_chunks(month, year)):
        chunk_days, chunk_source = _generate_chunk_days(
            db,
            days=chunk,
            chunk_index=idx,
            ctx=ctx,
            prev_breakfasts=prev_breakfasts or None,
            prev_dinners=prev_dinners or None,
        )
        if chunk_source == "fallback":
            source = "fallback"
        elif chunk_source == "gemini" and source == "groq":
            source = "gemini"
        all_days.extend(chunk_days)
        b, din = _extract_prev_week_meals(chunk_days)
        prev_breakfasts.extend(b)
        prev_dinners.extend(din)

    plan = MonthlyMealPlan(
        user_id=user.id,
        month=month,
        year=year,
        budget_level=budget_level,
        generated_at=datetime.utcnow(),
        source=source,
    )
    db.add(plan)
    db.flush()

    for d in all_days:
        db.add(
            DailyMealPlanEntry(
                plan_id=plan.id,
                day=int(d["day"]),
                is_cheat_day=bool(d.get("is_cheat_day")),
                total_calories=int(d["total_calories"]),
                total_protein_g=int(d["total_protein_g"]),
                total_carbs_g=int(d["total_carbs_g"]),
                total_fat_g=int(d["total_fat_g"]),
                total_fiber_g=int(d.get("total_fiber_g") or ctx["fiber_target"]),
                meals_json=safe_json_dumps(d.get("meals") or []),
            )
        )
    db.commit()
    db.refresh(plan)
    return plan


def _entry_to_day_dict(entry: DailyMealPlanEntry, *, locked: bool = False) -> dict[str, Any]:
    if locked:
        return {
            "day": entry.day,
            "is_cheat_day": entry.is_cheat_day,
            "locked": True,
            "message": f"This day's plan will be available on day {entry.day}",
        }
    return {
        "day": entry.day,
        "is_cheat_day": entry.is_cheat_day,
        "total_calories": entry.total_calories,
        "total_protein_g": entry.total_protein_g,
        "total_carbs_g": entry.total_carbs_g,
        "total_fat_g": entry.total_fat_g,
        "total_fiber_g": entry.total_fiber_g,
        "meals": safe_json_loads(entry.meals_json),
    }


def meal_plan_current_response(plan: MonthlyMealPlan, local_date: str | None) -> dict[str, Any]:
    today = parse_local_date(local_date)
    entries = sorted(plan.entries, key=lambda e: e.day)
    today_entry = next((e for e in entries if e.day == today.day), None)
    month_overview = []
    for e in entries:
        flags = day_flags(e.day, today, plan.month, plan.year)
        row = {
            "day": e.day,
            "total_calories": e.total_calories if not flags["is_future"] else None,
            "is_cheat_day": e.is_cheat_day,
            **flags,
        }
        month_overview.append(row)
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "budget_level": plan.budget_level,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "today": _entry_to_day_dict(today_entry, locked=False) if today_entry else None,
        "month_overview": month_overview,
    }


def meal_plan_month_response(plan: MonthlyMealPlan, local_date: str | None) -> dict[str, Any]:
    today = parse_local_date(local_date)
    days_out = []
    for e in sorted(plan.entries, key=lambda x: x.day):
        flags = day_flags(e.day, today, plan.month, plan.year)
        row = {
            "day": e.day,
            "is_cheat_day": e.is_cheat_day,
            "total_calories": e.total_calories,
            "total_protein_g": e.total_protein_g,
            "total_carbs_g": e.total_carbs_g,
            "total_fat_g": e.total_fat_g,
            **flags,
        }
        if not flags["is_future"]:
            row["meals"] = safe_json_loads(e.meals_json)
        days_out.append(row)
    return {"plan_id": plan.id, "month": plan.month, "year": plan.year, "days": days_out}


def delete_meal_plan(db: Session, plan: MonthlyMealPlan) -> None:
    db.delete(plan)
    db.commit()


def regenerate_remaining_meals(
    db: Session,
    user: User,
    *,
    from_day: int,
    local_date: str | None,
) -> MonthlyMealPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    last_day = days_in_month(month, year)

    if from_day < today.day:
        raise ValueError(
            f"Cannot regenerate past days. Earliest allowed is today (day {today.day})."
        )
    if from_day > last_day:
        raise ValueError("from_day exceeds month length")

    plan = get_existing_meal_plan(db, user.id, month, year)
    if not plan:
        raise LookupError("No plan exists for this month")

    db.query(DailyMealPlanEntry).filter(
        DailyMealPlanEntry.plan_id == plan.id,
        DailyMealPlanEntry.day >= from_day,
    ).delete(synchronize_session=False)
    db.flush()

    preserved = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day < from_day)
        .order_by(DailyMealPlanEntry.day.desc())
        .limit(7)
        .all()
    )
    preserved = sorted(preserved, key=lambda e: e.day)

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = plan.budget_level
    logger.info(
        "[MealPlanner] Regenerating for user %s from day %s: meals_per_day=%s, budget=%s",
        user.id,
        from_day,
        ctx["meals_per_day"],
        plan.budget_level,
    )

    prev_breakfasts, prev_dinners = _diversity_from_entries(preserved)
    chunks = days_chunks_from_range(from_day, last_day)
    remaining_count = last_day - from_day + 1
    cheat_chunk_idx = 0 if remaining_count > 10 else -1

    for idx, chunk_days in enumerate(chunks):
        include_cheat = idx == cheat_chunk_idx
        new_days, _ = _generate_chunk_days(
            db,
            days=chunk_days,
            chunk_index=idx,
            ctx=ctx,
            prev_breakfasts=prev_breakfasts or None,
            prev_dinners=prev_dinners or None,
            include_cheat_override=include_cheat,
            day_offset=chunk_days[0] - 1 if chunk_days else 0,
            has_prior_context=True,
        )
        for d in new_days:
            db.add(
                DailyMealPlanEntry(
                    plan_id=plan.id,
                    day=int(d["day"]),
                    is_cheat_day=bool(d.get("is_cheat_day")),
                    total_calories=int(d["total_calories"]),
                    total_protein_g=int(d["total_protein_g"]),
                    total_carbs_g=int(d["total_carbs_g"]),
                    total_fat_g=int(d["total_fat_g"]),
                    total_fiber_g=int(d.get("total_fiber_g") or ctx["fiber_target"]),
                    meals_json=safe_json_dumps(d.get("meals") or []),
                )
            )
        b, din = _extract_prev_week_meals(new_days)
        prev_breakfasts.extend(b)
        prev_dinners.extend(din)

    plan.generated_at = datetime.utcnow()
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


FALLBACK_SWAPS: dict[str, list[dict[str, Any]]] = {
    "Breakfast": [
        {
            "meal_type": "Breakfast",
            "time": "8:00 AM",
            "items": [
                {"food": "Poha", "quantity_g": 200, "calories": 280, "protein": 8, "carbs": 48, "fat": 6},
                {"food": "Chai", "quantity_g": 150, "calories": 60, "protein": 2, "carbs": 8, "fat": 2},
            ],
            "prep_time_min": 15,
            "estimated_cost_inr": 25,
        },
        {
            "meal_type": "Breakfast",
            "time": "8:00 AM",
            "items": [
                {"food": "Idli", "quantity_g": 200, "calories": 260, "protein": 10, "carbs": 52, "fat": 2},
                {"food": "Sambar", "quantity_g": 150, "calories": 90, "protein": 5, "carbs": 12, "fat": 3},
            ],
            "prep_time_min": 20,
            "estimated_cost_inr": 35,
        },
        {
            "meal_type": "Breakfast",
            "time": "8:00 AM",
            "items": [
                {"food": "Aloo paratha", "quantity_g": 150, "calories": 350, "protein": 8, "carbs": 45, "fat": 14},
                {"food": "Curd", "quantity_g": 100, "calories": 60, "protein": 4, "carbs": 5, "fat": 3},
            ],
            "prep_time_min": 25,
            "estimated_cost_inr": 40,
        },
    ],
    "Lunch": [
        {
            "meal_type": "Lunch",
            "time": "1:00 PM",
            "items": [
                {"food": "Rajma", "quantity_g": 200, "calories": 420, "protein": 22, "carbs": 55, "fat": 8},
                {"food": "Brown rice", "quantity_g": 150, "calories": 165, "protein": 4, "carbs": 35, "fat": 1},
            ],
            "prep_time_min": 30,
            "estimated_cost_inr": 50,
        },
        {
            "meal_type": "Lunch",
            "time": "1:00 PM",
            "items": [
                {"food": "Chole", "quantity_g": 200, "calories": 480, "protein": 18, "carbs": 60, "fat": 12},
                {"food": "Roti", "quantity_g": 120, "calories": 300, "protein": 8, "carbs": 48, "fat": 8},
            ],
            "prep_time_min": 35,
            "estimated_cost_inr": 55,
        },
    ],
    "Dinner": [
        {
            "meal_type": "Dinner",
            "time": "8:00 PM",
            "items": [
                {"food": "Dal tadka", "quantity_g": 200, "calories": 230, "protein": 14, "carbs": 28, "fat": 6},
                {"food": "Jeera rice", "quantity_g": 150, "calories": 180, "protein": 4, "carbs": 38, "fat": 2},
            ],
            "prep_time_min": 30,
            "estimated_cost_inr": 45,
        },
        {
            "meal_type": "Dinner",
            "time": "8:00 PM",
            "items": [
                {"food": "Paneer bhurji", "quantity_g": 150, "calories": 320, "protein": 20, "carbs": 8, "fat": 24},
                {"food": "Roti", "quantity_g": 100, "calories": 250, "protein": 7, "carbs": 40, "fat": 6},
            ],
            "prep_time_min": 25,
            "estimated_cost_inr": 70,
        },
    ],
    "Snack": [
        {
            "meal_type": "Snack",
            "time": "4:00 PM",
            "items": [
                {"food": "Roasted makhana", "quantity_g": 40, "calories": 140, "protein": 4, "carbs": 22, "fat": 4},
                {"food": "Buttermilk", "quantity_g": 200, "calories": 80, "protein": 4, "carbs": 8, "fat": 2},
            ],
            "prep_time_min": 5,
            "estimated_cost_inr": 30,
        },
    ],
}


def _get_fallback_swap(meal_type: str, target_cal: int, target_protein: int) -> dict[str, Any]:
    options = FALLBACK_SWAPS.get(meal_type, FALLBACK_SWAPS["Lunch"])
    meal = dict(random.choice(options))
    meal["meal_type"] = meal_type
    meal = _normalize_meal(meal)
    scale = target_cal / max(int(meal.get("total_calories") or 1), 1)
    if 0.7 < scale < 1.3:
        meal["total_calories"] = int(meal["total_calories"] * scale)
        meal["total_protein"] = max(1, int(meal.get("total_protein", target_protein) * scale))
        meal["total_carbs"] = int(meal.get("total_carbs", 0) * scale)
        meal["total_fat"] = int(meal.get("total_fat", 0) * scale)
    return meal


def _groq_swap_meal(system_prompt: str, user_msg: dict[str, Any]) -> dict[str, Any]:
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
            "temperature": 0.7,
            "max_tokens": 500,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_msg)},
            ],
        },
        timeout=45,
    )
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = json.loads(content.replace("```json", "").replace("```", "").strip())
    meal = parsed.get("meal") if isinstance(parsed, dict) else None
    if not isinstance(meal, dict):
        raise ValueError("Invalid swap response")
    return _normalize_meal(meal)


def swap_meal(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    meal_type: str,
    reason: str | None,
    local_date: str | None,
) -> dict[str, Any]:
    local = parse_local_date(local_date).isoformat()
    if not check_swap_allowed(user.id, "meal", local):
        raise SwapLimitExceeded("You've used all your swaps for today. Try again tomorrow.")

    plan = db.query(MonthlyMealPlan).filter(MonthlyMealPlan.id == plan_id, MonthlyMealPlan.user_id == user.id).first()
    if not plan:
        raise LookupError("Plan not found")

    entry = next((e for e in plan.entries if e.day == day), None)
    if not entry:
        raise LookupError("Day not found")

    meals = safe_json_loads(entry.meals_json)
    if not isinstance(meals, list):
        raise ValueError("Invalid meals data")

    original = next((m for m in meals if isinstance(m, dict) and m.get("meal_type") == meal_type), None)
    if not original:
        raise LookupError("Meal type not found for this day")

    onboarding, targets = _onboarding_context(db, user.id)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}
    allergies = dietary.get("allergies") if isinstance(dietary.get("allergies"), list) else []

    other_today = []
    for m in meals:
        if isinstance(m, dict) and m.get("meal_type") != meal_type:
            items = m.get("items") or []
            if items and isinstance(items[0], dict):
                other_today.append(str(items[0].get("food", "")))

    system_prompt = MEAL_SWAP_SYSTEM_PROMPT.format(
        region=str(app_setup.get("region") or "IN"),
        diet_type=str(dietary.get("diet_type") or "standard"),
        allergies=", ".join(allergies) if allergies else "none",
    )
    user_msg = {
        "original_meal": original,
        "reason": reason or "want_variety",
        "target_calories_for_this_meal": int(original.get("total_calories") or 400),
        "target_protein_for_this_meal": int(original.get("total_protein") or 25),
        "region": str(app_setup.get("region") or "IN"),
        "diet_type": str(dietary.get("diet_type") or "standard"),
        "allergies": allergies,
        "budget_level": plan.budget_level,
        "other_meals_today": other_today,
    }

    replacement: dict[str, Any] | None = None
    try:
        if settings.GROQ_API_KEY:
            replacement = _groq_swap_meal(system_prompt, user_msg)
    except Exception:
        replacement = None

    if not replacement:
        replacement = _get_fallback_swap(
            meal_type,
            int(original.get("total_calories") or 400),
            int(original.get("total_protein") or 25),
        )
    replacement["meal_type"] = meal_type
    replacement["time"] = replacement.get("time") or original.get("time") or "12:00 PM"

    new_meals = []
    for m in meals:
        if isinstance(m, dict) and m.get("meal_type") == meal_type:
            new_meals.append(replacement)
        else:
            new_meals.append(m)

    validated = _validate_meal_day({"day": day, "is_cheat_day": entry.is_cheat_day, "meals": new_meals})
    if not validated:
        raise ValueError("Could not validate swapped meal")

    entry.meals_json = safe_json_dumps(validated["meals"])
    entry.total_calories = validated["total_calories"]
    entry.total_protein_g = validated["total_protein_g"]
    entry.total_carbs_g = validated["total_carbs_g"]
    entry.total_fat_g = validated["total_fat_g"]
    db.add(entry)
    db.commit()
    db.refresh(entry)
    increment_swap(user.id, "meal", local)

    result = _entry_to_day_dict(entry)
    result["swaps_used_today"] = get_swap_count(user.id, "meal", local)
    result["swaps_limit"] = SWAP_LIMIT_PER_DAY
    return result
