# Meal Planner — Complete Reference

> **Scope:** Monthly Meal Planner + Day Meal Planner (generate, view, swap, regenerate remaining, regenerate single day).  
> **Source of truth:** Code as of this document. Primary implementation lives in `fitness/server/src/services/meal_planner_service.py`.

---

## Table of contents

1. [Architecture & file map](#1-architecture--file-map)
2. [Database models](#2-database-models)
3. [API endpoints](#3-api-endpoints)
4. [Rate limits](#4-rate-limits)
5. [Nutrition targets](#5-nutrition-targets)
6. [Onboarding → generation context](#6-onboarding--generation-context)
7. [Meal slots & calorie allocation](#7-meal-slots--calorie-allocation)
8. [AI prompts (verbatim)](#8-ai-prompts-verbatim)
9. [User message JSON (Groq/Gemini)](#9-user-message-json-groqgemini)
10. [AI provider settings](#10-ai-provider-settings)
11. [Post-processing pipeline](#11-post-processing-pipeline)
12. [Operation flows](#12-operation-flows)
13. [Fallback & template data](#13-fallback--template-data)
14. [Client types & API](#14-client-types--api)
15. [Client UI logic](#15-client-ui-logic)
16. [Environment variables](#16-environment-variables)
17. [Error codes & edge cases](#17-error-codes--edge-cases)

---

## 1. Architecture & file map

| Layer | Path | Role |
|--------|------|------|
| HTTP routes | `fitness/server/src/routes/meal_planner.py` | FastAPI router `/api/meal-planner/*` |
| Business logic + AI | `fitness/server/src/services/meal_planner_service.py` | Generation, validation, prompts, DB writes |
| Shared utilities | `fitness/server/src/services/planner_common.py` | Date parsing, month chunks, `day_flags`, JSON parse |
| Rate limits | `fitness/server/src/services/planner_swap_limits.py` | In-memory daily counters |
| ORM models | `fitness/server/src/models/meal_plan.py` | `MonthlyMealPlan`, `DailyMealPlanEntry` |
| Client types | `fitness/mobile/src/types/planner.ts` | TypeScript interfaces |
| Client API | `fitness/mobile/src/api/mealPlanner.ts` | Axios wrappers |
| UI screen | `fitness/mobile/src/screens/Coach/MonthlyMealPlannerScreen.tsx` | Calendar + day view + actions |
| Swap UI | `fitness/mobile/src/components/SwapBottomSheet.tsx` | Meal swap reason sheet |

**Central generation function:** `_generate_chunk_days()` — used by full-month generate, regenerate-remaining, and regenerate-single-day.

---

## 2. Database models

### `monthly_meal_plans` (`MonthlyMealPlan`)

| Column | Type | Notes |
|--------|------|--------|
| `id` | int PK | Exposed as `plan_id` in API |
| `user_id` | int FK | |
| `month` | int | 1–12 |
| `year` | int | |
| `budget_level` | string | `budget` \| `moderate` \| `flexible` |
| `generated_at` | datetime | |
| `source` | string | `groq` \| `gemini` \| `fallback` |
| `target_kcal` | int nullable | Snapshot at generation |
| `target_protein_g` | int nullable | |
| `target_carbs_g` | int nullable | |
| `target_fat_g` | int nullable | |
| `target_fiber_g` | int nullable | |

**Unique constraint:** `(user_id, month, year)` — one plan per user per calendar month.

### `daily_meal_plan_entries` (`DailyMealPlanEntry`)

| Column | Type | Notes |
|--------|------|--------|
| `id` | int PK | |
| `plan_id` | int FK | CASCADE delete with plan |
| `day` | int | Calendar day 1–31 |
| `is_cheat_day` | bool | |
| `total_calories` | int | Recomputed from meals on save |
| `total_protein_g` | int | |
| `total_carbs_g` | int | |
| `total_fat_g` | int | |
| `total_fiber_g` | int | |
| `meals_json` | text | JSON array of meal objects |

**Unique constraint:** `(plan_id, day)`.

### JSON stored in `meals_json` — meal object shape

```json
{
  "meal_type": "Breakfast",
  "time": "8:00 AM",
  "items": [
    {
      "food": "Poha",
      "quantity_g": 200,
      "calories": 280,
      "protein": 8,
      "carbs": 48,
      "fat": 6
    }
  ],
  "total_calories": 340,
  "total_protein": 10,
  "total_carbs": 52,
  "total_fat": 8,
  "prep_time_min": 15,
  "estimated_cost_inr": 25
}
```

---

## 3. API endpoints

**Base path:** `/api/meal-planner`  
**Auth:** Bearer JWT (`get_current_user`)  
**Query param (all routes):** `local_date` — ISO date string (`YYYY-MM-DD`). Defaults to server today if omitted. Drives “today”, past/future flags, and rate-limit keys.

| Method | Path | Request body | Response | Notes |
|--------|------|--------------|----------|--------|
| `POST` | `/generate` | `{ "budget_level": "budget" \| "moderate" \| "flexible" }` | `MealPlanCurrent` | Creates month plan if none exists; returns existing if already present |
| `GET` | `/current` | — | `MealPlanCurrent` | 404 if no plan |
| `GET` | `/day/{day}` | — | `MealDayPlan` | Future days return `locked: true`; includes `day_regen_*` |
| `GET` | `/month` | — | Month payload with all days + meals | |
| `POST` | `/regenerate-remaining` | `{ "from_day": int }` | `MealPlanCurrent` | Deletes `day >= from_day`, regenerates |
| `POST` | `/regenerate-day` | `{ "plan_id": int, "day": int }` | `MealDayPlan` | Single day full regen |
| `POST` | `/swap-meal` | `{ "plan_id", "day", "meal_type", "reason"? }` | `MealDayPlan` | One meal replacement |
| `DELETE` | `/current` | — | `{ "deleted": true }` | Deletes entire month plan |

---

## 4. Rate limits

**Storage:** In-memory dict in `planner_swap_limits.py` (resets on server restart).  
**Key format:** `{kind}:{user_id}:{local_date}` where `local_date` is ISO date from query param.

| Action | Constant | Limit | Exception |
|--------|----------|-------|-----------|
| Meal swap | `SWAP_LIMIT_PER_DAY` | 5 / user / day | `SwapLimitExceeded` → HTTP 429 |
| Full day regenerate | `DAY_REGEN_LIMIT_PER_DAY` | 3 / user / day | `DayRegenLimitExceeded` → HTTP 429 |

Response fields on day endpoints: `swaps_used_today`, `swaps_limit`, `day_regen_used_today`, `day_regen_limit`.

---

## 5. Nutrition targets

### Source

`get_user_nutrition_targets(db, user)` calls `resolve_user_targets()` from `fitness/server/src/routes/calories.py` — **same source as Calorie Log**, not raw `targets_json` alone.

### Returned dict (internal)

```python
{
  "target_kcal": int,
  "protein_target": int,      # grams
  "carbs_target": int,
  "fat_target": int,
  "fiber_target": int,
  "water_target_l": float,
}
```

### Validation (`_verify_meal_planner_targets`)

- `target_kcal` must be > 1000  
- `protein_target` must be > 0  
- Raises `HTTPException 404` if targets missing (onboarding incomplete)

### API exposure

- Plan level: `targets: { kcal, protein_g, carbs_g, fat_g, fiber_g? }` on `MealPlanCurrent`  
- Day level: `target_kcal`, `target_protein_g`, `target_carbs_g`, `target_fat_g`, `target_fiber_g` on `MealDayPlan`  
- Priority: plan snapshot columns → live `get_user_nutrition_targets` via `_plan_targets_dict()`

---

## 6. Onboarding → generation context

Built by `_build_meal_ctx(db, user)` from `UserOnboarding.onboarding_json`:

| Internal key | Onboarding path | Default |
|--------------|-----------------|---------|
| `target_kcal` | via `get_user_nutrition_targets` | required |
| `protein_target` | via nutrition | required |
| `carbs_target` | via nutrition | required |
| `fat_target` | via nutrition | required |
| `fiber_target` | via nutrition | 30 |
| `meals_per_day` | `dietary.meals_per_day` | 3 (clamped 2–7) |
| `expected_meal_types` | derived from `MEAL_SLOTS_BY_COUNT` | |
| `region` | `app_setup.region` | `"IN"` |
| `diet_type` | `dietary.diet_type` | `"standard"` |
| `allergies` | `dietary.allergies` | `[]` |
| `budget_level` | set per operation | `"budget"` until overridden |
| `user_weight_kg` | `personal.weight_kg` or `user.weight` | 70 |
| `goal` | `goal.type` | `"maintain"` |
| `activity_level` | `activity.level` | `"moderately_active"` |
| `workout_types` | `activity.workout_types` | `[]` |
| `water_target_l` | from nutrition | 2.5 |
| `food_dataset_sample` | DB query or `BUDGET_FOODS` | 40 random `food_items` rows |

`budget_level` is set from:
- `generate_meal_plan`: request body  
- `regenerate_*` / `regenerate_single_day`: existing `plan.budget_level`

---

## 7. Meal slots & calorie allocation

### `MEAL_SLOTS_BY_COUNT` (meal type names only)

| `meals_per_day` | Slots |
|-----------------|--------|
| 2 | Lunch, Dinner |
| 3 | Breakfast, Lunch, Dinner |
| 4 | Breakfast, Lunch, Snack, Dinner |
| 5 | Breakfast, Mid-Morning Snack, Lunch, Evening Snack, Dinner |
| 6 | Breakfast, Mid-Morning Snack, Lunch, Post_Workout, Evening Snack, Dinner |
| 7 | Breakfast, Mid-Morning Snack, Lunch, Post_Workout, Afternoon Snack, Evening Snack, Dinner |

### `MEAL_SLOT_DEFINITIONS` (sent to AI as `meal_slots`)

Each entry: `{ "meal_type", "time", "character" }`.

**2 meals:**
- Lunch `1:00 PM` — large main meal  
- Dinner `8:00 PM` — moderate evening meal  

**3 meals:**
- Breakfast `8:00 AM` — morning dish  
- Lunch `1:00 PM` — largest meal of the day  
- Dinner `8:00 PM` — lighter evening meal  

**4 meals:**
- Breakfast, Lunch, Snack `4:00 PM` (small light snack only), Dinner  

**5 meals:**
- Breakfast, Mid-Morning Snack `10:30 AM` (very light, fruit or nuts only), Lunch, Evening Snack `5:00 PM`, Dinner  

**6 meals:**
- Breakfast (poha/idli), Mid-Morning Snack (fruit/nuts/buttermilk, NOT cooked), Lunch (dal/curry + rice/roti + salad), Post_Workout `4:00 PM` (protein recovery), Evening Snack `6:00 PM` (makhana/chana/chai), Dinner (lighter than lunch)  

**7 meals:**
- Breakfast `7:30 AM`, Mid-Morning `10:00 AM`, Lunch, Post_Workout `3:30 PM`, Afternoon Snack `5:00 PM`, Evening Snack `6:30 PM` (tea + biscuits), Dinner `8:30 PM`  

### `MEAL_TIMES` (fallback template times)

| meal_type | time |
|-----------|------|
| Breakfast | 8:00 AM |
| Mid-Morning Snack | 10:30 AM |
| Lunch | 1:00 PM |
| Afternoon Snack | 3:30 PM |
| Post_Workout | 5:00 PM |
| Snack | 4:00 PM |
| Evening Snack | 6:00 PM |
| Pre_Workout | 5:30 PM |
| Dinner | 8:00 PM |

### `build_calorie_allocation(target_kcal, meals_per_day)`

Produces multiline string injected into system prompt. Percentages:

| meals | Distribution |
|-------|----------------|
| 2 | Lunch 45%, Dinner 55% |
| 3 | Breakfast 30%, Lunch 40%, Dinner 30% |
| 4 | Breakfast 25%, Lunch 38%, Snack 12%, Dinner 25% |
| 5 | Breakfast 22%, Mid-Morning 8%, Lunch 32%, Evening Snack 8%, Dinner 30% |
| 6 | Breakfast 20%, Mid-Morning 7%, Lunch 28%, Post_Workout 15%, Evening Snack 7%, Dinner 23% |
| 7 | Breakfast 18%, Mid-Morning 6%, Lunch 25%, Post_Workout 13%, Afternoon Snack 6%, Evening Snack 7%, Dinner 25% |

Output format per line: `  - {meal_name}: ~{kcal} kcal ({pct}% of daily target)`

---

## 8. AI prompts (verbatim)

### 8.1 `MEAL_SYSTEM_PROMPT_BASE`

Formatted at runtime with: `{target_kcal}`, `{protein_target}`, `{carbs_target}`, `{fat_target}`, `{fiber_target}`, `{meals_per_day}`, `{avg_meal_kcal}`, `{calorie_allocation}`, `{region}`, `{diet_type}`, `{allergies}`, `{budget_level}`.

```
You are an expert Indian sports nutritionist who creates diverse, region-specific meal plans.
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
5. Does total protein sum to approximately {protein_target}g? If under, add protein-rich items.
Only return the JSON after confirming no repeats exist within any single day and macro totals hit targets.
```

### 8.2 `MEAL_SYSTEM_PROMPT_CHUNK_FOLLOWUP`

Appended when `chunk_index >= 1` OR `has_prior_context` OR `prev_breakfasts`/`prev_dinners` present:

```
The user message includes previous_week_breakfasts and previous_week_dinners — these are meals already planned in earlier weeks. Do NOT repeat any of these dishes. Use completely different recipes.
```

### 8.3 `MEAL_SWAP_SYSTEM_PROMPT`

Formatted with `{region}`, `{diet_type}`, `{allergies}`.

```
You are an expert Indian nutritionist. Replace one meal with a different option.
Return ONLY a JSON object with key "meal" containing the replacement meal.

The replacement meal MUST:
- Be a completely different dish from the original (different main ingredient, different cuisine style).
- Match the original meal's calorie range within ±15%.
- Match the original meal's protein within ±5g.
- Be appropriate for the meal_type and time of day.
- Have 2-4 food items (a complete plate).
- Use foods available in region {region} and respect diet_type {diet_type} and allergies {allergies}.
- Include realistic estimated_cost_inr and prep_time_min.

The meal object must have keys: meal_type, time, items (array of {food, quantity_g, calories, protein, carbs, fat}), total_calories, total_protein, total_carbs, total_fat, prep_time_min, estimated_cost_inr.
```

---

## 9. User message JSON (Groq/Gemini)

Built in `_generate_chunk_days()` and sent as the **user** message (`json.dumps(user_msg)`).

### Core fields (always present)

```json
{
  "days": [1, 2, 3, 4, 5, 6, 7],
  "include_cheat_day": true,
  "target_kcal": 2970,
  "protein_target": 126,
  "carbs_target": 370,
  "fat_target": 110,
  "fiber_target": 30,
  "meals_per_day": 5,
  "expected_meal_types": ["Breakfast", "Mid-Morning Snack", "Lunch", "Evening Snack", "Dinner"],
  "region": "IN",
  "diet_type": "standard",
  "allergies": [],
  "budget_level": "budget",
  "user_weight_kg": 75,
  "goal": "bulk",
  "activity_level": "moderately_active",
  "workout_types": [],
  "water_target_l": 2.5,
  "food_dataset_sample": [
    { "food": "Oats (cooked)", "cal_per_100g": 71, "protein_per_100g": 2.5 }
  ],
  "meal_slots": [
    { "meal_type": "Breakfast", "time": "8:00 AM", "character": "morning dish" }
  ],
  "rule": "Generate meals in EXACTLY this order and slot sequence. Each meal_type in your response must match these slots exactly. No two meals can share any food item.",
  "day_number_rule": "Each day object MUST use the exact integer from the days array as its day field (e.g. if days is [17,18,19], return day 17 then 18 then 19 — never 1,2,3)."
}
```

### Optional fields

| Field | When added |
|-------|------------|
| `previous_week_breakfasts` | `string[]` — first food from each breakfast in prior chunks/days |
| `previous_week_dinners` | `string[]` — first food from each dinner in prior chunks/days |

### Swap user message (`swap_meal`)

```json
{
  "original_meal": { "...full meal object..." },
  "reason": "want_variety",
  "target_calories_for_this_meal": 600,
  "target_protein_for_this_meal": 30,
  "region": "IN",
  "diet_type": "standard",
  "allergies": [],
  "budget_level": "budget",
  "other_meals_today": ["Rajma", "Banana"]
}
```

Default `reason` if omitted: `"want_variety"`.

---

## 10. AI provider settings

### Meal chunk generation (`_groq_meal_chunk` / `_gemini_meal_chunk`)

| Setting | Single day (`len(days)==1`) | Multi-day chunk |
|---------|----------------------------|-----------------|
| `temperature` | 0.7 | 0.6 |
| `max_tokens` / `maxOutputTokens` | 1500 | See below |
| `response_format` | `json_object` (Groq) / `application/json` (Gemini) | same |
| HTTP timeout | 90s | 90s |

**Multi-day `max_tokens` (`_meal_chunk_max_tokens`):**

| `meals_per_day` | max_tokens |
|-----------------|------------|
| ≤ 4 | 3000 |
| ≤ 6 | 4500 |
| 7 | 5500 |

**Models:**
- Groq: `settings.GROQ_MODEL` or `llama-3.3-70b-versatile`
- Gemini: `settings.GEMINI_MODEL` or `gemini-2.0-flash`

**Retry order per chunk:** Groq (2 attempts) → Gemini → `_fallback_meal_days()` template.

**Response parsing:** `parse_groq_json_array()` — accepts top-level `days` array or wraps from `{ "days": [...] }`.

### Swap generation (`_groq_swap_meal`)

| Setting | Value |
|---------|-------|
| temperature | 0.7 |
| max_tokens | 500 |
| timeout | 45s |

Fallback: `FALLBACK_SWAPS` dict by `meal_type` if Groq fails.

---

## 11. Post-processing pipeline

Applied in `_validate_meal_day()` for each AI day object:

### Step 1: `fix_day_meal_duplicates(day_data)`

- Tracks `seen_foods` (lowercase) across all meals in the day  
- Duplicate item → replaced from `FALLBACK_ITEMS_BY_MEAL_TYPE[meal_type]` if available  
- Recomputes meal totals from items  

### Step 2: `validate_and_scale_day()` (skipped if `is_cheat_day`)

- Computes `actual_kcal` / `target_kcal` ratio  
- If ratio **< 0.85**: multiply all item `quantity_g`, macros by `target_kcal / actual_kcal`  
- If ratio **> 1.15**: log and store as-is  
- Recomputes per-meal totals  

### Step 3: `_normalize_meal()`

- Sums item calories/macros → sets `total_calories`, `total_protein`, etc. on each meal  

### Step 4: `_align_chunk_days(validated, requested_days)`

- Maps AI output order to **calendar day numbers** (fixes Groq returning 1–7 instead of 17–23)  

### Step 5: `_totals_from_meals_list()`

- Sums meals → DB columns `total_calories`, `total_protein_g`, etc.  
- Minimums: calories ≥ 1, protein/carbs/fat ≥ 1, fiber ≥ 15  

---

## 12. Operation flows

### 12.1 Generate full month (`generate_meal_plan`)

1. Parse `local_date` → month/year  
2. If plan exists for user+month → return existing (no regen)  
3. `_build_meal_ctx()` + set `budget_level` from request  
4. For each chunk in `month_chunks(month, year)` (7-day slices):  
   - `_generate_chunk_days(chunk_index=idx, ...)`  
   - Cheat: `_include_cheat_for_chunk(idx)` → `True` for chunk **0** and **2** only  
   - Accumulate `prev_breakfasts`, `prev_dinners` from chunk output  
5. Create `MonthlyMealPlan` with target snapshot columns  
6. Insert one `DailyMealPlanEntry` per day  

### 12.2 Get current plan (`meal_plan_current_response`)

Returns:

```typescript
{
  plan_id, month, year, budget_level, generated_at,
  targets?: { kcal, protein_g, carbs_g, fat_g, fiber_g? },
  today: MealDayPlan | null,  // entry for today's calendar day
  month_overview: [{
    day, total_calories | null, is_cheat_day,
    is_past, is_today, is_future
  }]
}
```

- `total_calories` is `null` on future days in overview  
- `day_flags()` computes past/today/future relative to `local_date`

### 12.3 Get single day (`GET /day/{day}`)

- `day > today.day` (same month) → `{ locked: true, message, day, is_cheat_day: false }` (no meals)  
- Else → `_entry_to_day_dict()` + targets + `day_regen_used_today` / `day_regen_limit`  
- 404 if entry missing  

### 12.4 Regenerate single day (`regenerate_single_day`)

**Validations:**
- `day < today.day` (same month) → `ValueError` 400  
- `day_regen` count ≥ 3 → `DayRegenLimitExceeded` 429  
- Plan must match `plan_id`, user, current month/year  
- Entry must exist  

**Steps:**
1. `_build_meal_ctx()` **before** delete (avoids `db.rollback()` undoing delete)  
2. Last 7 other days → `previous_week_breakfasts` / `previous_week_dinners`  
3. Delete entry: `delete(synchronize_session="fetch")`, `db.expire(plan, ["entries"])`  
4. `_generate_chunk_days(days=[day], include_cheat_override=False, has_prior_context=True)` — **never cheat day**  
5. Insert new entry, commit  
6. `increment_day_regen()`  
7. Return `_entry_to_day_dict()` + regen counters  

### 12.5 Regenerate remaining (`regenerate_remaining_meals`)

**Validations:**
- `from_day < today.day` → 400  
- `from_day > last_day_of_month` → 400  
- Plan must exist  

**Steps:**
1. `_build_meal_ctx()` before delete  
2. Preserved entries: `day < from_day`, last 7 → diversity lists  
3. Delete all entries `day >= from_day`  
4. Chunk `from_day..last_day` via `days_chunks_from_range()`  
5. Cheat chunk: `cheat_chunk_idx = 0` if more than 10 days to regen, else `-1` (no cheat)  
6. Dedupe inserts via `days_by_num` dict  
7. Update plan `generated_at` + target snapshot columns  

### 12.6 Swap meal (`swap_meal`)

**Validations:**
- Swap count ≥ 5 → 429  
- Plan/day/meal_type must exist  
- **Client:** swap only on today (`!is_future`), not past-only restriction on server  

**Steps:**
1. Load original meal from `meals_json`  
2. Build swap prompts + user message  
3. Groq → fallback `FALLBACK_SWAPS`  
4. Replace meal in array, preserve `meal_type` and `time`  
5. `_validate_meal_day()` on full day (dedupe + scale)  
6. Update entry totals, `increment_swap()`  
7. Return day dict + `swaps_used_today` / `swaps_limit`  

### 12.7 Delete plan (`delete_meal_plan`)

Cascade deletes all entries via ORM relationship.

---

## 13. Fallback & template data

### `BUDGET_FOODS` (default food dataset sample)

| food | cal/100g | protein/100g |
|------|----------|--------------|
| Oats (cooked) | 71 | 2.5 |
| Brown rice (cooked) | 111 | 2.6 |
| Chole masala | 270 | 15 |
| Dal (cooked) | 116 | 9 |
| Paneer | 265 | 18 |
| Boiled eggs | 155 | 13 |
| Banana | 89 | 1 |
| Mixed vegetables | 50 | 2 |

### `FALLBACK_ITEMS_BY_MEAL_TYPE` (duplicate replacement)

Used by `fix_day_meal_duplicates` when same food appears twice in one day.

### `FALLBACK_DAY_TEMPLATES` (7 rotating day templates)

Used when Groq and Gemini both fail. Each template has `breakfast`, `lunch`, `dinner` as `(food_name, quantity_g)` tuples. Middle day of chunk may use `CHEAT_MEAL_TEMPLATE`:

- breakfast: Samosa + Chai  
- lunch: Dal rice + Salad  
- dinner: Pav bhaji + Gulab jamun  

### `FALLBACK_SWAPS` (swap fallback)

Predefined alternatives for `Breakfast`, `Lunch`, `Dinner`, `Snack` — scaled to ±30% of target meal calories.

---

## 14. Client types & API

### TypeScript (`planner.ts`)

See `MealFoodItem`, `MealPlanMeal`, `MealPlanTargets`, `MealDayPlan`, `MealMonthOverviewDay`, `MealPlanCurrent`.

### API client (`mealPlanner.ts`)

| Function | Endpoint | Timeout |
|----------|----------|---------|
| `fetchMealPlanCurrent()` | GET `/current` | 20s default |
| `generateMealPlan(budget)` | POST `/generate` | 120s (`COACH_API_TIMEOUT_MS`) |
| `fetchMealPlanDay(day)` | GET `/day/{day}` | 20s |
| `regenerateRemainingMeals(fromDay)` | POST `/regenerate-remaining` | **600s** |
| `regenerateMealPlanDay({ plan_id, day })` | POST `/regenerate-day` | 120s |
| `swapMealPlanMeal(...)` | POST `/swap-meal` | 120s |

All requests pass `local_date` query from `localDateIso()`.

### `MealPlanCurrent` response fields

| Field | Type |
|-------|------|
| `plan_id` | number |
| `month`, `year` | number |
| `budget_level` | BudgetLevel |
| `generated_at` | ISO string |
| `targets` | optional macro targets |
| `today` | MealDayPlan \| null |
| `month_overview` | array of calendar summary days |

### `MealDayPlan` response fields

| Field | Type |
|-------|------|
| `day` | number |
| `is_cheat_day` | boolean |
| `total_calories`, `total_protein_g`, `total_carbs_g`, `total_fat_g`, `total_fiber_g` | number |
| `target_kcal`, `target_protein_g`, ... | optional |
| `meals` | MealPlanMeal[] |
| `locked`, `message` | optional (future days) |
| `swaps_used_today`, `swaps_limit` | optional |
| `day_regen_used_today`, `day_regen_limit` | optional |

---

## 15. Client UI logic

**Screen:** `MonthlyMealPlannerScreen.tsx`

### State

| State | Purpose |
|-------|---------|
| `plan` | Current month plan from API |
| `selectedDay` | Calendar selection |
| `dayDetail` | Full day meals + totals |
| `budget` | Pre-generate budget picker |
| `generating` / `genStep` | Full-month generation progress |
| `showRegenerateSheet` | Regenerate-remaining modal (web-safe) |
| `showRegenerateDaySheet` | Single-day regen confirm modal |
| `regenerateDayTarget` | Day number for regen |
| `isRegenerating` | Full remaining regen overlay |
| `isRegeneratingDay` | Day regen meal-area overlay |
| `showSwapSheet` / `swapTarget` | Swap bottom sheet |
| `mealSwapsUsed` / `dayRegenCount` | Rate limit display |
| `collapsed` | Per-meal expand/collapse |
| `regenCooldown` | 60s cooldown after generate/regen-remaining |

### Derived flags

| Flag | Rule |
|------|------|
| `isCurrentOrFuture` | Selected day is not `is_past` → show **Day** regen button |
| `canSwapMeals` | Not `is_future` → show swap icon (today + past) |
| `dailyTargets` | `dayDetail.target_*` → `plan.targets` → onboarding preview |

### User actions

| UI control | Handler | API |
|------------|---------|-----|
| Generate plan | `startGenerate()` | `generateMealPlan(budget)` |
| Calendar day tap | `setSelectedDay` → `loadDay()` | `fetchMealPlanDay` |
| **Day** button (header) | `handleRegenerateDay` → modal → `handleRegenerateDayConfirm` | `regenerateMealPlanDay` |
| Swap icon on meal | `handleSwapPress` → `SwapBottomSheet` | `swapMealPlanMeal` |
| Regenerate May X–Y | `handleRegenerateConfirm` | `regenerateRemainingMeals(currentDay)` |

### Swap reasons (`MEAL_SWAP_REASONS`)

| key | label |
|-----|-------|
| `dont_like` | Don't like it |
| `too_expensive` | Too expensive |
| `not_available` | Not available |
| `want_variety` | Want variety |

### Web-specific behavior

- `Alert.alert` is unreliable on Expo web → day regen and regenerate-remaining use **Modal** bottom sheets  
- Success/error feedback uses `notifyUser()` → `window.alert` on web  

### Meal emojis (`MEAL_EMOJI`)

Breakfast 🌅, Lunch 🍛, Snack 🥜, Dinner 🌙, Pre_Workout ⚡, Post_Workout 💪

---

## 16. Environment variables

| Variable | Used for |
|----------|----------|
| `GROQ_API_KEY` | Primary meal generation + swap |
| `GROQ_MODEL` | Default `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | Fallback meal generation |
| `GEMINI_MODEL` | Default `gemini-2.0-flash` |
| `EXPO_PUBLIC_API_URL` | Mobile API base (default `http://127.0.0.1:8000`) |

---

## 17. Error codes & edge cases

| Condition | HTTP | Detail |
|-----------|------|--------|
| No plan | 404 | No meal plan for this month |
| Day not found | 404 | Day not found |
| Past day regen | 400 | Cannot regenerate past days |
| `from_day` in past | 400 | Cannot regenerate past days |
| Swap limit | 429 | Swaps exhausted |
| Day regen limit | 429 | 3 regenerations exhausted |
| AI failure (single day) | 500 | AI generation failed |
| Duplicate key on save | 500 | IntegrityError → rollback + generic message |
| Onboarding incomplete | 404 | Nutrition targets not found |

### Critical implementation notes

1. **Always build `ctx` before deleting DB entries** — `resolve_user_targets()` may call `db.rollback()`.  
2. **Use `delete(synchronize_session="fetch")`** and `db.expire(plan, ["entries"])` after bulk delete.  
3. **`_align_chunk_days`** prevents duplicate `(plan_id, day)` when AI returns wrong day numbers.  
4. **`regenerate_single_day` forces `include_cheat_override=False`** — never turns a regen into cheat day.  
5. **Cheat scaling:** `validate_and_scale_day` is skipped when `is_cheat_day` is true.  
6. **`plan_id` in API === `MonthlyMealPlan.id`** (database primary key).

---

## Appendix: `day_flags` logic

From `planner_common.day_flags(day, today, month, year)`:

- If `today` is not in plan month/year → all days `is_future: true`  
- `day < today.day` → `is_past: true`  
- `day == today.day` → `is_today: true`  
- `day > today.day` → `is_future: true`  

---

## Appendix: Month chunking

- Full month: `month_chunks(month, year, chunk_size=7)` → `[[1..7], [8..14], ...]`  
- Partial regen: `days_chunks_from_range(from_day, last_day, chunk_size=7)`  

---

*End of document.*
