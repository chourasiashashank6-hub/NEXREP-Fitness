from __future__ import annotations

import json
import logging
import random
from datetime import date, datetime
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.http_client import post_json
from src.services.ai_logger import log_gemini_call, log_groq_call
from src.models.meal_plan import DailyMealPlanEntry, MonthlyMealPlan
from src.models.models import User, UserOnboarding
from src.services.planner_common import (
    day_flags,
    days_chunks_from_range,
    days_in_month,
    get_month_weeks,
    month_chunks,
    month_abbr,
    parse_groq_json_array,
    parse_local_date,
    safe_json_dumps,
    safe_json_loads,
)
from src.services.planner_swap_limits import (
    SWAP_LIMIT_PER_DAY,
    DayRegenLimitExceeded,
    SwapLimitExceeded,
    check_swap_allowed,
    get_swap_count,
    increment_swap,
)
from src.services.planner_test_users import (
    is_meal_planner_test_user,
    meal_planner_limits_exempt_flag,
    meal_planner_unlimited_regen_stats,
)

MONTHLY_DAY_REGEN_LIMIT = 3

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

WITHIN-DAY UNIQUENESS (HIGHEST PRIORITY — NEVER VIOLATE):
- Every single meal within one day MUST have completely different food items from every other meal that day.
- No food item can appear more than ONCE across all meals in the same day.
- This means: if Upma is in Breakfast, Upma cannot appear in any other meal that day.
- If Rice appears in Lunch, Rice cannot appear in Dinner or any snack that day.
- If Egg curry is in Evening Snack, Egg curry CANNOT be in Dinner.
- Evening Snack and Mid-Morning Snack must stay LIGHT (under ~250 kcal). Never put full curry + roti/rice meals in a snack slot — those belong in Lunch or Dinner only.
- Dinner MUST always have at least 2 food items with real calories. Never return an empty Dinner.
- Treat each meal as a unique eating occasion with its own distinct foods.
- Snacks must be light and completely different from the main meals (Breakfast, Lunch, Dinner).

MEAL TYPE RULES (follow strictly by meal_type):
- "Breakfast": A proper morning dish. Examples: Poha, Idli-Sambar, Paratha with curd, Upma, Dosa, Besan chilla, Oats porridge, Aloo paratha, Methi thepla.
- "Mid-Morning Snack": Small, light. Examples: 1 banana, handful of roasted chana, 1 apple with peanut butter, a small cup of buttermilk, 5-6 almonds with 2 walnuts, 1 boiled egg, a small cup of green tea with biscuits.
- "Lunch": The largest meal of the day. Examples: Dal + rice + sabzi + salad, Chole + 2 roti + onion salad, Rajma + rice + papad, Chicken curry + rice + raita.
- "Post_Workout" or "Afternoon Snack": Protein-focused recovery meal. Examples: Paneer bhurji + 1 roti, Egg white omelette + toast, Protein shake + banana, Sprouts chaat, Greek yogurt + fruit.
- "Evening Snack": Light snack, different from lunch and post-workout. Examples: Makhana, Roasted peanuts, Chai + 2 biscuits, Fruit chaat, Coconut water, Chana dal namkeen.
- "Dinner": Evening meal, lighter than lunch. Examples: Dal khichdi, Paneer + roti, Grilled chicken + sabzi, Fish curry + 1 cup rice, Egg curry + 1-2 roti, Mixed veg + roti.

CALORIE DISTRIBUTION for {meals_per_day} meals:
- 3 meals: Breakfast 30%, Lunch 40%, Dinner 30%
- 4 meals: Breakfast 25%, Lunch 35%, Snack 10%, Dinner 30%
- 5 meals: Breakfast 20%, Mid-Morning 10%, Lunch 30%, Evening Snack 10%, Dinner 30%
- 6 meals: Breakfast 20%, Mid-Morning 8%, Lunch 28%, Post-Workout 12%, Evening Snack 8%, Dinner 24%
- 7 meals: Breakfast 18%, Mid-Morning 7%, Lunch 25%, Post-Workout 10%, Afternoon Snack 7%, Evening Snack 8%, Dinner 25%
Apply this distribution — do NOT give snacks the same calories as main meals.

Use the meal_type values: "Breakfast", "Mid-Morning Snack", "Lunch", "Afternoon Snack", "Post_Workout", "Evening Snack", "Dinner", "Snack", "Pre_Workout"
Each meal MUST have 2-4 food items (not just 1 item).

The user message includes a "meal_slots" array that defines EXACTLY which meals to generate and their character.
Generate meals in the exact order and meal_type values listed in meal_slots.
The "character" field describes what kind of food belongs in that slot — follow it strictly.

MACRO TARGET COMPLIANCE (MANDATORY):
The day's total calories across ALL meals MUST equal {target_kcal} kcal (±5%).
The day's total protein across ALL meals MUST equal {protein_target}g (±10%).
The day's total carbs across ALL meals MUST equal {carbs_target}g (±10%).
The day's total fat across ALL meals MUST equal {fat_target}g (±10%).

This means:
- For a {target_kcal} kcal day with {meals_per_day} meals, the average meal must be about {avg_meal_kcal} kcal.
- Do NOT generate small meals. Scale up food quantities until they hit the target.
- If a meal seems too small, ADD more items or INCREASE quantities of existing items.
- Example: for a 2970 kcal day with 5 meals, Lunch alone should be ~900 kcal (200g rice + 200g dal + 150g sabzi + 100g raita + 2 roti).
- Snacks should still be lighter, but main meals (Breakfast, Lunch, Dinner) must be large enough to make up the bulk.

CALORIE ALLOCATION for {meals_per_day} meals targeting {target_kcal} kcal:
Compute exact kcal target per slot and include it in your planning:
{calorie_allocation}

You MUST hit these per-meal calorie targets. Scale food quantities up to match.
For example: if Lunch target is 832 kcal, use 250g cooked rice + 250g dal + 200g sabzi + 100g curd = ~830 kcal.

FOOD QUANTITY REFERENCE (use these realistic portions for a high-calorie target):
- Cooked rice: 150g = 170 kcal, 200g = 226 kcal, 300g = 339 kcal
- Roti (whole wheat): 1 roti (40g) = 120 kcal, so for 360 kcal → use 3 roti
- Dal (cooked): 200g = ~140 kcal, 300g = ~210 kcal
- Paneer: 100g = 265 kcal, 150g = 398 kcal
- Chicken breast (cooked): 150g = 248 kcal, 200g = 330 kcal
- Oats (cooked): 200g = 140 kcal, 300g = 210 kcal
- Banana: 100g = 89 kcal, 150g = 134 kcal
- Peanut butter: 30g = 188 kcal
- Ghee: 10g = 90 kcal — add to meals to increase calorie density without bulk

For a {target_kcal} kcal day, meals MUST use larger quantities than standard diet portions.
A user targeting {target_kcal} kcal is likely bulking or very active — give them enough food.

- Region: {region}. Use foods commonly available and affordable in this region.
- Diet type: {diet_type}. Respect strictly.
- Allergies: {allergies}. NEVER include these.
- Budget level: {budget_level}.
- Each meal MUST have 2-4 food items (a complete plate), NOT a single item. For example, breakfast should be "Poha (200g) + Chai (150ml) + Banana (1)" not just "Banana (150g)".
- No markdown, no explanation, return ONLY the JSON object with key "days".

SELF-CHECK BEFORE RESPONDING:
Before returning your JSON, verify for each day:
1. Are any food items repeated across different meals? If yes, replace the duplicate with a different food.
2. Do snacks have significantly fewer calories than main meals? If not, reduce snack portions.
3. Is every meal distinct in its main dish? If two meals share the same main dish, change one of them.
4. Does the day's total_calories sum to approximately {target_kcal} kcal (within ±5%)? If under, increase quantities.
5. Does total protein across all meals sum to approximately {protein_target}g (within ±10%)?
   If actual protein < {protein_target}g × 0.9, you MUST add more protein to meals:
   - Add paneer (100g = 18g protein), boiled eggs (1 egg = 6g protein), chicken breast (100g = 31g protein),
     dal (200g = 18g protein), curd (200g = 7g protein), or whey protein (30g = 24g protein)
   - Increase quantities of existing protein-rich items already in the meal
   Do NOT skip this check. Protein target adherence is mandatory.
6. Does total fat sum to approximately {fat_target}g? If under, add ghee (1 tsp = 5g fat, 45 kcal)
   to main meals or include nuts in snacks.
Only return the JSON after confirming no repeats exist within any single day and macro totals hit targets."""

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
    7: [
        "Breakfast",
        "Mid-Morning Snack",
        "Lunch",
        "Post_Workout",
        "Afternoon Snack",
        "Evening Snack",
        "Dinner",
    ],
}

MEAL_SLOT_DEFINITIONS: dict[int, list[dict[str, str]]] = {
    2: [
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "large main meal"},
        {"meal_type": "Dinner", "time": "8:00 PM", "character": "moderate evening meal"},
    ],
    3: [
        {"meal_type": "Breakfast", "time": "8:00 AM", "character": "morning dish"},
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "largest meal of the day"},
        {"meal_type": "Dinner", "time": "8:00 PM", "character": "lighter evening meal"},
    ],
    4: [
        {"meal_type": "Breakfast", "time": "8:00 AM", "character": "morning dish"},
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "largest meal of the day"},
        {"meal_type": "Snack", "time": "4:00 PM", "character": "small light snack only"},
        {"meal_type": "Dinner", "time": "8:00 PM", "character": "lighter evening meal"},
    ],
    5: [
        {"meal_type": "Breakfast", "time": "8:00 AM", "character": "morning dish"},
        {"meal_type": "Mid-Morning Snack", "time": "10:30 AM", "character": "very light snack, fruit or nuts only"},
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "largest meal of the day"},
        {"meal_type": "Evening Snack", "time": "5:00 PM", "character": "small light snack, different from mid-morning"},
        {"meal_type": "Dinner", "time": "8:00 PM", "character": "lighter evening meal"},
    ],
    6: [
        {"meal_type": "Breakfast", "time": "8:00 AM", "character": "proper morning dish like poha or idli"},
        {
            "meal_type": "Mid-Morning Snack",
            "time": "10:30 AM",
            "character": "very light - just fruit, nuts, or buttermilk. NOT a cooked dish.",
        },
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "largest meal - dal/curry + rice/roti + salad"},
        {
            "meal_type": "Post_Workout",
            "time": "4:00 PM",
            "character": "protein-focused recovery - paneer/eggs/chicken + 1 roti or rice",
        },
        {
            "meal_type": "Evening Snack",
            "time": "6:00 PM",
            "character": "very light - makhana, roasted chana, or chai with biscuits only",
        },
        {"meal_type": "Dinner", "time": "8:00 PM", "character": "lighter than lunch - 1-2 roti + sabzi or light curry"},
    ],
    7: [
        {"meal_type": "Breakfast", "time": "7:30 AM", "character": "proper morning dish"},
        {"meal_type": "Mid-Morning Snack", "time": "10:00 AM", "character": "very light - fruit or nuts only"},
        {"meal_type": "Lunch", "time": "1:00 PM", "character": "largest meal"},
        {"meal_type": "Post_Workout", "time": "3:30 PM", "character": "protein-focused recovery meal"},
        {"meal_type": "Afternoon Snack", "time": "5:00 PM", "character": "light snack, different from mid-morning"},
        {"meal_type": "Evening Snack", "time": "6:30 PM", "character": "very light - tea/coffee with 1-2 biscuits only"},
        {"meal_type": "Dinner", "time": "8:30 PM", "character": "lighter than lunch"},
    ],
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


def get_user_nutrition_targets(db: Session, user: User) -> dict[str, int | float]:
    """
    Nutrition targets from the same source as Calorie Log (resolve_user_targets).
    """
    from src.routes.calories import resolve_user_targets

    resolved = resolve_user_targets(db, user)
    target_kcal = int(resolved.get("target_calories") or 0)
    protein_g = int(float(resolved.get("target_protein_g") or 0))
    carbs_g = int(float(resolved.get("target_carbs_g") or 0))
    fat_g = int(float(resolved.get("target_fat_g") or 0))
    fiber_g = int(float(resolved.get("target_fiber_g") or 30))
    water_l = float(resolved.get("target_water_l") or 2.5)
    if target_kcal < 1 or protein_g < 1:
        raise HTTPException(
            status_code=404,
            detail="User nutrition targets not found. Complete onboarding first.",
        )
    out = {
        "target_kcal": target_kcal,
        "protein_target": protein_g,
        "carbs_target": carbs_g,
        "fat_target": fat_g,
        "fiber_target": fiber_g,
        "water_target_l": water_l,
    }
    logger.info(
        "[MealPlanner] resolve_user_targets for user %s: kcal=%s, P=%sg, C=%sg, F=%sg",
        user.id,
        target_kcal,
        protein_g,
        carbs_g,
        fat_g,
    )
    return out


def _verify_meal_planner_targets(ctx: dict[str, Any]) -> None:
    target_kcal = int(ctx["target_kcal"])
    protein_target = int(ctx["protein_target"])
    carbs_target = int(ctx["carbs_target"])
    fat_target = int(ctx["fat_target"])
    if target_kcal <= 1000:
        raise ValueError(f"target_kcal looks too low: {target_kcal}")
    if protein_target <= 0:
        raise ValueError(f"protein_target is zero or missing: {protein_target}")
    logger.info(
        "[MealPlanner] VERIFIED targets: kcal=%s, P=%sg, C=%sg, F=%sg",
        target_kcal,
        protein_target,
        carbs_target,
        fat_target,
    )


def _monthly_day_regen_stats(
    db: Session,
    user_id: int,
    month: int,
    year: int,
    *,
    user: User | None = None,
) -> dict[str, int | bool]:
    if user and is_meal_planner_test_user(user):
        return meal_planner_unlimited_regen_stats()

    plans = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
        )
        .all()
    )
    used = sum(int(p.day_regens_used or 0) for p in plans)
    limit = int(plans[0].day_regens_limit or MONTHLY_DAY_REGEN_LIMIT) if plans else MONTHLY_DAY_REGEN_LIMIT
    remaining = max(0, limit - used)
    return {
        "day_regens_used": used,
        "day_regens_limit": limit,
        "day_regens_remaining": remaining,
        **meal_planner_limits_exempt_flag(user),
    }


def _attach_day_regen_stats(payload: dict[str, Any], stats: dict[str, int]) -> dict[str, Any]:
    payload.update(stats)
    return payload


def _plan_targets_dict(plan: MonthlyMealPlan, db: Session, user: User) -> dict[str, int]:
    if plan.target_kcal and plan.target_protein_g:
        return {
            "kcal": int(plan.target_kcal),
            "protein_g": int(plan.target_protein_g),
            "carbs_g": int(plan.target_carbs_g or 0),
            "fat_g": int(plan.target_fat_g or 0),
            "fiber_g": int(plan.target_fiber_g or 30),
        }
    nutrition = get_user_nutrition_targets(db, user)
    return {
        "kcal": int(nutrition["target_kcal"]),
        "protein_g": int(nutrition["protein_target"]),
        "carbs_g": int(nutrition["carbs_target"]),
        "fat_g": int(nutrition["fat_target"]),
        "fiber_g": int(nutrition["fiber_target"]),
    }


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
    count = max(2, min(7, int(meals_per_day)))
    return list(MEAL_SLOTS_BY_COUNT.get(count, MEAL_SLOTS_BY_COUNT[3]))


def get_meal_slots(meals_per_day: int) -> list[dict[str, str]]:
    count = max(2, min(7, int(meals_per_day)))
    return list(MEAL_SLOT_DEFINITIONS.get(count, MEAL_SLOT_DEFINITIONS[3]))


def _meal_slot_calorie_fractions(meals_per_day: int) -> dict[str, float]:
    """Per-meal share of daily calories for a given meals-per-day setting."""
    distributions: dict[int, list[tuple[str, float]]] = {
        2: [("Lunch", 0.45), ("Dinner", 0.55)],
        3: [("Breakfast", 0.30), ("Lunch", 0.40), ("Dinner", 0.30)],
        4: [("Breakfast", 0.25), ("Lunch", 0.38), ("Snack", 0.12), ("Dinner", 0.25)],
        5: [
            ("Breakfast", 0.22),
            ("Mid-Morning Snack", 0.08),
            ("Lunch", 0.32),
            ("Evening Snack", 0.08),
            ("Dinner", 0.30),
        ],
        6: [
            ("Breakfast", 0.20),
            ("Mid-Morning Snack", 0.07),
            ("Lunch", 0.28),
            ("Post_Workout", 0.15),
            ("Evening Snack", 0.07),
            ("Dinner", 0.23),
        ],
        7: [
            ("Breakfast", 0.18),
            ("Mid-Morning Snack", 0.06),
            ("Lunch", 0.25),
            ("Post_Workout", 0.13),
            ("Afternoon Snack", 0.06),
            ("Evening Snack", 0.07),
            ("Dinner", 0.25),
        ],
    }
    slots = distributions.get(meals_per_day, distributions[3])
    return {name: pct for name, pct in slots}


def build_calorie_allocation(target_kcal: int, meals_per_day: int) -> str:
    """Per-slot kcal targets for the system prompt."""
    lines = []
    for meal_name, pct in _meal_slot_calorie_fractions(meals_per_day).items():
        kcal = round(target_kcal * pct)
        lines.append(f"  - {meal_name}: ~{kcal} kcal ({round(pct * 100)}% of daily target)")
    return "\n".join(lines)


def _sum_day_calories(meals: list[dict[str, Any]]) -> int:
    total = 0
    for meal in meals:
        if not isinstance(meal, dict):
            continue
        meal_kcal = int(meal.get("total_calories") or 0)
        if meal_kcal <= 0:
            for item in meal.get("items") or []:
                if isinstance(item, dict):
                    meal_kcal += int(item.get("calories") or 0)
        total += meal_kcal
    return total


def _sum_day_macro(meals: list[dict[str, Any]], macro: str) -> float:
    total = 0.0
    for meal in meals:
        if not isinstance(meal, dict):
            continue
        if macro == "protein":
            total += float(meal.get("total_protein") or 0)
        elif macro == "carbs":
            total += float(meal.get("total_carbs") or 0)
        else:
            total += float(meal.get("total_fat") or 0)
    return total


def _scale_meal_items(meal: dict[str, Any], factor: float) -> None:
    if factor <= 0 or abs(factor - 1.0) < 0.01:
        return
    for item in meal.get("items") or []:
        if not isinstance(item, dict):
            continue
        item["quantity_g"] = max(1, round(float(item.get("quantity_g") or 0) * factor))
        item["calories"] = max(1, round(float(item.get("calories") or 0) * factor))
        item["protein"] = round(float(item.get("protein") or 0) * factor, 1)
        item["carbs"] = round(float(item.get("carbs") or 0) * factor, 1)
        item["fat"] = round(float(item.get("fat") or 0) * factor, 1)
    _recalc_meal_totals(meal)


def _scale_all_meals(meals: list[dict[str, Any]], factor: float) -> None:
    for meal in meals:
        if isinstance(meal, dict):
            _scale_meal_items(meal, factor)


def _align_day_calories_to_target(
    meals: list[dict[str, Any]],
    *,
    target_kcal: int,
    tolerance: float = 0.03,
) -> float:
    """Scale all meals so daily calories match the user's target (up or down). Returns final factor."""
    actual_kcal = _sum_day_calories(meals)
    if target_kcal <= 0 or actual_kcal <= 0:
        return 1.0
    ratio = actual_kcal / target_kcal
    if abs(ratio - 1.0) <= tolerance:
        return 1.0
    factor = target_kcal / actual_kcal
    _scale_all_meals(meals, factor)
    return factor


def validate_and_scale_day(
    day_data: dict[str, Any],
    *,
    target_kcal: int,
    target_protein: int,
    target_carbs: int,
    target_fat: int,
) -> dict[str, Any]:
    """Dynamically scale each day to the user's nutrition targets (from Calorie Log / onboarding)."""
    meals = day_data.get("meals")
    if not isinstance(meals, list) or not meals or day_data.get("is_cheat_day"):
        return day_data

    meals = [m for m in meals if isinstance(m, dict)]
    meals_per_day = len(meals)
    slot_fracs = _meal_slot_calorie_fractions(meals_per_day)

    actual_kcal = _sum_day_calories(meals)
    logger.info(
        "[MealPlanner] Day %s before scaling: %s kcal (target %s kcal, P %s/%s, C %s/%s, F %s/%s)",
        day_data.get("day"),
        actual_kcal,
        target_kcal,
        round(_sum_day_macro(meals, "protein")),
        target_protein,
        round(_sum_day_macro(meals, "carbs")),
        target_carbs,
        round(_sum_day_macro(meals, "fat")),
        target_fat,
    )

    # Step 1 — per-meal alignment to slot calorie budget (derived from user's daily target)
    for meal in meals:
        meal_type = str(meal.get("meal_type", ""))
        pct = slot_fracs.get(meal_type, 1.0 / max(meals_per_day, 1))
        meal_target_kcal = target_kcal * pct
        meal_actual = int(meal.get("total_calories") or 0)
        if meal_actual <= 0:
            for item in meal.get("items") or []:
                if isinstance(item, dict):
                    meal_actual += int(item.get("calories") or 0)
        if meal_actual <= 0 or meal_target_kcal <= 0:
            continue
        meal_ratio = meal_actual / meal_target_kcal
        if meal_ratio < 0.75 or meal_ratio > 1.35:
            _scale_meal_items(meal, meal_target_kcal / meal_actual)

    # Step 2 — whole-day calorie match (always scale up OR down to within ~3%)
    kcal_factor = _align_day_calories_to_target(meals, target_kcal=target_kcal, tolerance=0.03)

    # Step 3 — protein: boost protein-dense items if low, then re-lock calories
    actual_protein = _sum_day_macro(meals, "protein")
    if target_protein > 0 and actual_protein < target_protein * 0.90:
        protein_factor = min(target_protein / max(actual_protein, 1), 1.35)
        for meal in meals:
            for item in meal.get("items") or []:
                if not isinstance(item, dict):
                    continue
                item_cal = float(item.get("calories") or 0)
                item_protein = float(item.get("protein") or 0)
                if item_cal > 0 and (item_protein / item_cal) >= 0.05:
                    item["quantity_g"] = max(1, round(float(item.get("quantity_g") or 0) * protein_factor))
                    item["calories"] = max(1, round(float(item.get("calories") or 0) * protein_factor))
                    item["protein"] = round(item_protein * protein_factor, 1)
                    item["carbs"] = round(float(item.get("carbs") or 0) * protein_factor, 1)
                    item["fat"] = round(float(item.get("fat") or 0) * protein_factor, 1)
            _recalc_meal_totals(meal)
        _align_day_calories_to_target(meals, target_kcal=target_kcal, tolerance=0.03)

    # Step 4 — gentle carbs/fat nudge without breaking calorie lock
    actual_carbs = _sum_day_macro(meals, "carbs")
    actual_fat = _sum_day_macro(meals, "fat")
    if target_carbs > 0 and actual_carbs > target_carbs * 1.20:
        carb_factor = target_carbs / max(actual_carbs, 1)
        for meal in meals:
            for item in meal.get("items") or []:
                if not isinstance(item, dict):
                    continue
                item_cal = float(item.get("calories") or 0)
                item_carbs = float(item.get("carbs") or 0)
                if item_cal > 0 and (item_carbs / item_cal) >= 0.08:
                    item["quantity_g"] = max(1, round(float(item.get("quantity_g") or 0) * carb_factor))
                    item["calories"] = max(1, round(float(item.get("calories") or 0) * carb_factor))
                    item["protein"] = round(float(item.get("protein") or 0) * carb_factor, 1)
                    item["carbs"] = round(item_carbs * carb_factor, 1)
                    item["fat"] = round(float(item.get("fat") or 0) * carb_factor, 1)
            _recalc_meal_totals(meal)
        _align_day_calories_to_target(meals, target_kcal=target_kcal, tolerance=0.03)

    actual_fat = _sum_day_macro(meals, "fat")
    if target_fat > 0 and actual_fat < target_fat * 0.80:
        fat_factor = min(target_fat / max(actual_fat, 1), 1.25)
        for meal in meals:
            for item in meal.get("items") or []:
                if not isinstance(item, dict):
                    continue
                item_cal = float(item.get("calories") or 0)
                item_fat = float(item.get("fat") or 0)
                if item_cal > 0 and (item_fat / item_cal) >= 0.06:
                    item["quantity_g"] = max(1, round(float(item.get("quantity_g") or 0) * fat_factor))
                    item["calories"] = max(1, round(float(item.get("calories") or 0) * fat_factor))
                    item["protein"] = round(float(item.get("protein") or 0) * fat_factor, 1)
                    item["carbs"] = round(float(item.get("carbs") or 0) * fat_factor, 1)
                    item["fat"] = round(item_fat * fat_factor, 1)
            _recalc_meal_totals(meal)
        _align_day_calories_to_target(meals, target_kcal=target_kcal, tolerance=0.03)

    final_kcal = _sum_day_calories(meals)
    logger.info(
        "[MealPlanner] Day %s after scaling: %s kcal (target %s, factor %.2f), P %.0fg C %.0fg F %.0fg",
        day_data.get("day"),
        final_kcal,
        target_kcal,
        kcal_factor,
        _sum_day_macro(meals, "protein"),
        _sum_day_macro(meals, "carbs"),
        _sum_day_macro(meals, "fat"),
    )

    day_data["meals"] = meals
    return day_data


def _totals_from_meals_list(meals: list[dict[str, Any]]) -> dict[str, int]:
    cal = protein = carbs = fat = fiber = 0
    for meal in meals:
        if not isinstance(meal, dict):
            continue
        cal += int(meal.get("total_calories") or 0)
        protein += int(round(float(meal.get("total_protein") or 0)))
        carbs += int(round(float(meal.get("total_carbs") or 0)))
        fat += int(round(float(meal.get("total_fat") or 0)))
        fiber += int(meal.get("total_fiber") or 0)
    return {
        "total_calories": cal,
        "total_protein_g": protein,
        "total_carbs_g": carbs,
        "total_fat_g": fat,
        "total_fiber_g": max(fiber, 15),
    }


FALLBACK_ITEMS_BY_MEAL_TYPE: dict[str, list[dict[str, Any]]] = {
    "Breakfast": [
        {"food": "Upma", "quantity_g": 200, "calories": 220, "protein": 6, "carbs": 38, "fat": 5},
        {"food": "Coconut", "quantity_g": 15, "calories": 45, "protein": 0, "carbs": 2, "fat": 4},
        {"food": "Banana", "quantity_g": 100, "calories": 89, "protein": 1, "carbs": 23, "fat": 0},
    ],
    "Lunch": [
        {"food": "Kadhi", "quantity_g": 200, "calories": 180, "protein": 8, "carbs": 22, "fat": 6},
        {"food": "Rice", "quantity_g": 150, "calories": 195, "protein": 4, "carbs": 42, "fat": 1},
        {"food": "Papad", "quantity_g": 20, "calories": 35, "protein": 2, "carbs": 5, "fat": 1},
    ],
    "Dinner": [
        {"food": "Dal tadka", "quantity_g": 200, "calories": 160, "protein": 10, "carbs": 22, "fat": 4},
        {"food": "Jeera rice", "quantity_g": 150, "calories": 195, "protein": 4, "carbs": 40, "fat": 2},
        {"food": "Raita", "quantity_g": 100, "calories": 55, "protein": 3, "carbs": 6, "fat": 2},
    ],
    "Snack": [
        {"food": "Makhana", "quantity_g": 30, "calories": 106, "protein": 4, "carbs": 20, "fat": 1},
        {"food": "Roasted chana", "quantity_g": 30, "calories": 111, "protein": 7, "carbs": 17, "fat": 2},
    ],
    "Mid-Morning Snack": [
        {"food": "Apple", "quantity_g": 150, "calories": 78, "protein": 0, "carbs": 21, "fat": 0},
        {"food": "Roasted chana", "quantity_g": 30, "calories": 111, "protein": 7, "carbs": 17, "fat": 2},
        {"food": "Walnuts", "quantity_g": 20, "calories": 131, "protein": 3, "carbs": 3, "fat": 13},
    ],
    "Afternoon Snack": [
        {"food": "Fruit chaat", "quantity_g": 150, "calories": 90, "protein": 1, "carbs": 22, "fat": 0},
        {"food": "Coconut water", "quantity_g": 250, "calories": 45, "protein": 1, "carbs": 9, "fat": 0},
    ],
    "Evening Snack": [
        {"food": "Makhana", "quantity_g": 30, "calories": 106, "protein": 4, "carbs": 20, "fat": 1},
        {"food": "Roasted peanuts", "quantity_g": 30, "calories": 170, "protein": 8, "carbs": 5, "fat": 14},
        {"food": "Buttermilk", "quantity_g": 200, "calories": 40, "protein": 3, "carbs": 5, "fat": 1},
    ],
    "Post_Workout": [
        {"food": "Boiled eggs", "quantity_g": 120, "calories": 186, "protein": 16, "carbs": 1, "fat": 12},
        {"food": "Sprouts", "quantity_g": 100, "calories": 97, "protein": 7, "carbs": 16, "fat": 1},
    ],
    "Pre_Workout": [
        {"food": "Banana", "quantity_g": 120, "calories": 107, "protein": 1, "carbs": 27, "fat": 0},
        {"food": "Peanut butter", "quantity_g": 20, "calories": 118, "protein": 5, "carbs": 4, "fat": 10},
    ],
}

SLOT_TEMPLATE_KEY: dict[str, str] = {
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


def _meal_has_content(meal: dict[str, Any]) -> bool:
    items = meal.get("items") or []
    if not isinstance(items, list) or not items:
        return False
    return any(isinstance(i, dict) and int(i.get("calories") or 0) > 0 for i in items)


def _recalc_meal_totals(meal: dict[str, Any]) -> None:
    items = [i for i in (meal.get("items") or []) if isinstance(i, dict)]
    meal["items"] = items
    meal["total_calories"] = sum(int(i.get("calories") or 0) for i in items)
    meal["total_protein"] = round(sum(float(i.get("protein") or 0) for i in items), 1)
    meal["total_carbs"] = round(sum(float(i.get("carbs") or 0) for i in items), 1)
    meal["total_fat"] = round(sum(float(i.get("fat") or 0) for i in items), 1)


def _fallback_items_for_meal_type(meal_type: str, *, day_index: int = 0) -> list[dict[str, Any]]:
    preset = FALLBACK_ITEMS_BY_MEAL_TYPE.get(meal_type)
    if preset:
        return [dict(i) for i in preset]
    lookup = {str(f["food"]).lower(): f for f in BUDGET_FOODS}
    tpl = FALLBACK_DAY_TEMPLATES[day_index % len(FALLBACK_DAY_TEMPLATES)]
    key = SLOT_TEMPLATE_KEY.get(meal_type, "lunch")
    return _items_from_template(tpl.get(key, tpl["lunch"]), lookup)


def _resolve_meal_type(meal_type: str, expected_slots: list[str]) -> str | None:
    raw = str(meal_type or "").strip()
    if not raw:
        return None
    for slot in expected_slots:
        if raw.lower() == slot.lower():
            return slot
    aliases = {
        "mid morning snack": "Mid-Morning Snack",
        "evening snack": "Evening Snack",
        "afternoon snack": "Afternoon Snack",
        "post workout": "Post_Workout",
        "pre workout": "Pre_Workout",
    }
    return aliases.get(raw.lower())


def _next_unique_fallback_item(
    meal_type: str,
    seen_foods: set[str],
    *,
    day_index: int = 0,
) -> dict[str, Any] | None:
    for item in _fallback_items_for_meal_type(meal_type, day_index=day_index):
        name = str(item.get("food", "")).lower().strip()
        if name and name not in seen_foods:
            return dict(item)
    lookup = {str(f["food"]).lower(): f for f in BUDGET_FOODS}
    tpl = FALLBACK_DAY_TEMPLATES[day_index % len(FALLBACK_DAY_TEMPLATES)]
    key = SLOT_TEMPLATE_KEY.get(meal_type, "lunch")
    for name, qty in tpl.get(key, tpl["lunch"]):
        if name.lower() not in seen_foods:
            base = lookup.get(name.lower()) or BUDGET_FOODS[0]
            cal = int(base["cal_per_100g"] * qty / 100)
            p = int(base["protein_per_100g"] * qty / 100)
            return {
                "food": name,
                "quantity_g": qty,
                "calories": cal,
                "protein": p,
                "carbs": int(cal * 0.55 / 4),
                "fat": int(cal * 0.25 / 9),
            }
    return None


def fix_day_meal_duplicates(day_data: dict[str, Any]) -> dict[str, Any]:
    """Remove duplicate food items across meals in the same day."""
    seen_foods: set[str] = set()
    day_num = int(day_data.get("day") or 1)

    for meal in day_data.get("meals", []):
        if not isinstance(meal, dict):
            continue
        meal_type = str(meal.get("meal_type", ""))
        clean_items: list[dict[str, Any]] = []
        for item in meal.get("items") or []:
            if not isinstance(item, dict):
                continue
            food_name = str(item.get("food", "")).lower().strip()
            if not food_name:
                continue
            if food_name not in seen_foods:
                seen_foods.add(food_name)
                clean_items.append(item)
            else:
                logger.warning(
                    "Duplicate food '%s' in %s on day %s — replacing",
                    item.get("food"),
                    meal_type,
                    day_data.get("day"),
                )
                replacement = _next_unique_fallback_item(meal_type, seen_foods, day_index=day_num)
                if replacement:
                    seen_foods.add(str(replacement["food"]).lower())
                    clean_items.append(replacement)

        meal["items"] = clean_items
        if clean_items:
            _recalc_meal_totals(meal)
        else:
            meal["total_calories"] = 0
            meal["total_protein"] = 0
            meal["total_carbs"] = 0
            meal["total_fat"] = 0

    return day_data


def ensure_complete_meal_slots(day_data: dict[str, Any], meals_per_day: int) -> dict[str, Any]:
    """Guarantee every required meal slot exists with at least one food item."""
    expected_slots = _meal_slots_for_count(meals_per_day)
    meals_raw = day_data.get("meals") or []
    by_type: dict[str, dict[str, Any]] = {}
    extras: list[dict[str, Any]] = []

    for meal in meals_raw:
        if not isinstance(meal, dict):
            continue
        resolved = _resolve_meal_type(str(meal.get("meal_type", "")), expected_slots)
        if resolved and resolved not in by_type:
            meal["meal_type"] = resolved
            by_type[resolved] = meal
        else:
            extras.append(meal)

    day_num = int(day_data.get("day") or 1)
    completed: list[dict[str, Any]] = []
    global_seen: set[str] = set()

    for slot in expected_slots:
        meal = by_type.get(slot)
        if meal and _meal_has_content(meal):
            completed.append(meal)
            for item in meal.get("items") or []:
                if isinstance(item, dict):
                    global_seen.add(str(item.get("food", "")).lower().strip())
            continue

        if meal and not _meal_has_content(meal):
            logger.warning(
                "[MealPlanner] Day %s %s had no items — filling from fallback",
                day_data.get("day"),
                slot,
            )

        items: list[dict[str, Any]] = []
        for item in _fallback_items_for_meal_type(slot, day_index=day_num):
            name = str(item.get("food", "")).lower().strip()
            if name and name not in global_seen:
                global_seen.add(name)
                items.append(dict(item))
        if not items:
            single = _next_unique_fallback_item(slot, global_seen, day_index=day_num)
            if single:
                global_seen.add(str(single["food"]).lower())
                items.append(single)

        completed.append(
            _build_meal_from_items(slot, MEAL_TIMES.get(slot, "1:00 PM"), items),
        )

    day_data["meals"] = completed
    return day_data


def _build_meal_system_prompt(ctx: dict[str, Any], chunk_index: int, *, has_prior_context: bool = False) -> str:
    allergies = ctx.get("allergies") or []
    meals_per_day = int(ctx["meals_per_day"])
    target_kcal = int(ctx["target_kcal"])
    prompt = MEAL_SYSTEM_PROMPT_BASE.format(
        target_kcal=target_kcal,
        protein_target=ctx["protein_target"],
        carbs_target=ctx["carbs_target"],
        fat_target=ctx["fat_target"],
        fiber_target=ctx["fiber_target"],
        meals_per_day=meals_per_day,
        avg_meal_kcal=round(target_kcal / max(meals_per_day, 1)),
        calorie_allocation=build_calorie_allocation(target_kcal, meals_per_day),
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


def get_chunk_size_for_meals(meals_per_day: int) -> int:
    """Smaller chunks for more meals/day to avoid token truncation."""
    if meals_per_day <= 4:
        return 7
    if meals_per_day <= 5:
        return 5
    return 4


def _meal_chunk_max_tokens(meals_per_day: int, chunk_size: int = 7) -> int:
    table = {
        2: 3000,
        3: 3500,
        4: 4500,
        5: 6500,
        6: 7500,
        7: 8000,
    }
    base = table.get(meals_per_day, 4500)
    if chunk_size < 7:
        base = int(base * (chunk_size / 7) * 1.2)
    return max(1500, min(base, 8000))


def _is_single_day_request(user_message: dict[str, Any]) -> bool:
    days = user_message.get("days")
    return isinstance(days, list) and len(days) == 1


def _days_have_correct_meal_count(days: list[dict[str, Any]], expected_count: int) -> tuple[bool, list[Any]]:
    """Returns (all_correct, list_of_short_day_numbers)."""
    short_days: list[Any] = []
    for d in days:
        meals = [m for m in (d.get("meals") or []) if isinstance(m, dict)]
        if len(meals) < expected_count:
            short_days.append(d.get("day", "?"))
            continue
        empty_slots = [
            m.get("meal_type")
            for m in meals
            if not _meal_has_content(m)
        ]
        if empty_slots:
            short_days.append(d.get("day", "?"))
    return len(short_days) == 0, short_days


def _groq_meal_chunk(
    system_prompt: str,
    user_message: dict[str, Any],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    user_id: int | None = None,
    ai_feature: str = "meal_plan_generation",
    endpoint: str = "/api/meal-planner/generate",
) -> list[dict[str, Any]]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing")
    meals_per_day = int(user_message.get("meals_per_day") or 3)
    chunk_days = user_message.get("days")
    chunk_size = len(chunk_days) if isinstance(chunk_days, list) else 7
    single_day = _is_single_day_request(user_message)
    token_limit = max_tokens
    if token_limit is None:
        token_limit = 1500 if single_day else _meal_chunk_max_tokens(meals_per_day, chunk_size)
    temp = temperature if temperature is not None else (0.7 if single_day else 0.6)
    model_name = settings.GROQ_MODEL or "llama-3.3-70b-versatile"
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": model_name,
            "temperature": temp,
            "max_tokens": token_limit,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_message)},
            ],
        },
        timeout=90,
    )
    try:
        log_groq_call(
            user_id=user_id,
            feature=ai_feature,
            model=model_name,
            endpoint=endpoint,
            response_json=raw,
        )
    except Exception:
        pass
    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    return parse_groq_json_array(content)


def _gemini_meal_chunk(
    system_prompt: str,
    user_message: dict[str, Any],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    user_id: int | None = None,
    ai_feature: str = "meal_plan_generation",
    endpoint: str = "/api/meal-planner/generate",
) -> list[dict[str, Any]]:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing")
    meals_per_day = int(user_message.get("meals_per_day") or 3)
    chunk_days = user_message.get("days")
    chunk_size = len(chunk_days) if isinstance(chunk_days, list) else 7
    single_day = _is_single_day_request(user_message)
    token_limit = max_tokens
    if token_limit is None:
        token_limit = 1500 if single_day else _meal_chunk_max_tokens(meals_per_day, chunk_size)
    temp = temperature if temperature is not None else (0.7 if single_day else 0.6)
    model = settings.GEMINI_MODEL or "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.GEMINI_API_KEY}"
    raw = post_json(
        url,
        headers={"Content-Type": "application/json"},
        payload={
            "contents": [{"role": "user", "parts": [{"text": system_prompt + "\n\n" + json.dumps(user_message)}]}],
            "generationConfig": {
                "temperature": temp,
                "maxOutputTokens": token_limit,
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    try:
        log_gemini_call(
            user_id=user_id,
            feature=ai_feature,
            model=model,
            endpoint=endpoint,
            response_json=raw,
            is_fallback=True,
        )
    except Exception:
        pass
    parts = (raw.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    content = parts[0].get("text", "") if parts else ""
    return parse_groq_json_array(content)


def _validate_parsed_chunk(
    raw_days: list[dict[str, Any]],
    days: list[int],
    scale_targets: dict[str, int],
    meals_per_day: int,
) -> list[dict[str, Any]] | None:
    validated = [_validate_meal_day(d, scale_targets=scale_targets) for d in raw_days]
    validated = [d for d in validated if d]
    if len(validated) < len(days):
        return None
    result = _align_chunk_days(validated, days)
    all_correct, short_days = _days_have_correct_meal_count(result, meals_per_day)
    if not all_correct:
        logger.warning(
            "[MealPlanner] Days %s have fewer than %s meals (expected %s)",
            short_days,
            meals_per_day - 1,
            meals_per_day,
        )
        return None
    return result


def _validate_meal_day(
    day_obj: dict[str, Any],
    *,
    scale_targets: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    if not isinstance(day_obj.get("day"), int):
        return None
    meals_raw = day_obj.get("meals")
    if not isinstance(meals_raw, list) or not meals_raw:
        return None
    meals_per_day = int(scale_targets.get("meals_per_day") or len(meals_raw)) if scale_targets else len(meals_raw)
    day_obj = fix_day_meal_duplicates(day_obj)
    day_obj = ensure_complete_meal_slots(day_obj, meals_per_day)
    if scale_targets and not day_obj.get("is_cheat_day"):
        day_obj = validate_and_scale_day(
            day_obj,
            target_kcal=int(scale_targets["target_kcal"]),
            target_protein=int(scale_targets["protein_target"]),
            target_carbs=int(scale_targets["carbs_target"]),
            target_fat=int(scale_targets["fat_target"]),
        )
    meals_raw = day_obj.get("meals")
    meals = [_normalize_meal(m) for m in meals_raw if isinstance(m, dict)]
    if not meals:
        return None
    totals = _totals_from_meals_list(meals)
    return {
        "day": int(day_obj["day"]),
        "is_cheat_day": bool(day_obj.get("is_cheat_day")),
        "meals": meals,
        **totals,
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
    onboarding, _targets = _onboarding_context(db, user.id)
    nutrition = get_user_nutrition_targets(db, user)
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    personal = onboarding.get("personal") if isinstance(onboarding.get("personal"), dict) else {}
    app_setup = onboarding.get("app_setup") if isinstance(onboarding.get("app_setup"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    meals_per_day = int(dietary.get("meals_per_day") or 3)
    return {
        "target_kcal": int(nutrition["target_kcal"]),
        "protein_target": int(nutrition["protein_target"]),
        "carbs_target": int(nutrition["carbs_target"]),
        "fat_target": int(nutrition["fat_target"]),
        "fiber_target": int(nutrition["fiber_target"]),
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
        "water_target_l": float(nutrition["water_target_l"]),
        "food_dataset_sample": _food_dataset_sample(db),
    }


def _align_chunk_days(validated: list[dict[str, Any]], requested_days: list[int]) -> list[dict[str, Any]]:
    """Map AI day objects to the calendar day numbers we asked for (Groq often returns 1–7)."""
    aligned: list[dict[str, Any]] = []
    for i, day_data in enumerate(validated[: len(requested_days)]):
        row = dict(day_data)
        row["day"] = int(requested_days[i])
        aligned.append(row)
    return aligned


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
    user_id: int | None = None,
    ai_feature: str = "meal_plan_generation",
    endpoint: str = "/api/meal-planner/generate",
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
        "meal_slots": get_meal_slots(meals_per_day),
        "rule": (
            "Generate meals in EXACTLY this order and slot sequence. "
            "Each meal_type in your response must match these slots exactly. "
            "No two meals can share any food item."
        ),
        "day_number_rule": (
            "Each day object MUST use the exact integer from the days array as its day field "
            "(e.g. if days is [17,18,19], return day 17 then 18 then 19 — never 1,2,3)."
        ),
    }
    if prev_breakfasts:
        user_msg["previous_week_breakfasts"] = prev_breakfasts
    if prev_dinners:
        user_msg["previous_week_dinners"] = prev_dinners
    _verify_meal_planner_targets(ctx)
    assert int(ctx["target_kcal"]) > 1000, f"[MealPlanner] target_kcal too low: {ctx['target_kcal']}"
    assert int(ctx["protein_target"]) > 0, "[MealPlanner] protein_target is 0"
    logger.info(
        "[MealPlanner] Chunk targets: kcal=%s, P=%sg, C=%sg, F=%sg, days=%s",
        ctx["target_kcal"],
        ctx["protein_target"],
        ctx["carbs_target"],
        ctx["fat_target"],
        days,
    )
    scale_targets = {
        "target_kcal": int(ctx["target_kcal"]),
        "protein_target": int(ctx["protein_target"]),
        "carbs_target": int(ctx["carbs_target"]),
        "fat_target": int(ctx["fat_target"]),
        "meals_per_day": meals_per_day,
    }
    chunk_size = len(days)

    for attempt in range(2):
        try:
            raw_days = _groq_meal_chunk(
                system_prompt,
                user_msg,
                user_id=user_id,
                ai_feature=ai_feature,
                endpoint=endpoint,
            )
            result = _validate_parsed_chunk(raw_days, days, scale_targets, meals_per_day)
            if result is not None:
                _log_meal_day_counts(result, meals_per_day)
                return result, "groq"
            _, short_days = _days_have_correct_meal_count(
                _align_chunk_days(
                    [d for d in (_validate_meal_day(x, scale_targets=scale_targets) for x in raw_days) if d],
                    days,
                )
                if raw_days
                else [],
                meals_per_day,
            )
            logger.warning(
                "[MealPlanner] Groq chunk incomplete (short days: %s) — retrying with higher token limit",
                short_days,
            )
            retry_msg = dict(user_msg)
            retry_msg["URGENT_RETRY_REASON"] = (
                f"Previous attempt returned fewer than {meals_per_day} meals per day. "
                f"You MUST return EXACTLY {meals_per_day} meals for EVERY day. "
                f"Do not stop early. Complete all {len(days)} days fully."
            )
            retry_tokens = min(_meal_chunk_max_tokens(meals_per_day, chunk_size) + 2000, 8000)
            raw_days = _groq_meal_chunk(
                system_prompt,
                retry_msg,
                max_tokens=retry_tokens,
                temperature=0.5,
                user_id=user_id,
                ai_feature=ai_feature,
                endpoint=endpoint,
            )
            result = _validate_parsed_chunk(raw_days, days, scale_targets, meals_per_day)
            if result is not None:
                _log_meal_day_counts(result, meals_per_day)
                return result, "groq"
        except Exception:
            if attempt == 0:
                continue
        try:
            raw_days = _gemini_meal_chunk(
                system_prompt,
                user_msg,
                user_id=user_id,
                ai_feature=ai_feature,
                endpoint=endpoint,
            )
            result = _validate_parsed_chunk(raw_days, days, scale_targets, meals_per_day)
            if result is not None:
                _log_meal_day_counts(result, meals_per_day)
                return result, "gemini"
            retry_msg = dict(user_msg)
            retry_msg["URGENT_RETRY_REASON"] = (
                f"You MUST return EXACTLY {meals_per_day} meals for EVERY day in {days}."
            )
            raw_days = _gemini_meal_chunk(
                system_prompt,
                retry_msg,
                user_id=user_id,
                ai_feature=ai_feature,
                endpoint=endpoint,
            )
            result = _validate_parsed_chunk(raw_days, days, scale_targets, meals_per_day)
            if result is not None:
                _log_meal_day_counts(result, meals_per_day)
                return result, "gemini"
        except Exception:
            pass
    fallback_raw = _fallback_meal_days(
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
    fallback: list[dict[str, Any]] = []
    for day_data in fallback_raw:
        validated = _validate_meal_day(day_data, scale_targets=scale_targets)
        fallback.append(validated if validated else day_data)
    _log_meal_day_counts(fallback, meals_per_day)
    return fallback, "fallback"


def get_existing_meal_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyMealPlan | None:
    """Legacy monthly plan for the month (generation_mode=monthly)."""
    return get_existing_monthly_meal_plan(db, user_id, month, year)


def get_existing_monthly_meal_plan(db: Session, user_id: int, month: int, year: int) -> MonthlyMealPlan | None:
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


def get_weekly_plan_by_start_day(
    db: Session, user_id: int, month: int, year: int, week_start_day: int
) -> MonthlyMealPlan | None:
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
            MonthlyMealPlan.week_start_day == week_start_day,
        )
        .first()
    )


def get_plan_for_day(db: Session, user_id: int, month: int, year: int, day: int) -> MonthlyMealPlan | None:
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
    return get_existing_monthly_meal_plan(db, user_id, month, year)


def list_weekly_plans_for_month(db: Session, user_id: int, month: int, year: int) -> list[MonthlyMealPlan]:
    return (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user_id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
        )
        .order_by(MonthlyMealPlan.week_start_day.asc())
        .all()
    )


def weeks_overview_response(db: Session, user: User, local_date: str | None) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    weeks = get_month_weeks(year, month)
    existing = list_weekly_plans_for_month(db, user.id, month, year)
    by_start = {p.week_start_day: p for p in existing if p.week_start_day is not None}

    result_weeks = []
    for w in weeks:
        start = w["start_day"]
        is_current = w["start_day"] <= today.day <= w["end_day"]
        is_past = w["end_day"] < today.day
        plan = by_start.get(start)
        is_generated = plan is not None
        result_weeks.append(
            {
                **w,
                "plan_id": plan.id if plan else None,
                "is_current": is_current,
                "is_past": is_past,
                "is_generated": is_generated,
                "can_generate": not is_generated and (is_current or not is_past),
            }
        )

    return {"month": month, "year": year, "weeks": result_weeks}


def _week_number_for_plan(plan: MonthlyMealPlan) -> int | None:
    if plan.week_start_day is None:
        return None
    for w in get_month_weeks(plan.year, plan.month):
        if w["start_day"] == plan.week_start_day:
            return w["week_number"]
    return None


def _build_week_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session,
    user: User,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    entries = sorted(plan.entries, key=lambda e: e.day)
    targets = _plan_targets_dict(plan, db, user)
    days_out: list[dict[str, Any]] = []

    for entry in entries:
        flags = day_flags(entry.day, today, plan.month, plan.year)
        if flags["is_future"]:
            day_dict: dict[str, Any] = {
                "day": entry.day,
                "is_cheat_day": entry.is_cheat_day,
                "locked": True,
                "message": f"Available on {month_abbr(plan.month)} {entry.day}",
                "meals": [],
                "total_calories": 0,
                "total_protein_g": 0,
                "total_carbs_g": 0,
                "total_fat_g": 0,
                "total_fiber_g": 0,
                **flags,
            }
        else:
            day_dict = _entry_to_day_dict(entry, plan=plan, targets=targets, locked=False)
            day_dict.update(flags)
        days_out.append(day_dict)

    week_num = _week_number_for_plan(plan)
    start = plan.week_start_day or 1
    end = plan.week_end_day or start

    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "week_number": week_num,
        "week_start_day": start,
        "week_end_day": end,
        "week_label": f"Week {week_num}: {month_abbr(plan.month)} {start}–{end}" if week_num else f"{month_abbr(plan.month)} {start}–{end}",
        "budget_level": plan.budget_level,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "generation_mode": plan.generation_mode or "weekly",
        "targets": targets,
        "days": days_out,
        "month_overview": [
            {
                "day": d["day"],
                "total_calories": d.get("total_calories"),
                "is_cheat_day": d.get("is_cheat_day", False),
                "is_past": d.get("is_past", False),
                "is_today": d.get("is_today", False),
                "is_future": d.get("is_future", False),
            }
            for d in days_out
        ],
        "today": next((d for d in days_out if d.get("is_today")), None),
        **_monthly_day_regen_stats(db, user.id, plan.month, plan.year, user=user),
    }


def meal_plan_current_weekly_response(
    db: Session,
    user: User,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    weekly_plans = list_weekly_plans_for_month(db, user.id, today.month, today.year)
    weeks_meta = get_month_weeks(today.year, today.month)
    current_plan = None
    for wp in weekly_plans:
        if wp.week_start_day is not None and wp.week_end_day is not None:
            if wp.week_start_day <= today.day <= wp.week_end_day:
                current_plan = wp
                break

    regen_stats = _monthly_day_regen_stats(db, user.id, today.month, today.year, user=user)
    return {
        "generation_mode": "weekly",
        "current_week": (
            _build_week_response(current_plan, local_date, db=db, user=user) if current_plan else None
        ),
        **regen_stats,
        "weeks_generated": len(weekly_plans),
        "total_weeks": len(weeks_meta),
    }


def generate_week_plan(
    db: Session,
    user: User,
    *,
    budget_level: str,
    week_start_day: int,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year

    weeks = get_month_weeks(year, month)
    target_week = next((w for w in weeks if w["start_day"] == week_start_day), None)
    if not target_week:
        raise ValueError(f"No week starting on day {week_start_day} in {month}/{year}")

    existing = get_weekly_plan_by_start_day(db, user.id, month, year, week_start_day)
    if existing:
        return _build_week_response(existing, local_date, db=db, user=user)

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = budget_level
    logger.info(
        "[MealPlanner] generate_week_plan user %s week %s–%s: kcal=%s, P=%sg",
        user.id,
        target_week["start_day"],
        target_week["end_day"],
        ctx["target_kcal"],
        ctx["protein_target"],
    )

    prev_plans = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.user_id == user.id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
            MonthlyMealPlan.generation_mode == "weekly",
            MonthlyMealPlan.week_start_day < week_start_day,
        )
        .all()
    )
    prev_breakfasts: list[str] = []
    prev_dinners: list[str] = []
    for pp in prev_plans:
        entries = (
            db.query(DailyMealPlanEntry)
            .filter(DailyMealPlanEntry.plan_id == pp.id)
            .order_by(DailyMealPlanEntry.day.desc())
            .limit(3)
            .all()
        )
        b, d = _diversity_from_entries(sorted(entries, key=lambda e: e.day))
        prev_breakfasts.extend(b)
        prev_dinners.extend(d)

    include_cheat = target_week["week_number"] in (1, 3)
    chunk_days = target_week["days"]

    new_days, source = _generate_chunk_days(
        db,
        days=chunk_days,
        chunk_index=0,
        ctx=ctx,
        prev_breakfasts=prev_breakfasts or None,
        prev_dinners=prev_dinners or None,
        include_cheat_override=include_cheat,
        day_offset=chunk_days[0] - 1 if chunk_days else 0,
        has_prior_context=bool(prev_breakfasts or prev_dinners),
        user_id=user.id,
    )
    if not new_days:
        raise RuntimeError("AI generation failed. Try again.")

    nutrition = get_user_nutrition_targets(db, user)
    plan = MonthlyMealPlan(
        user_id=user.id,
        month=month,
        year=year,
        budget_level=budget_level,
        generated_at=datetime.utcnow(),
        source=source,
        week_start_day=week_start_day,
        week_end_day=target_week["end_day"],
        generation_mode="weekly",
        target_kcal=int(ctx["target_kcal"]),
        target_protein_g=int(ctx["protein_target"]),
        target_carbs_g=int(ctx["carbs_target"]),
        target_fat_g=int(ctx["fat_target"]),
        target_fiber_g=int(ctx["fiber_target"]),
    )
    db.add(plan)
    db.flush()

    for day_data in new_days:
        meals_list = [m for m in (day_data.get("meals") or []) if isinstance(m, dict)]
        day_totals = _totals_from_meals_list(meals_list)
        db.add(
            DailyMealPlanEntry(
                plan_id=plan.id,
                day=int(day_data["day"]),
                is_cheat_day=bool(day_data.get("is_cheat_day")),
                total_calories=day_totals["total_calories"],
                total_protein_g=day_totals["total_protein_g"],
                total_carbs_g=day_totals["total_carbs_g"],
                total_fat_g=day_totals["total_fat_g"],
                total_fiber_g=day_totals.get("total_fiber_g") or int(ctx["fiber_target"]),
                meals_json=safe_json_dumps(meals_list),
            )
        )

    db.commit()
    db.refresh(plan)
    return _build_week_response(plan, local_date, db=db, user=user)


def regenerate_week_plan(
    db: Session,
    user: User,
    *,
    week_start_day: int,
    from_day: int,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year

    if from_day < today.day and today.month == month and today.year == year:
        raise ValueError("Cannot regenerate past days")

    plan = get_weekly_plan_by_start_day(db, user.id, month, year, week_start_day)
    if not plan:
        raise LookupError("Week plan not found")

    week_end = plan.week_end_day or from_day
    if from_day > week_end:
        raise ValueError("from_day is after this week ends")

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = plan.budget_level

    preserved = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day < from_day)
        .order_by(DailyMealPlanEntry.day.asc())
        .all()
    )
    prev_breakfasts, prev_dinners = _diversity_from_entries(preserved)

    remaining_days = list(range(from_day, week_end + 1))
    if not remaining_days:
        raise ValueError("No days left to regenerate in this week")

    try:
        new_days, _ = _generate_chunk_days(
            db,
            days=remaining_days,
            chunk_index=0,
            ctx=ctx,
            prev_breakfasts=prev_breakfasts or None,
            prev_dinners=prev_dinners or None,
            include_cheat_override=False,
            day_offset=from_day - 1,
            user_id=user.id,
            has_prior_context=True,
        )
    except Exception as exc:
        logger.exception("[MealPlanner] regenerate_week_plan generation failed: %s", exc)
        raise RuntimeError("AI generation failed. Your existing meals were not changed.") from exc

    if not new_days:
        raise RuntimeError("AI returned empty result. Your existing meals were not changed.")

    try:
        db.query(DailyMealPlanEntry).filter(
            DailyMealPlanEntry.plan_id == plan.id,
            DailyMealPlanEntry.day >= from_day,
        ).delete(synchronize_session="fetch")
        db.flush()
        db.expire(plan, ["entries"])

        for day_data in new_days:
            meals_list = [m for m in (day_data.get("meals") or []) if isinstance(m, dict)]
            day_totals = _totals_from_meals_list(meals_list)
            db.add(
                DailyMealPlanEntry(
                    plan_id=plan.id,
                    day=int(day_data["day"]),
                    is_cheat_day=bool(day_data.get("is_cheat_day")),
                    total_calories=day_totals["total_calories"],
                    total_protein_g=day_totals["total_protein_g"],
                    total_carbs_g=day_totals["total_carbs_g"],
                    total_fat_g=day_totals["total_fat_g"],
                    total_fiber_g=day_totals.get("total_fiber_g") or int(ctx["fiber_target"]),
                    meals_json=safe_json_dumps(meals_list),
                )
            )

        plan.generated_at = datetime.utcnow()
        db.add(plan)
        db.commit()
        db.refresh(plan)
    except Exception as db_exc:
        db.rollback()
        logger.exception("[MealPlanner] regenerate_week_plan DB error: %s", db_exc)
        raise RuntimeError("Failed to save regenerated meals. Please try again.") from db_exc

    return _build_week_response(plan, local_date, db=db, user=user)


def generate_meal_plan(
    db: Session,
    user: User,
    *,
    budget_level: str,
    local_date: str | None,
) -> MonthlyMealPlan:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    existing = get_existing_monthly_meal_plan(db, user.id, month, year)
    if existing:
        return existing

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = budget_level
    logger.info(
        "[MealPlanner] Targets from Calorie Log source: kcal=%s, P=%sg, C=%sg, F=%sg, meals_per_day=%s",
        ctx["target_kcal"],
        ctx["protein_target"],
        ctx["carbs_target"],
        ctx["fat_target"],
        ctx["meals_per_day"],
    )

    all_days: list[dict[str, Any]] = []
    source = "groq"
    prev_breakfasts: list[str] = []
    prev_dinners: list[str] = []
    chunk_size = get_chunk_size_for_meals(int(ctx["meals_per_day"]))
    for idx, chunk in enumerate(month_chunks(month, year, chunk_size=chunk_size)):
        chunk_days, chunk_source = _generate_chunk_days(
            db,
            days=chunk,
            chunk_index=idx,
            ctx=ctx,
            prev_breakfasts=prev_breakfasts or None,
            prev_dinners=prev_dinners or None,
            user_id=user.id,
        )
        if chunk_source == "fallback":
            source = "fallback"
        elif chunk_source == "gemini" and source == "groq":
            source = "gemini"
        all_days.extend(chunk_days)
        b, din = _extract_prev_week_meals(chunk_days)
        prev_breakfasts.extend(b)
        prev_dinners.extend(din)

    last_day = days_in_month(month, year)
    plan = MonthlyMealPlan(
        user_id=user.id,
        month=month,
        year=year,
        budget_level=budget_level,
        generated_at=datetime.utcnow(),
        source=source,
        generation_mode="monthly",
        week_start_day=None,
        week_end_day=last_day,
        target_kcal=int(ctx["target_kcal"]),
        target_protein_g=int(ctx["protein_target"]),
        target_carbs_g=int(ctx["carbs_target"]),
        target_fat_g=int(ctx["fat_target"]),
        target_fiber_g=int(ctx["fiber_target"]),
    )
    db.add(plan)
    db.flush()

    for d in all_days:
        meals_list = [m for m in (d.get("meals") or []) if isinstance(m, dict)]
        day_totals = _totals_from_meals_list(meals_list)
        db.add(
            DailyMealPlanEntry(
                plan_id=plan.id,
                day=int(d["day"]),
                is_cheat_day=bool(d.get("is_cheat_day")),
                total_calories=day_totals["total_calories"],
                total_protein_g=day_totals["total_protein_g"],
                total_carbs_g=day_totals["total_carbs_g"],
                total_fat_g=day_totals["total_fat_g"],
                total_fiber_g=day_totals.get("total_fiber_g") or int(ctx["fiber_target"]),
                meals_json=safe_json_dumps(meals_list),
            )
        )
    db.commit()
    db.refresh(plan)
    return plan


def _entry_to_day_dict(
    entry: DailyMealPlanEntry,
    *,
    plan: MonthlyMealPlan | None = None,
    targets: dict[str, int] | None = None,
    locked: bool = False,
) -> dict[str, Any]:
    if locked:
        return {
            "day": entry.day,
            "is_cheat_day": entry.is_cheat_day,
            "locked": True,
            "message": f"This day's plan will be available on day {entry.day}",
        }
    out: dict[str, Any] = {
        "day": entry.day,
        "is_cheat_day": entry.is_cheat_day,
        "total_calories": entry.total_calories,
        "total_protein_g": entry.total_protein_g,
        "total_carbs_g": entry.total_carbs_g,
        "total_fat_g": entry.total_fat_g,
        "total_fiber_g": entry.total_fiber_g,
        "meals": safe_json_loads(entry.meals_json),
    }
    if targets:
        out["target_kcal"] = targets["kcal"]
        out["target_protein_g"] = targets["protein_g"]
        out["target_carbs_g"] = targets["carbs_g"]
        out["target_fat_g"] = targets["fat_g"]
        out["target_fiber_g"] = targets.get("fiber_g", 30)
    elif plan and plan.target_kcal:
        out["target_kcal"] = int(plan.target_kcal)
        out["target_protein_g"] = int(plan.target_protein_g or 0)
        out["target_carbs_g"] = int(plan.target_carbs_g or 0)
        out["target_fat_g"] = int(plan.target_fat_g or 0)
        out["target_fiber_g"] = int(plan.target_fiber_g or 30)
    return out


def meal_plan_current_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> dict[str, Any]:
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
    targets = _plan_targets_dict(plan, db, user) if db and user else None
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "budget_level": plan.budget_level,
        "generated_at": plan.generated_at.isoformat() if plan.generated_at else None,
        "targets": targets,
        "today": (
            _entry_to_day_dict(today_entry, plan=plan, targets=targets, locked=False)
            if today_entry
            else None
        ),
        "month_overview": month_overview,
        **(_monthly_day_regen_stats(db, user.id, plan.month, plan.year, user=user) if db and user else {}),
    }


def meal_plan_month_response(
    plan: MonthlyMealPlan,
    local_date: str | None,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> dict[str, Any]:
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
    targets = _plan_targets_dict(plan, db, user) if db and user else None
    return {
        "plan_id": plan.id,
        "month": plan.month,
        "year": plan.year,
        "targets": targets,
        "days": days_out,
    }


def delete_meal_plan(db: Session, plan: MonthlyMealPlan) -> None:
    db.delete(plan)
    db.commit()


def regenerate_single_day(
    db: Session,
    user: User,
    *,
    plan_id: int,
    day: int,
    local_date: str | None,
) -> dict[str, Any]:
    today = parse_local_date(local_date)
    month, year = today.month, today.year
    local = today.isoformat()

    if day < today.day and today.month == month and today.year == year:
        raise ValueError(f"Cannot regenerate past days. Day {day} has already passed.")

    test_user = is_meal_planner_test_user(user)
    if not test_user:
        regen_stats = _monthly_day_regen_stats(db, user.id, month, year, user=user)
        if regen_stats["day_regens_remaining"] <= 0:
            limit = regen_stats["day_regens_limit"]
            raise DayRegenLimitExceeded(
                f"You have used all {limit} day regenerations for this month. "
                "You can still swap individual meals."
            )

    plan = (
        db.query(MonthlyMealPlan)
        .filter(
            MonthlyMealPlan.id == plan_id,
            MonthlyMealPlan.user_id == user.id,
            MonthlyMealPlan.month == month,
            MonthlyMealPlan.year == year,
        )
        .first()
    )
    if not plan:
        raise LookupError("Plan not found")

    existing_entry = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day == day)
        .first()
    )
    if not existing_entry:
        raise LookupError("Day not found")

    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = plan.budget_level
    logger.info(
        "[MealPlanner] Nutrition targets for user %s (regen day %s): kcal=%s, P=%sg, C=%sg, F=%sg",
        user.id,
        day,
        ctx["target_kcal"],
        ctx["protein_target"],
        ctx["carbs_target"],
        ctx["fat_target"],
    )

    preserved = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day != day)
        .order_by(DailyMealPlanEntry.day.desc())
        .limit(7)
        .all()
    )
    prev_breakfasts, prev_dinners = _diversity_from_entries(sorted(preserved, key=lambda e: e.day))

    try:
        new_days, _ = _generate_chunk_days(
            db,
            days=[day],
            chunk_index=0,
            ctx=ctx,
            prev_breakfasts=prev_breakfasts or None,
            prev_dinners=prev_dinners or None,
            include_cheat_override=False,
            day_offset=day - 1,
            user_id=user.id,
            ai_feature="meal_day_regen",
            endpoint="/api/meal-planner/regenerate-day",
            has_prior_context=True,
        )
    except Exception as gen_exc:
        logger.exception("[MealPlanner] regenerate_single_day generation failed for day %s: %s", day, gen_exc)
        raise RuntimeError(
            "AI generation failed. Your existing meals were not changed. Try again."
        ) from gen_exc

    if not new_days:
        raise RuntimeError("AI returned empty result. Your existing meals were not changed. Try again.")

    day_data = new_days[0]
    meals_list = [m for m in (day_data.get("meals") or []) if isinstance(m, dict)]
    day_totals = _totals_from_meals_list(meals_list)

    try:
        db.delete(existing_entry)
        db.flush()

        new_entry = DailyMealPlanEntry(
            plan_id=plan.id,
            day=day,
            is_cheat_day=False,
            total_calories=day_totals["total_calories"],
            total_protein_g=day_totals["total_protein_g"],
            total_carbs_g=day_totals["total_carbs_g"],
            total_fat_g=day_totals["total_fat_g"],
            total_fiber_g=day_totals.get("total_fiber_g") or int(ctx["fiber_target"]),
            meals_json=safe_json_dumps(meals_list),
        )
        db.add(new_entry)
        if not test_user:
            plan.day_regens_used = int(plan.day_regens_used or 0) + 1
        db.commit()
        db.refresh(new_entry)
        db.refresh(plan)
    except Exception as db_exc:
        db.rollback()
        logger.exception("[MealPlanner] DB error on day regen insert for day %s: %s", day, db_exc)
        raise RuntimeError("Failed to save new meals. Please try again.") from db_exc

    targets = _plan_targets_dict(plan, db, user)
    result = _entry_to_day_dict(new_entry, plan=plan, targets=targets)
    return _attach_day_regen_stats(result, _monthly_day_regen_stats(db, user.id, month, year, user=user))


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

    plan = get_existing_monthly_meal_plan(db, user.id, month, year)
    if not plan:
        raise LookupError("No monthly plan exists for this month")

    # Build ctx BEFORE deleting entries — resolve_user_targets() may call db.rollback()
    # on fallback, which would undo a delete if it ran first.
    ctx = _build_meal_ctx(db, user)
    ctx["budget_level"] = plan.budget_level

    preserved = (
        db.query(DailyMealPlanEntry)
        .filter(DailyMealPlanEntry.plan_id == plan.id, DailyMealPlanEntry.day < from_day)
        .order_by(DailyMealPlanEntry.day.desc())
        .limit(7)
        .all()
    )
    preserved = sorted(preserved, key=lambda e: e.day)

    deleted_count = (
        db.query(DailyMealPlanEntry)
        .filter(
            DailyMealPlanEntry.plan_id == plan.id,
            DailyMealPlanEntry.day >= from_day,
        )
        .delete(synchronize_session="fetch")
    )
    db.flush()
    db.expire(plan, ["entries"])
    logger.info(
        "[MealPlanner] Regenerate deleted %s entries from day %s for plan %s",
        deleted_count,
        from_day,
        plan.id,
    )
    logger.info(
        "[MealPlanner] Regenerating for user %s from day %s: meals_per_day=%s, budget=%s",
        user.id,
        from_day,
        ctx["meals_per_day"],
        plan.budget_level,
    )

    prev_breakfasts, prev_dinners = _diversity_from_entries(preserved)
    chunk_size = get_chunk_size_for_meals(int(ctx["meals_per_day"]))
    chunks = days_chunks_from_range(from_day, last_day, chunk_size=chunk_size)
    remaining_count = last_day - from_day + 1
    cheat_chunk_idx = 0 if remaining_count > 10 else -1
    days_by_num: dict[int, dict[str, Any]] = {}

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
            user_id=user.id,
            has_prior_context=True,
        )
        for d in new_days:
            day_num = int(d["day"])
            if from_day <= day_num <= last_day:
                days_by_num[day_num] = d
        b, din = _extract_prev_week_meals(new_days)
        prev_breakfasts.extend(b)
        prev_dinners.extend(din)

    for day_num in sorted(days_by_num.keys()):
        d = days_by_num[day_num]
        meals_list = [m for m in (d.get("meals") or []) if isinstance(m, dict)]
        day_totals = _totals_from_meals_list(meals_list)
        db.add(
            DailyMealPlanEntry(
                plan_id=plan.id,
                day=day_num,
                is_cheat_day=bool(d.get("is_cheat_day")),
                total_calories=day_totals["total_calories"],
                total_protein_g=day_totals["total_protein_g"],
                total_carbs_g=day_totals["total_carbs_g"],
                total_fat_g=day_totals["total_fat_g"],
                total_fiber_g=day_totals.get("total_fiber_g") or int(ctx["fiber_target"]),
                meals_json=safe_json_dumps(meals_list),
            )
        )

    plan.generated_at = datetime.utcnow()
    plan.target_kcal = int(ctx["target_kcal"])
    plan.target_protein_g = int(ctx["protein_target"])
    plan.target_carbs_g = int(ctx["carbs_target"])
    plan.target_fat_g = int(ctx["fat_target"])
    plan.target_fiber_g = int(ctx["fiber_target"])
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


def _groq_swap_meal(
    system_prompt: str,
    user_msg: dict[str, Any],
    *,
    user_id: int | None = None,
) -> dict[str, Any]:
    model_name = settings.GROQ_MODEL or "llama-3.3-70b-versatile"
    raw = post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        },
        payload={
            "model": model_name,
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
    try:
        log_groq_call(
            user_id=user_id,
            feature="meal_swap",
            model=model_name,
            endpoint="/api/meal-planner/swap-meal",
            response_json=raw,
        )
    except Exception:
        pass
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
    if not is_meal_planner_test_user(user) and not check_swap_allowed(user.id, "meal", local):
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
            replacement = _groq_swap_meal(system_prompt, user_msg, user_id=user.id)
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
    if not is_meal_planner_test_user(user):
        increment_swap(user.id, "meal", local)

    targets = _plan_targets_dict(plan, db, user)
    result = _entry_to_day_dict(entry, plan=plan, targets=targets)
    if is_meal_planner_test_user(user):
        result["swaps_used_today"] = 0
        result["swaps_limit"] = 999
    else:
        result["swaps_used_today"] = get_swap_count(user.id, "meal", local)
        result["swaps_limit"] = SWAP_LIMIT_PER_DAY
    return result
