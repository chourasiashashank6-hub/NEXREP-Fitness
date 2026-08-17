from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.core.config import settings
from src.core.http_client import ExternalHTTPError, post_json
from src.models.models import User, UserOnboarding
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry, WaterIntakeLog
from src.models.weight_log import WeightLog
from src.schemas.calories_api import (
    DailyLogEnsureRequest,
    AIFoodMealCreateRequest,
    FoodImageAnalyzeRequest,
    FoodLookupRequest,
    MealCreateRequest,
    MealUpdateRequest,
    WaterPatchRequest,
)
from src.services.activity_feed_service import calculate_user_streak, emit_streak_milestone_if_needed
from src.services.xp_service import award_xp_for_meal_log, reevaluate_xp_after_meal_change
from src.services.food_catalog_service import lookup_food_scaled, search_foods
from src.services.food_image_utils import prepare_food_image_for_vision
from src.services.language_service import normalize_language_tag
from src.services.ai_logger import log_gemini_call, log_groq_call
from src.services.gemini_client import gemini_generate_content_models, has_gemini_key
from src.utils.auth import get_current_user

router = APIRouter()
goal_progress_router = APIRouter()

MEAL_ORDER = ["Breakfast", "Lunch", "Dinner", "Snack", "Pre_Workout", "Post_Workout"]

DEFAULT_TARGETS = {
    "target_calories": 2100,
    "target_protein_g": Decimal("158"),
    "target_carbs_g": Decimal("210"),
    "target_fat_g": Decimal("70"),
    "target_fiber_g": Decimal("30"),
    "target_water_l": Decimal("2.5"),
    "protein_pct": 30,
    "carbs_pct": 40,
    "fat_pct": 30,
}

PROTEIN_PER_KG = {
    "muscle_gain": 2.0,
    "weight_loss": 2.2,
    "maintenance": 1.6,
    "default": 1.8,
}


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _normalize_insight_text(text: str) -> str:
    cleaned = " ".join((text or "").replace("\n", " ").split()).strip()
    return cleaned


def _normalize_goal(goal: str | None) -> str:
    g = (goal or "").strip().lower().replace(" ", "_")
    if "muscle" in g or g == "gain":
        return "muscle_gain"
    if "fat" in g or "loss" in g:
        return "weight_loss"
    if "maint" in g:
        return "maintenance"
    return "default"


def calculate_protein_target_g(body_weight_kg: float, goal: str) -> float:
    factor = PROTEIN_PER_KG.get(goal, PROTEIN_PER_KG["default"])
    return round(body_weight_kg * factor)


def fallback_macro_pct(target_calories: int) -> dict[str, int]:
    if target_calories <= 2000:
        return {"protein_pct": 30, "carbs_pct": 40, "fat_pct": 30}
    if target_calories <= 2500:
        return {"protein_pct": 27, "carbs_pct": 43, "fat_pct": 30}
    if target_calories <= 3000:
        return {"protein_pct": 23, "carbs_pct": 47, "fat_pct": 30}
    return {"protein_pct": 20, "carbs_pct": 50, "fat_pct": 30}


def calculate_macro_targets(target_calories: int, body_weight_kg: float, goal: str) -> dict[str, int]:
    safe_target_calories = max(1, int(target_calories or DEFAULT_TARGETS["target_calories"]))
    normalized_goal = _normalize_goal(goal)

    # Step 1: protein in grams (body-weight based)
    protein_g = calculate_protein_target_g(body_weight_kg, normalized_goal)

    # Step 2: cap protein calories at 35%
    protein_calories = protein_g * 4
    protein_calories = min(protein_calories, safe_target_calories * 0.35)
    protein_g = round(protein_calories / 4)

    # Step 3: split remaining calories between carbs and fats
    remaining_calories = safe_target_calories - protein_calories
    carbs_calories = remaining_calories * 0.60
    fat_calories = remaining_calories * 0.40

    carbs_g = round(carbs_calories / 4)
    fat_g = round(fat_calories / 9)

    return {
        "target_protein_g": int(protein_g),
        "target_carbs_g": int(carbs_g),
        "target_fat_g": int(fat_g),
        "protein_pct": int(round((protein_calories / safe_target_calories) * 100)),
        "carbs_pct": int(round((carbs_calories / safe_target_calories) * 100)),
        "fat_pct": int(round((fat_calories / safe_target_calories) * 100)),
    }


def _default_targets_for_user(target_calories: int, body_weight_kg: float | None, goal: str | None) -> dict[str, Any]:
    safe_target_calories = max(1, int(target_calories or DEFAULT_TARGETS["target_calories"]))
    resolved_weight = float(body_weight_kg or 0)

    if resolved_weight > 0:
        macro_targets = calculate_macro_targets(safe_target_calories, resolved_weight, goal or "default")
    else:
        pct = fallback_macro_pct(safe_target_calories)
        protein_calories = safe_target_calories * (pct["protein_pct"] / 100)
        carbs_calories = safe_target_calories * (pct["carbs_pct"] / 100)
        fat_calories = safe_target_calories * (pct["fat_pct"] / 100)
        macro_targets = {
            "target_protein_g": int(round(protein_calories / 4)),
            "target_carbs_g": int(round(carbs_calories / 4)),
            "target_fat_g": int(round(fat_calories / 9)),
            "protein_pct": pct["protein_pct"],
            "carbs_pct": pct["carbs_pct"],
            "fat_pct": pct["fat_pct"],
        }

    return {
        "target_calories": safe_target_calories,
        "target_protein_g": Decimal(str(macro_targets["target_protein_g"])),
        "target_carbs_g": Decimal(str(macro_targets["target_carbs_g"])),
        "target_fat_g": Decimal(str(macro_targets["target_fat_g"])),
        "target_fiber_g": DEFAULT_TARGETS["target_fiber_g"],
        "target_water_l": DEFAULT_TARGETS["target_water_l"],
        "protein_pct": int(macro_targets["protein_pct"]),
        "carbs_pct": int(macro_targets["carbs_pct"]),
        "fat_pct": int(macro_targets["fat_pct"]),
    }


CALORIE_COACH_SYSTEM_PROMPT = (
    "You are an elite sports nutrition coach inside a premium calorie tracking app.\n"
    "Return ONLY a valid JSON object with these exact keys:\n\n"
    '1. "insight" — string, 3-4 concise sentences covering: calorie status vs goal, macro balance assessment, '
    "hydration status, and one specific next-meal recommendation using foods from the provided dataset with realistic portions.\n\n"
    '2. "bodyImpact" — string, 2-3 sentences about how today\'s current intake is likely affecting: energy levels, '
    "mental clarity, muscle recovery, digestion, or metabolic rate. Be practical and evidence-based. No fear language or diagnoses.\n\n"
    '3. "mealPlan" — array of exactly 3 objects, each with keys:\n'
    '   - "meal": string (e.g. "Lunch", "Evening Snack", "Dinner")\n'
    '   - "items": string (specific foods with quantities from the dataset)\n'
    '   - "calories": number (estimated kcal for this meal)\n'
    '   - "protein": number (grams)\n'
    '   - "carbs": number (grams)\n'
    '   - "fat": number (grams)\n'
    "   These 3 meals should roughly fill the remaining calorie and macro gaps for the day.\n\n"
    '4. "macroVerdict" — object with exactly 3 keys:\n'
    '   - "protein": object with "status" (one of "low", "on_track", "high") and "tip" (one sentence actionable fix)\n'
    '   - "carbs": object with "status" and "tip"\n'
    '   - "fat": object with "status" and "tip"\n\n'
    '5. "hydrationPlan" — object with keys:\n'
    '   - "currentMl": number (from user data)\n'
    '   - "targetMl": number (recommended daily total, typically 2500-3500 based on activity)\n'
    '   - "remainingMl": number\n'
    '   - "nextAction": string (e.g. "Drink 500ml water before your next meal")\n\n'
    '6. "dailyScore" — integer 0-100 representing overall nutrition quality today. Factor in calorie adherence (40%), '
    "macro balance (30%), hydration (15%), meal timing/frequency (15%).\n\n"
    '7. "scoreLabel" — string, one of: "Needs Work", "Getting There", "Solid Day", "Excellent", "Perfect"\n\n'
    '8. "alerts" — array of exactly 4 objects with keys: "type", "icon", "title", "subtitle". '
    'Types must be: "calorie", "hydration", "meal", "nutrition".\n\n'
    '9. "dietTips" — array of exactly 5 objects personalized from the provided DATA. Each object must have keys:\n'
    '   - "emoji": string, one relevant emoji only\n'
    '   - "title": string, concise health or diet tip\n'
    '   - "body": string, 1 practical sentence tied to today\'s calories, protein, carbs, fat, fibre, water, meals, goal, or activity\n'
    '   - "tag": string, short label such as "Gut", "Protein", "Digestion", "Timing", or "Fat"\n'
    '   - "category": string, one of "gut", "protein", "digestion", "timing", "fat"\n'
    "   Tips must be specific to the user's logged intake and targets, not generic wellness advice.\n\n"
    "Rules:\n"
    "- DIETARY COMPLIANCE IS MANDATORY: Read diet_type and allergies from the DATA object. "
    "If diet_type is 'vegetarian', every single food item across insight, mealPlan items, "
    "dietTips, and alerts MUST be vegetarian. No exceptions. "
    "If diet_type is 'vegan', exclude all animal products. "
    "Never suggest any food listed in allergies.\n"
    "- Suggest only foods from the provided food_dataset_reference with approximate quantities.\n"
    '- No markdown, no bullets, no headings. Do not use emojis except in dietTips[].emoji.\n'
    "- All numbers must be realistic integers, not strings.\n"
    "- If remaining_calories <= 0, mealPlan should contain only very light options (salad, herbal tea, etc.) totaling under 200 kcal.\n"
    "- If no meals logged, provide a complete full-day plan across breakfast, lunch, dinner."
)


def _macro_status(consumed: float, target: float) -> str:
    if target <= 0:
        return "on_track"
    ratio = consumed / target
    if ratio < 0.7:
        return "low"
    if ratio > 1.15:
        return "high"
    return "on_track"


def _score_label(score: int) -> str:
    if score >= 90:
        return "Perfect"
    if score >= 81:
        return "Excellent"
    if score >= 61:
        return "Solid Day"
    if score >= 31:
        return "Getting There"
    return "Needs Work"


def _user_coach_profile(db: Session, user: User) -> dict[str, Any]:
    weight = float(user.weight or 70)
    goal = "maintain"
    activity = "moderate"
    diet_type = "none"
    allergies: list[str] = []

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    if ob and isinstance(ob.onboarding_json, dict):
        oj = ob.onboarding_json

        g = oj.get("goal")
        if isinstance(g, dict):
            goal = str(g.get("primary") or g.get("type") or goal).lower().replace(" ", "_")

        act = oj.get("activity")
        if isinstance(act, dict):
            activity = str(act.get("level") or activity).lower().replace(" ", "_")

        dietary = oj.get("dietary")
        if isinstance(dietary, dict):
            raw_diet = dietary.get("diet_type") or dietary.get("dietType") or "none"
            diet_type = str(raw_diet).lower().strip()

            raw_allergies = dietary.get("allergies") or dietary.get("food_allergies") or []
            if isinstance(raw_allergies, list):
                allergies = [str(a).lower().strip() for a in raw_allergies if a]

    elif user.goal_tag:
        goal = str(user.goal_tag).lower().replace(" ", "_")

    return {
        "user_weight_kg": round(weight, 1),
        "goal": goal,
        "activity_level": activity,
        "diet_type": diet_type,
        "allergies": allergies,
    }


def _coach_macro_targets(log: dict[str, Any], profile_weight: float) -> dict[str, int]:
    daily_goal = int(log.get("target_calories") or 2100)
    pt = float(log.get("target_protein_g") or 0)
    if pt > 0:
        water_target = int(round(float(log.get("target_water_l") or 0) * 1000))
        if water_target <= 0:
            water_target = max(2500, int(profile_weight * 35))
        return {
            "protein_target_g": int(round(pt)),
            "carbs_target_g": int(round(float(log.get("target_carbs_g") or 0))),
            "fat_target_g": int(round(float(log.get("target_fat_g") or 0))),
            "water_target_ml": water_target,
        }
    return {
        "protein_target_g": round(daily_goal * 0.30 / 4),
        "carbs_target_g": round(daily_goal * 0.50 / 4),
        "fat_target_g": round(daily_goal * 0.20 / 9),
        "water_target_ml": max(2500, int(profile_weight * 35)),
    }


def _format_meal_time(logged_at: str | None, meal_type: str | None) -> str:
    if logged_at:
        try:
            raw = logged_at.replace("Z", "+00:00")
            dt = datetime.fromisoformat(raw)
            return dt.strftime("%I:%M %p").lstrip("0")
        except Exception:
            pass
    return str(meal_type or "Meal")


def _build_coach_user_msg(db: Session, user: User, day_payload: dict[str, Any]) -> dict[str, Any]:
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    meals = day_payload.get("meals") or []
    profile = _user_coach_profile(db, user)
    macros = _coach_macro_targets(log, profile["user_weight_kg"])
    daily_goal = int(log.get("target_calories") or 2100)
    consumed = int(round(_num(log.get("total_calories"))))
    water_ml = int(round(_num(water.get("total_water_l")) * 1000))

    dataset_rows: list[dict[str, Any]] = []
    try:
        diet_type = profile.get("diet_type", "none").lower().strip()
        if diet_type == "vegan":
            diet_where = "WHERE is_vegan = TRUE"
        elif diet_type == "vegetarian":
            diet_where = "WHERE is_vegetarian = TRUE"
        else:
            diet_where = ""

        refs = (
            db.execute(
                text(
                    f"""
                    SELECT food_name, calories_per_100g, protein_g, carbs_g, fat_g
                    FROM food_items
                    {diet_where}
                    ORDER BY food_id ASC
                    LIMIT 60
                    """
                )
            )
            .mappings()
            .all()
        )
        dataset_rows.extend(
            [
                {
                    "food": r["food_name"],
                    "cal_per_100g": float(r["calories_per_100g"] or 0),
                    "protein_per_100g": float(r["protein_g"] or 0),
                    "carbs_per_100g": float(r["carbs_g"] or 0),
                    "fat_per_100g": float(r["fat_g"] or 0),
                }
                for r in refs
            ]
        )
    except Exception:
        db.rollback()

    for m in meals[:15]:
        if isinstance(m, dict):
            dataset_rows.append(
                {
                    "food": m.get("food_name"),
                    "cal_per_100g": m.get("calories_per_100g"),
                    "protein_per_100g": m.get("protein_per_100g"),
                    "carbs_per_100g": m.get("carbs_per_100g"),
                    "fat_per_100g": m.get("fat_per_100g"),
                }
            )

    meals_eaten = [
        {
            "name": m.get("food_name") or "Meal",
            "calories": int(round(_num(m.get("total_calories")))),
            "time": _format_meal_time(m.get("logged_at"), m.get("meal_type")),
        }
        for m in meals[:15]
        if isinstance(m, dict)
    ]

    return {
        "time_of_day": datetime.now().strftime("%I:%M %p").lstrip("0"),
        "consumed_calories": consumed,
        "daily_goal": daily_goal,
        "remaining_calories": daily_goal - consumed,
        "protein_g": int(round(_num(log.get("total_protein_g")))),
        "protein_target_g": macros["protein_target_g"],
        "carbs_g": int(round(_num(log.get("total_carbs_g")))),
        "carbs_target_g": macros["carbs_target_g"],
        "fat_g": round(_num(log.get("total_fat_g")), 1),
        "fat_target_g": macros["fat_target_g"],
        "fibre_g": int(round(_num(log.get("total_fiber_g")))),
        "water_ml": water_ml,
        "water_target_ml": macros["water_target_ml"],
        "meals_logged": len(meals),
        "meals_target": 3,
        "user_weight_kg": profile["user_weight_kg"],
        "activity_level": profile["activity_level"],
        "goal": profile["goal"],
        "diet_type": profile.get("diet_type", "none"),
        "allergies": profile.get("allergies", []),
        "food_dataset_reference": dataset_rows,
        "meals_eaten_today": meals_eaten,
        "rules": [
            f"CRITICAL: User's diet_type is '{profile.get('diet_type', 'none')}'. "
            "You MUST strictly follow this. "
            "If diet_type is 'vegetarian': NEVER suggest meat, poultry, seafood, fish, "
            "or any non-vegetarian ingredient in ANY field (insight, mealPlan, dietTips, alerts). "
            "If diet_type is 'vegan': NEVER suggest any animal product including dairy or eggs. "
            "If diet_type is 'keto': keep carbs under 30g total across mealPlan. "
            "If diet_type is 'paleo': exclude grains, legumes, dairy, and processed foods.",
            f"ALLERGIES: User is allergic to or intolerant of: "
            f"{', '.join(profile.get('allergies', [])) or 'none'}. "
            "NEVER suggest any food containing these allergens in any form.",
            "If remaining_calories <= 0 suggest stopping intake or very light options.",
            "If no meals logged, suggest a full-day plan.",
            "Use approximate quantities.",
            "Prioritize foods from the dataset. If dataset is insufficient, use common Indian foods.",
            "mealPlan must fill the remaining macro gaps realistically.",
        ],
    }


def _normalize_coach_response(parsed: dict[str, Any], day_payload: dict[str, Any]) -> dict[str, Any]:
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    c = _num(log.get("total_calories"))
    t = _num(log.get("target_calories"))
    p = _num(log.get("total_protein_g"))
    pt = _num(log.get("target_protein_g")) or round(t * 0.30 / 4)
    carbs = _num(log.get("total_carbs_g"))
    ct = _num(log.get("target_carbs_g")) or round(t * 0.50 / 4)
    fat = _num(log.get("total_fat_g"))
    ft = _num(log.get("target_fat_g")) or round(t * 0.20 / 9)
    water_ml = int(round(_num(water.get("total_water_l")) * 1000))
    water_target = int(round(_num(log.get("target_water_l")) * 1000)) or 2500
    if water_target <= 0:
        water_target = 2500
    remaining = int(round(t - c))
    meals_count = len(day_payload.get("meals") or [])

    def macro_tip(name: str, consumed_v: float, target_v: float) -> dict[str, str]:
        status = _macro_status(consumed_v, target_v)
        if status == "low":
            tip = f"Add a {name}-rich food to your next meal to close the gap."
        elif status == "high":
            tip = f"Keep {name} lighter in remaining meals today."
        else:
            tip = f"{name.capitalize()} intake is on track for today."
        return {"status": status, "tip": tip}

    cal_adherence = max(0, 100 - abs(remaining) / max(t, 1) * 40) if remaining >= 0 else max(0, 60 - abs(remaining) / 50)
    macro_bal = (
        (100 if _macro_status(p, pt) == "on_track" else 50)
        + (100 if _macro_status(carbs, ct) == "on_track" else 50)
        + (100 if _macro_status(fat, ft) == "on_track" else 50)
    ) / 3
    hyd_score = min(100, (water_ml / max(water_target, 1)) * 100)
    meal_score = min(100, (meals_count / 3) * 100)
    daily_score = int(round(cal_adherence * 0.4 + macro_bal * 0.3 + hyd_score * 0.15 + meal_score * 0.15))

    default_insight = (
        f"You have consumed {int(round(c))} kcal with {remaining} kcal remaining. "
        f"Protein is {int(round(p))}g of {int(round(pt))}g target. "
        "Prioritize balanced meals and steady hydration for the rest of today."
    )
    body_default = (
        "At your current intake, energy may feel lower until you add more protein and calories. "
        "Steady hydration will support digestion and recovery through the day."
    )

    mv = parsed.get("macroVerdict") if isinstance(parsed.get("macroVerdict"), dict) else {}
    hp = parsed.get("hydrationPlan") if isinstance(parsed.get("hydrationPlan"), dict) else {}

    meal_plan_raw = parsed.get("mealPlan") if isinstance(parsed.get("mealPlan"), list) else []
    meal_plan: list[dict[str, Any]] = []
    for item in meal_plan_raw[:3]:
        if not isinstance(item, dict):
            continue
        meal_plan.append(
            {
                "meal": str(item.get("meal") or "Meal"),
                "items": str(item.get("items") or "Balanced meal from your food log"),
                "calories": int(_num(item.get("calories"))),
                "protein": int(_num(item.get("protein"))),
                "carbs": int(_num(item.get("carbs"))),
                "fat": int(_num(item.get("fat"))),
            }
        )

    alerts_raw = parsed.get("alerts") if isinstance(parsed.get("alerts"), list) else []
    alerts: list[dict[str, str]] = []
    for a in alerts_raw[:4]:
        if isinstance(a, dict) and a.get("title"):
            alerts.append(
                {
                    "type": str(a.get("type") or "info"),
                    "icon": str(a.get("icon") or ""),
                    "title": str(a.get("title") or ""),
                    "subtitle": str(a.get("subtitle") or ""),
                }
            )

    if len(alerts) < 4:
        fallback_alerts = [
            {
                "type": "calorie",
                "icon": "calorie",
                "title": "Calorie Alert",
                "subtitle": f"You are {remaining} calories away from your daily goal" if remaining > 0 else "Daily calorie goal reached",
            },
            {
                "type": "hydration",
                "icon": "hydration",
                "title": "Hydration Alert",
                "subtitle": f"You have logged {water_ml} ml water today",
            },
            {
                "type": "meal",
                "icon": "meal",
                "title": "Meal Alert",
                "subtitle": f"You have logged {meals_count} meal(s) so far today",
            },
            {
                "type": "nutrition",
                "icon": "nutrition",
                "title": "Nutrition Alert",
                "subtitle": f"Protein intake is {int(round(p))}g — add a protein-rich snack" if p < pt * 0.7 else f"Protein at {int(round(p))}g looks solid",
            },
        ]
        for fa in fallback_alerts:
            if len(alerts) >= 4:
                break
            if not any(x.get("type") == fa["type"] for x in alerts):
                alerts.append(fa)

    diet_tip_categories = {"gut", "protein", "digestion", "timing", "fat"}
    diet_tips_raw = parsed.get("dietTips") if isinstance(parsed.get("dietTips"), list) else []
    diet_tips: list[dict[str, str]] = []
    for item in diet_tips_raw[:5]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        body = str(item.get("body") or "").strip()
        if not title or not body:
            continue
        category = str(item.get("category") or "gut").strip().lower()
        if category not in diet_tip_categories:
            category = "gut"
        diet_tips.append(
            {
                "emoji": str(item.get("emoji") or "🌿").strip()[:4] or "🌿",
                "title": title[:90],
                "body": body[:220],
                "tag": str(item.get("tag") or category.capitalize()).strip()[:24],
                "category": category,
            }
        )

    def pick_macro(key: str, consumed_v: float, target_v: float) -> dict[str, str]:
        block = mv.get(key) if isinstance(mv.get(key), dict) else {}
        status = str(block.get("status") or _macro_status(consumed_v, target_v))
        if status not in ("low", "on_track", "high"):
            status = _macro_status(consumed_v, target_v)
        tip = str(block.get("tip") or macro_tip(key, consumed_v, target_v)["tip"])
        return {"status": status, "tip": tip}

    current_ml = int(_num(hp.get("currentMl")) or water_ml)
    target_ml = int(_num(hp.get("targetMl")) or water_target)
    remaining_ml = int(_num(hp.get("remainingMl")) or max(0, target_ml - current_ml))

    return {
        "insight": _normalize_insight_text(str(parsed.get("insight") or default_insight)),
        "bodyImpact": str(parsed.get("bodyImpact") or body_default),
        "mealPlan": meal_plan,
        "macroVerdict": {
            "protein": pick_macro("protein", p, pt),
            "carbs": pick_macro("carbs", carbs, ct),
            "fat": pick_macro("fat", fat, ft),
        },
        "hydrationPlan": {
            "currentMl": current_ml,
            "targetMl": target_ml,
            "remainingMl": remaining_ml,
            "nextAction": str(hp.get("nextAction") or f"Drink {min(500, remaining_ml)}ml before your next meal"),
        },
        "dailyScore": int(_num(parsed.get("dailyScore")) or daily_score),
        "scoreLabel": str(parsed.get("scoreLabel") or _score_label(daily_score)),
        "alerts": alerts[:4],
        "dietTips": diet_tips[:5],
    }


def _fallback_coach(day_payload: dict[str, Any]) -> dict[str, Any]:
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    c = _num(log.get("total_calories"))
    t = _num(log.get("target_calories"))
    p = _num(log.get("total_protein_g"))
    pt = _num(log.get("target_protein_g")) or round(t * 0.30 / 4)
    carbs = _num(log.get("total_carbs_g"))
    ct = _num(log.get("target_carbs_g")) or round(t * 0.50 / 4)
    fat = _num(log.get("total_fat_g"))
    ft = _num(log.get("target_fat_g")) or round(t * 0.20 / 9)
    water_ml = int(round(_num(water.get("total_water_l")) * 1000))
    water_target = int(round(_num(log.get("target_water_l")) * 1000)) or 2500
    remaining = int(round(t - c))
    meals_count = len(day_payload.get("meals") or [])

    per_meal_cal = max(0, int(remaining / 3)) if remaining > 0 else 80
    meal_plan = [
        {
            "meal": "Lunch" if meals_count < 2 else "Evening Snack",
            "items": "Dal (150g) + 2 roti + mixed vegetables",
            "calories": per_meal_cal,
            "protein": max(12, int((pt - p) / 3)),
            "carbs": max(20, int((ct - carbs) / 3)),
            "fat": max(5, int((ft - fat) / 3)),
        },
        {
            "meal": "Evening Snack",
            "items": "Paneer (80g) or 2 boiled eggs + fruit",
            "calories": per_meal_cal,
            "protein": max(10, int((pt - p) / 3)),
            "carbs": max(15, int((ct - carbs) / 3)),
            "fat": max(4, int((ft - fat) / 3)),
        },
        {
            "meal": "Dinner",
            "items": "Grilled chicken or tofu (120g) + rice (80g) + salad",
            "calories": per_meal_cal,
            "protein": max(15, int((pt - p) / 3)),
            "carbs": max(25, int((ct - carbs) / 3)),
            "fat": max(6, int((ft - fat) / 3)),
        },
    ]
    if remaining <= 0:
        meal_plan = [
            {"meal": "Light option", "items": "Herbal tea + cucumber salad", "calories": 60, "protein": 2, "carbs": 8, "fat": 1},
            {"meal": "Optional", "items": "Clear soup (1 cup)", "calories": 80, "protein": 4, "carbs": 10, "fat": 2},
            {"meal": "Optional", "items": "Greek yogurt (100g) if hungry", "calories": 90, "protein": 10, "carbs": 6, "fat": 3},
        ]

    base = _normalize_coach_response(
        {
            "insight": (
                f"You have consumed {int(round(c))} kcal with {remaining} kcal remaining. "
                f"Macros: {int(round(p))}g protein, {int(round(carbs))}g carbs, {round(fat, 1)}g fat. "
                "Use the meal plan below to close your gaps steadily."
            ),
            "bodyImpact": (
                "Low protein so far may reduce muscle recovery and afternoon energy. "
                "Adding hydration and a protein-focused meal will improve focus and digestion."
            ),
            "mealPlan": meal_plan,
        },
        day_payload,
    )
    base["source"] = "fallback"
    return base


def _ai_provider_fallback_error(err: str) -> bool:
    lowered = err.lower()
    return (
        "groq http 403" in lowered
        or "error code: 1010" in lowered
        or "ssl" in lowered
        or "certificate" in lowered
        or "network error" in lowered
        or "timed out" in lowered
    )


def _groq_model_unavailable(status_code: int, body: str) -> bool:
    lower = body.lower()
    return status_code in (400, 404) and (
        "decommissioned" in lower
        or "no longer supported" in lower
        or "model_not_found" in lower
        or "not found" in lower
    )


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("Malformed JSON response from model")

    # Strip common wrappers like ```json ... ``` before deeper parsing.
    if "```" in text:
        text = text.replace("```json", "```").replace("```JSON", "```")
        parts = [part.strip() for part in text.split("```") if part.strip()]
        for part in parts:
            try:
                parsed = json.loads(part)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                continue

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Fallback: scan all balanced JSON objects and return the first valid one.
    #   { ... }\n\nExtra notes...
    # or chain-of-thought text before a final JSON block.
    for start in [i for i, ch in enumerate(text) if ch == "{"]:
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : i + 1]
                    try:
                        parsed = json.loads(candidate)
                    except Exception:
                        break
                    if isinstance(parsed, dict):
                        return parsed
                    break
    raise ValueError("Malformed JSON response from model")


def _to_safe_float(v: Any) -> float:
    try:
        return max(0.0, round(float(v or 0), 1))
    except Exception:
        return 0.0


def _normalize_food_analysis_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    if isinstance(parsed.get("error"), str) and parsed["error"].strip():
        raise ValueError(parsed["error"].strip())
    food_name = str(parsed.get("foodName") or "").strip()
    if not food_name:
        raise ValueError("Could not detect food from this image.")
    confidence_raw = str(parsed.get("confidence") or "medium").strip().lower()
    confidence = confidence_raw if confidence_raw in {"low", "medium", "high"} else "medium"
    serving = str(parsed.get("estimatedServingSize") or "").strip() or "100g"
    return {
        "foodName": food_name,
        "estimatedServingSize": serving,
        "calories": _to_safe_float(parsed.get("calories")),
        "protein": _to_safe_float(parsed.get("protein")),
        "carbs": _to_safe_float(parsed.get("carbs")),
        "fats": _to_safe_float(parsed.get("fats")),
        "fibre": _to_safe_float(parsed.get("fibre")),
        "confidence": confidence,
    }


def _groq_food_image_analysis(
    base64: str,
    mime_type: str | None,
    *,
    user_id: int | None = None,
) -> dict[str, Any]:
    groq_keys: list[str] = []
    for key in (settings.GROQ_API_KEY, settings.GROQ_API_KEY_FALLBACK):
        k = (key or "").strip()
        if k and k not in groq_keys:
            groq_keys.append(k)
    if not groq_keys:
        raise RuntimeError("GROQ_API_KEY missing on server")

    # Use vision-capable models explicitly. settings.GROQ_MODEL can be text-only.
    model_candidates = [
        # Verified available for this Groq account; accepts image_url content arrays.
        "qwen/qwen3.6-27b",
        # Keep legacy candidates as fallback for accounts with Llama vision access.
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
    ]
    image_mime = (mime_type or "image/jpeg").strip() or "image/jpeg"
    system_prompt = (
        "You are a strict nutrition expert AI for meal photo analysis. "
        "Do NOT miss any visible food item in the image. "
        "You must account for every detectable food component (including sides, toppings, sauces, oils, and drinks if visible) "
        "and return combined totals for the entire image. "
        "Return ONLY one valid JSON object with keys: "
        "foodName, estimatedServingSize, calories, protein, carbs, fats, fibre, confidence. "
        "foodName should summarize the full meal (all detected items). "
        "estimatedServingSize should describe total serving for the full meal. "
        "calories/protein/carbs/fats/fibre must be TOTALS for all detected items together, not per-item or per-100g. "
        "confidence must be one of low|medium|high. "
        "If no food is visible, return {\"error\":\"No food detected\"}. "
        "No markdown, no code fences, no extra text."
    )
    payload: dict[str, Any] | None = None
    used_model = model_candidates[0]
    used_fallback_key = False
    last_err: str | None = None
    for key_idx, api_key in enumerate(groq_keys):
        for model_name in model_candidates:
            try:
                payload = post_json(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                        "User-Agent": "fitness-food-analyzer/1.0",
                    },
                    payload={
                        "model": model_name,
                        "temperature": 0.1,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": "Analyze this food image and estimate nutrition values."},
                                    {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{base64}"}},
                                ],
                            },
                        ],
                    },
                    timeout=40,
                )
                used_model = model_name
                used_fallback_key = key_idx > 0
                break
            except ExternalHTTPError as e:
                body = e.body or ""
                lower = body.lower()
                if e.status_code == 429:
                    last_err = f"{model_name}: rate limited"
                    continue
                if e.status_code in (400, 404) and (
                    "model_not_found" in lower
                    or "not found" in lower
                    or "decommissioned" in lower
                    or "no longer supported" in lower
                ):
                    last_err = f"{model_name}: unavailable"
                    continue
                if e.status_code == 400 and "messages[1].content must be a string" in body:
                    last_err = f"{model_name}: not vision-capable for this key"
                    continue
                raise RuntimeError(f"Groq HTTP {e.status_code}: {body[:260]}") from e
        if payload is not None:
            break

    if payload is None:
        raise RuntimeError(f"Groq vision unavailable or rate-limited. Last error: {last_err or 'unknown'}")

    try:
        log_groq_call(
            user_id=user_id,
            feature="food_photo_analysis",
            model=used_model,
            endpoint="/api/calories/foods/analyze-image",
            response_json=payload,
            is_fallback=used_fallback_key,
        )
    except Exception:
        pass

    raw = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not raw:
        raise RuntimeError("Groq returned empty content")
    parsed = _extract_json_object(raw)
    return _normalize_food_analysis_payload(parsed)


def _gemini_food_image_analysis(
    base64: str,
    mime_type: str | None,
    *,
    user_id: int | None = None,
    is_fallback: bool = False,
) -> dict[str, Any]:
    if not has_gemini_key():
        raise RuntimeError("GEMINI_API_KEY missing on server")
    image_mime = (mime_type or "image/jpeg").strip() or "image/jpeg"
    model_candidates = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-2.0-flash",
    ]
    request_payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "Analyze this meal photo strictly. "
                            "Do NOT miss any visible food item. "
                            "You must include all detectable components (main dish, side items, toppings, sauces, oils, drinks if visible) "
                            "and compute combined totals for the entire image. "
                            "Return ONLY valid JSON with keys: "
                            "foodName, estimatedServingSize, calories, protein, carbs, fats, fibre, confidence. "
                            "foodName should summarize all detected items in one meal name. "
                            "estimatedServingSize must describe total serving for all items combined. "
                            "calories/protein/carbs/fats/fibre must be TOTALS for the full image. "
                            "confidence must be one of low|medium|high. "
                            'If no food is visible, return {"error":"No food detected"}. '
                            "No markdown, no extra text."
                        )
                    },
                    {"inline_data": {"mime_type": image_mime, "data": base64}},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "maxOutputTokens": 400,
        },
    }
    payload, model_name, used_fallback_key = gemini_generate_content_models(
        model_candidates,
        request_payload,
        timeout=40,
    )
    try:
        log_gemini_call(
            user_id=user_id,
            feature="food_photo_analysis",
            model=model_name,
            endpoint="/api/calories/foods/analyze-image",
            response_json=payload,
            is_fallback=is_fallback or used_fallback_key,
        )
    except Exception:
        pass
    raw = (
        (payload.get("candidates") or [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not raw:
        raise RuntimeError("Gemini returned empty content")
    parsed = _extract_json_object(raw)
    return _normalize_food_analysis_payload(parsed)


def _openai_food_image_analysis(
    base64: str,
    mime_type: str | None,
) -> dict[str, Any]:
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY missing on server")
    image_mime = (mime_type or "image/jpeg").strip() or "image/jpeg"
    payload = post_json(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "fitness-food-analyzer/1.0",
        },
        payload={
            "model": "gpt-4o-mini",
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a strict nutrition expert AI for meal photo analysis. "
                        "Return ONLY valid JSON with keys: foodName, estimatedServingSize, "
                        "calories, protein, carbs, fats, fibre, confidence. "
                        "confidence must be low|medium|high. "
                        'If no food is visible, return {"error":"No food detected"}.'
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this food image and estimate nutrition values."},
                        {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{base64}"}},
                    ],
                },
            ],
            "max_tokens": 400,
        },
        timeout=30,
    )
    raw = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not raw:
        raise RuntimeError("OpenAI returned empty content")
    parsed = _extract_json_object(raw)
    return _normalize_food_analysis_payload(parsed)


def _gemini_coach(db: Session, day_payload: dict[str, Any], user: User) -> dict[str, Any]:
    if not has_gemini_key():
        raise RuntimeError("GEMINI_API_KEY missing on server")

    user_msg = _build_coach_user_msg(db, user, day_payload)

    prompt_text = (
        f"{CALORIE_COACH_SYSTEM_PROMPT}\n\n"
        "Return only the JSON object described above.\n\n"
        f"DATA:\n{json.dumps(user_msg)}"
    )

    model_candidates = [
        settings.GEMINI_MODEL.strip() if settings.GEMINI_MODEL else "",
        "gemini-2.0-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash",
    ]
    model_candidates = [m for i, m in enumerate(model_candidates) if m and m not in model_candidates[:i]]

    request_payload = {
        "contents": [{"parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
            "maxOutputTokens": 1800,
        },
    }
    payload, used_model, used_fallback_key = gemini_generate_content_models(
        model_candidates,
        request_payload,
        timeout=30,
    )

    try:
        log_gemini_call(
            db=db,
            user_id=user.id,
            feature="calorie_coach",
            model=used_model,
            endpoint="/api/calories/coach/insight",
            response_json=payload,
            is_fallback=used_fallback_key,
        )
    except Exception:
        pass

    raw = (
        (payload.get("candidates") or [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not raw:
        raise RuntimeError("Gemini returned empty content")
    clean = raw.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(clean)
    if not isinstance(parsed, dict):
        raise RuntimeError("Gemini invalid JSON shape")
    out = _normalize_coach_response(parsed, day_payload)
    out["source"] = "gemini"
    return out


def _groq_coach(db: Session, day_payload: dict[str, Any], user: User) -> dict[str, Any]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing on server")

    user_msg = _build_coach_user_msg(db, user, day_payload)

    model_candidates = [
        settings.GROQ_MODEL.strip() if settings.GROQ_MODEL else "",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
    ]
    model_candidates = [m for i, m in enumerate(model_candidates) if m and m not in model_candidates[:i]]
    model_candidates = model_candidates[:2]

    payload: dict[str, Any] | None = None
    last_err: str | None = None
    used_model = model_candidates[0] if model_candidates else "llama-3.3-70b-versatile"
    for model_name in model_candidates:
        try:
            payload = post_json(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Accept": "application/json",
                    "User-Agent": "fitness-ai-coach/1.0",
                },
                payload={
                    "model": model_name,
                    "temperature": 0.3,
                    "max_tokens": 1400,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": CALORIE_COACH_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(user_msg)},
                    ],
                },
                timeout=30,
            )
            used_model = model_name
            break
        except ExternalHTTPError as e:
            if _groq_model_unavailable(e.status_code, e.body):
                last_err = f"{model_name}: unavailable"
                continue
            raise RuntimeError(f"Groq HTTP {e.status_code}: {e.body[:260]}") from e

    if payload is None:
        raise RuntimeError(f"No compatible Groq model available. Last tried: {last_err or 'unknown'}")

    try:
        log_groq_call(
            db=db,
            user_id=user.id,
            feature="calorie_coach",
            model=used_model,
            endpoint="/api/calories/coach/insight",
            response_json=payload,
        )
    except Exception:
        pass

    raw = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not raw:
        raise RuntimeError("Groq returned empty content")
    clean = raw.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(clean)
    if not isinstance(parsed, dict):
        raise RuntimeError("Groq invalid JSON shape")
    out = _normalize_coach_response(parsed, day_payload)
    out["source"] = "groq"
    return out


def _to_decimal(v: Any, default: Decimal) -> Decimal:
    if v is None:
        return default
    try:
        return Decimal(str(v))
    except Exception:
        return default


def _parse_log_date(value: str | None) -> date:
    if not value:
        return datetime.utcnow().date()
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid date; use YYYY-MM-DD") from exc


def _targets_from_onboarding_json(targets: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(targets, dict):
        return dict(DEFAULT_TARGETS)
    macros = targets.get("macros") if isinstance(targets.get("macros"), dict) else {}
    out = {
        "target_calories": int(targets.get("target_kcal") or DEFAULT_TARGETS["target_calories"]),
        "target_protein_g": _to_decimal(macros.get("protein_g"), DEFAULT_TARGETS["target_protein_g"]),
        "target_carbs_g": _to_decimal(macros.get("carbs_g"), DEFAULT_TARGETS["target_carbs_g"]),
        "target_fat_g": _to_decimal(macros.get("fat_g"), DEFAULT_TARGETS["target_fat_g"]),
        "target_fiber_g": _to_decimal(macros.get("fiber_g"), DEFAULT_TARGETS["target_fiber_g"]),
        "target_water_l": _to_decimal(macros.get("water_l"), DEFAULT_TARGETS["target_water_l"]),
        "protein_pct": int(macros.get("protein_pct") or DEFAULT_TARGETS["protein_pct"]),
        "carbs_pct": int(macros.get("carbs_pct") or DEFAULT_TARGETS["carbs_pct"]),
        "fat_pct": int(macros.get("fat_pct") or DEFAULT_TARGETS["fat_pct"]),
    }
    return out


def _adapt_existing_targets_for_user(existing_targets: dict[str, Any], user: User) -> dict[str, Any]:
    """
    Keep existing calorie/fiber/water targets, but recompute macro grams/% with
    adaptive logic so legacy users get updated macro guidance.
    """
    target_calories = int(existing_targets.get("target_calories") or DEFAULT_TARGETS["target_calories"])
    goal = (getattr(user, "goal_tag", None) or getattr(user, "goals", None) or "default")
    adaptive = _default_targets_for_user(target_calories, user.weight, goal)
    return {
        "target_calories": target_calories,
        "target_protein_g": adaptive["target_protein_g"],
        "target_carbs_g": adaptive["target_carbs_g"],
        "target_fat_g": adaptive["target_fat_g"],
        "target_fiber_g": _to_decimal(existing_targets.get("target_fiber_g"), DEFAULT_TARGETS["target_fiber_g"]),
        "target_water_l": _to_decimal(existing_targets.get("target_water_l"), DEFAULT_TARGETS["target_water_l"]),
        "protein_pct": int(adaptive["protein_pct"]),
        "carbs_pct": int(adaptive["carbs_pct"]),
        "fat_pct": int(adaptive["fat_pct"]),
    }


def resolve_user_targets(db: Session, user: User) -> dict[str, Any]:
    """
    Prefer user_calorie_targets when present (is_current = true);
    otherwise use user_onboarding.targets_json; else adaptive defaults.
    """
    try:
        # SAVEPOINT so a missing/legacy table does not wipe uncommitted work
        # (e.g. a newly flushed MonthlyMealPlan during week generation).
        with db.begin_nested():
            row = (
                db.execute(
                    text(
                        """
                        SELECT target_calories, target_protein_g, target_carbs_g, target_fat_g, target_fiber_g, target_water_l,
                               protein_pct, carbs_pct, fat_pct
                        FROM user_calorie_targets
                        WHERE user_id = :uid AND is_current = true
                        LIMIT 1
                        """
                    ),
                    {"uid": user.id},
                )
                .mappings()
                .first()
            )
            if row:
                persisted_targets = {
                    "target_calories": int(row["target_calories"] or DEFAULT_TARGETS["target_calories"]),
                    "target_protein_g": _to_decimal(row["target_protein_g"], DEFAULT_TARGETS["target_protein_g"]),
                    "target_carbs_g": _to_decimal(row["target_carbs_g"], DEFAULT_TARGETS["target_carbs_g"]),
                    "target_fat_g": _to_decimal(row["target_fat_g"], DEFAULT_TARGETS["target_fat_g"]),
                    "target_fiber_g": _to_decimal(row["target_fiber_g"], DEFAULT_TARGETS["target_fiber_g"]),
                    "target_water_l": _to_decimal(row["target_water_l"], DEFAULT_TARGETS["target_water_l"]),
                    "protein_pct": int(row["protein_pct"] or DEFAULT_TARGETS["protein_pct"]),
                    "carbs_pct": int(row["carbs_pct"] or DEFAULT_TARGETS["carbs_pct"]),
                    "fat_pct": int(row["fat_pct"] or DEFAULT_TARGETS["fat_pct"]),
                }
                return _adapt_existing_targets_for_user(persisted_targets, user)
    except Exception:
        # Missing table / wrong schema — fall back to onboarding / defaults.
        pass

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == user.id).first()
    if ob and isinstance(ob.targets_json, dict):
        onboarding_targets = _targets_from_onboarding_json(ob.targets_json)
        return _adapt_existing_targets_for_user(onboarding_targets, user)
    goal = (getattr(user, "goal_tag", None) or getattr(user, "goals", None) or "default")
    return _default_targets_for_user(DEFAULT_TARGETS["target_calories"], user.weight, goal)


def _macro_label(t: dict[str, Any]) -> str:
    return f"Protein {t['protein_pct']}% · Carbs {t['carbs_pct']}% · Fat {t['fat_pct']}%"


def _ensure_water_row(db: Session, user_id: int, log_date: date, target_water_l: Decimal) -> WaterIntakeLog:
    row = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == user_id, WaterIntakeLog.log_date == log_date).first()
    if row:
        row.target_water_l = target_water_l
        row.is_target_met = bool(row.total_water_l >= row.target_water_l)
        return row
    row = WaterIntakeLog(
        user_id=user_id,
        log_date=log_date,
        total_water_l=Decimal("0"),
        target_water_l=target_water_l,
        is_target_met=False,
    )
    db.add(row)
    return row


def _get_or_create_daily_log(db: Session, user: User, log_date: date) -> DailyNutritionLog:
    from src.services.calorie_log_targets import get_calorie_log_targets

    log = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == log_date)
        .first()
    )
    t = get_calorie_log_targets(db, user)
    if log:
        log.target_calories = t["target_calories"]
        log.target_protein_g = t["target_protein_g"]
        log.target_carbs_g = t["target_carbs_g"]
        log.target_fat_g = t["target_fat_g"]
        log.target_fiber_g = t["target_fiber_g"]
        log.target_water_l = t["target_water_l"]
        db.flush()
        _ensure_water_row(db, user.id, log_date, t["target_water_l"])
        db.flush()
        return log

    log = DailyNutritionLog(
        user_id=user.id,
        log_date=log_date,
        target_calories=t["target_calories"],
        target_protein_g=t["target_protein_g"],
        target_carbs_g=t["target_carbs_g"],
        target_fat_g=t["target_fat_g"],
        target_fiber_g=t["target_fiber_g"],
        target_water_l=t["target_water_l"],
        total_calories=Decimal("0"),
        total_protein_g=Decimal("0"),
        total_carbs_g=Decimal("0"),
        total_fat_g=Decimal("0"),
        total_fiber_g=Decimal("0"),
        total_water_l=Decimal("0"),
        calories_remaining=Decimal(str(t["target_calories"])),
        is_goal_met=False,
    )
    db.add(log)
    db.flush()
    _ensure_water_row(db, user.id, log_date, t["target_water_l"])
    db.flush()
    return log


def recalculate_daily_log(db: Session, log: DailyNutritionLog) -> None:
    meal_sums = (
        db.query(
            func.coalesce(func.sum(MealEntry.total_calories), 0),
            func.coalesce(func.sum(MealEntry.total_protein_g), 0),
            func.coalesce(func.sum(MealEntry.total_carbs_g), 0),
            func.coalesce(func.sum(MealEntry.total_fat_g), 0),
            func.coalesce(func.sum(MealEntry.total_fiber_g), 0),
        )
        .filter(MealEntry.log_id == log.log_id)
        .one()
    )
    ai_sums = (
        db.query(
            func.coalesce(func.sum(AIFoodMealEntry.calories), 0),
            func.coalesce(func.sum(AIFoodMealEntry.protein), 0),
            func.coalesce(func.sum(AIFoodMealEntry.carbs), 0),
            func.coalesce(func.sum(AIFoodMealEntry.fat), 0),
            func.coalesce(func.sum(AIFoodMealEntry.fibre), 0),
        )
        .filter(AIFoodMealEntry.user_id == log.user_id, AIFoodMealEntry.log_date == log.log_date)
        .one()
    )
    tc = Decimal(str(meal_sums[0])) + Decimal(str(ai_sums[0]))
    tp = Decimal(str(meal_sums[1])) + Decimal(str(ai_sums[1]))
    tcarbs = Decimal(str(meal_sums[2])) + Decimal(str(ai_sums[2]))
    tf = Decimal(str(meal_sums[3])) + Decimal(str(ai_sums[3]))
    tfi = Decimal(str(meal_sums[4])) + Decimal(str(ai_sums[4]))
    log.total_calories = tc
    log.total_protein_g = tp
    log.total_carbs_g = tcarbs
    log.total_fat_g = tf
    log.total_fiber_g = tfi
    log.calories_remaining = Decimal(log.target_calories) - tc
    log.is_goal_met = bool(tc >= Decimal(log.target_calories) and tp >= Decimal(log.target_protein_g))

    water_row = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == log.user_id, WaterIntakeLog.log_date == log.log_date).first()
    if water_row:
        log.total_water_l = water_row.total_water_l
        water_row.target_water_l = log.target_water_l
        water_row.is_target_met = bool(water_row.total_water_l >= water_row.target_water_l)
    db.flush()


def _serialize_meal(m: MealEntry) -> dict[str, Any]:
    return {
        "meal_id": m.meal_id,
        "log_id": m.log_id,
        "meal_type": m.meal_type,
        "source_type": m.source_type or "database",
        "food_id": m.food_id,
        "food_name": m.food_name,
        "quantity_g": float(m.quantity_g),
        "calories_per_100g": float(m.calories_per_100g),
        "protein_per_100g": float(m.protein_per_100g),
        "carbs_per_100g": float(m.carbs_per_100g),
        "fat_per_100g": float(m.fat_per_100g),
        "fiber_per_100g": float(m.fiber_per_100g),
        "total_calories": float(m.total_calories),
        "total_protein_g": float(m.total_protein_g),
        "total_carbs_g": float(m.total_carbs_g),
        "total_fat_g": float(m.total_fat_g),
        "total_fiber_g": float(m.total_fiber_g),
        "logged_at": m.logged_at.isoformat() if m.logged_at else None,
    }


def _serialize_ai_meal(m: AIFoodMealEntry) -> dict[str, Any]:
    qty = float(m.quantity_g or 0)
    safe_qty = qty if qty > 0 else 1.0
    return {
        "meal_id": -(int(m.ai_meal_id)),
        "log_id": None,
        "meal_type": m.meal_type,
        "source_type": "camera_ai",
        "food_id": None,
        "food_name": m.food_name,
        "quantity_g": qty,
        "calories_per_100g": float((Decimal(str(m.calories or 0)) * Decimal("100")) / Decimal(str(safe_qty))),
        "protein_per_100g": float((Decimal(str(m.protein or 0)) * Decimal("100")) / Decimal(str(safe_qty))),
        "carbs_per_100g": float((Decimal(str(m.carbs or 0)) * Decimal("100")) / Decimal(str(safe_qty))),
        "fat_per_100g": float((Decimal(str(m.fat or 0)) * Decimal("100")) / Decimal(str(safe_qty))),
        "fiber_per_100g": float((Decimal(str(m.fibre or 0)) * Decimal("100")) / Decimal(str(safe_qty))),
        "total_calories": float(m.calories or 0),
        "total_protein_g": float(m.protein or 0),
        "total_carbs_g": float(m.carbs or 0),
        "total_fat_g": float(m.fat or 0),
        "total_fiber_g": float(m.fibre or 0),
        "logged_at": m.created_at.isoformat() if m.created_at else None,
    }


def _serialize_day(db: Session, user: User, log_date: date) -> dict[str, Any]:
    log = _get_or_create_daily_log(db, user, log_date)
    recalculate_daily_log(db, log)
    db.commit()
    db.refresh(log)

    meals = (
        db.query(MealEntry)
        .filter(MealEntry.log_id == log.log_id)
        .order_by(MealEntry.logged_at.asc(), MealEntry.meal_id.asc())
        .all()
    )
    ai_meals = (
        db.query(AIFoodMealEntry)
        .filter(AIFoodMealEntry.user_id == user.id, AIFoodMealEntry.log_date == log_date)
        .order_by(AIFoodMealEntry.created_at.asc(), AIFoodMealEntry.ai_meal_id.asc())
        .all()
    )
    water = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == user.id, WaterIntakeLog.log_date == log_date).first()
    t = resolve_user_targets(db, user)

    return {
        "date": log_date.isoformat(),
        "macro_split_label": _macro_label(t),
        "log": {
            "log_id": log.log_id,
            "user_id": log.user_id,
            "log_date": log.log_date.isoformat(),
            "total_calories": float(log.total_calories),
            "total_protein_g": float(log.total_protein_g),
            "total_carbs_g": float(log.total_carbs_g),
            "total_fat_g": float(log.total_fat_g),
            "total_fiber_g": float(log.total_fiber_g),
            "total_water_l": float(log.total_water_l),
            "target_calories": log.target_calories,
            "target_protein_g": float(log.target_protein_g),
            "target_carbs_g": float(log.target_carbs_g),
            "target_fat_g": float(log.target_fat_g),
            "target_fiber_g": float(log.target_fiber_g),
            "target_water_l": float(log.target_water_l),
            "calories_remaining": float(log.calories_remaining),
            "is_goal_met": log.is_goal_met,
        },
        "water": {
            "total_water_l": float(water.total_water_l) if water else float(log.total_water_l),
            "target_water_l": float(water.target_water_l) if water else float(log.target_water_l),
            "is_target_met": bool(water.is_target_met) if water else False,
        },
        "meals": ([_serialize_meal(m) for m in meals] + [_serialize_ai_meal(m) for m in ai_meals]),
    }


def _meal_history_sort_value(item: dict[str, Any]) -> datetime:
    logged_at = item.get("logged_at")
    if logged_at:
        try:
            return datetime.fromisoformat(str(logged_at))
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(f"{item.get('date')}T00:00:00")
    except ValueError:
        return datetime.min


@router.post("/daily-log")
def ensure_daily_log(
    payload: DailyLogEnsureRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = _parse_log_date(payload.date if payload else None)
    return _serialize_day(db, current_user, log_date)


@router.get("/daily-log")
def get_daily_log_history(
    range_filter: str = Query(default="today", alias="range", pattern="^(today|all)$"),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=80),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    search_term = search.strip() if search and search.strip() else None
    db_meals_query = (
        db.query(MealEntry, DailyNutritionLog.log_date)
        .join(DailyNutritionLog, MealEntry.log_id == DailyNutritionLog.log_id)
        .filter(MealEntry.user_id == current_user.id)
    )
    ai_meals_query = db.query(AIFoodMealEntry).filter(AIFoodMealEntry.user_id == current_user.id)
    if range_filter != "all":
        db_meals_query = db_meals_query.filter(DailyNutritionLog.log_date == today)
        ai_meals_query = ai_meals_query.filter(AIFoodMealEntry.log_date == today)
    if search_term:
        db_meals_query = db_meals_query.filter(MealEntry.food_name.ilike(f"%{search_term}%"))
        ai_meals_query = ai_meals_query.filter(AIFoodMealEntry.food_name.ilike(f"%{search_term}%"))

    total_db = db_meals_query.count()
    total_ai = ai_meals_query.count()
    total_count = total_db + total_ai
    db_sums = db_meals_query.with_entities(
        func.coalesce(func.sum(MealEntry.total_calories), 0),
        func.coalesce(func.sum(MealEntry.total_protein_g), 0),
        func.coalesce(func.sum(MealEntry.total_carbs_g), 0),
        func.coalesce(func.sum(MealEntry.total_fat_g), 0),
        func.coalesce(func.sum(MealEntry.total_fiber_g), 0),
    ).one()
    ai_sums = ai_meals_query.with_entities(
        func.coalesce(func.sum(AIFoodMealEntry.calories), 0),
        func.coalesce(func.sum(AIFoodMealEntry.protein), 0),
        func.coalesce(func.sum(AIFoodMealEntry.carbs), 0),
        func.coalesce(func.sum(AIFoodMealEntry.fat), 0),
        func.coalesce(func.sum(AIFoodMealEntry.fibre), 0),
    ).one()

    fetch_size = offset + limit
    db_rows = (
        db_meals_query
        .order_by(MealEntry.logged_at.desc(), MealEntry.meal_id.desc())
        .limit(fetch_size)
        .all()
    )
    ai_rows = (
        ai_meals_query
        .order_by(AIFoodMealEntry.created_at.desc(), AIFoodMealEntry.ai_meal_id.desc())
        .limit(fetch_size)
        .all()
    )
    merged: list[dict[str, Any]] = []
    for meal, meal_date in db_rows:
        serialized = _serialize_meal(meal)
        serialized["date"] = meal_date.isoformat()
        merged.append(serialized)
    for meal in ai_rows:
        serialized = _serialize_ai_meal(meal)
        serialized["date"] = meal.log_date.isoformat()
        merged.append(serialized)
    merged.sort(key=_meal_history_sort_value, reverse=True)
    items = merged[offset: offset + limit]

    date_keys = sorted({str(item["date"]) for item in items}, reverse=True)
    day_total_rows = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == current_user.id, DailyNutritionLog.log_date.in_([date.fromisoformat(d) for d in date_keys] or [today]))
        .all()
    )
    day_totals = {
        row.log_date.isoformat(): {
            "total_calories": float(row.total_calories),
            "total_protein_g": float(row.total_protein_g),
            "total_carbs_g": float(row.total_carbs_g),
            "total_fat_g": float(row.total_fat_g),
            "total_fiber_g": float(row.total_fiber_g),
        }
        for row in day_total_rows
    }

    return {
        "items": items,
        "dayTotals": day_totals,
        "total": total_count,
        "limit": limit,
        "offset": offset,
        "summary": {
            "totalMealsLogged": total_count,
            "totalCalories": float(Decimal(str(db_sums[0])) + Decimal(str(ai_sums[0]))),
            "totalProtein": float(Decimal(str(db_sums[1])) + Decimal(str(ai_sums[1]))),
            "totalCarbs": float(Decimal(str(db_sums[2])) + Decimal(str(ai_sums[2]))),
            "totalFat": float(Decimal(str(db_sums[3])) + Decimal(str(ai_sums[3]))),
            "totalFiber": float(Decimal(str(db_sums[4])) + Decimal(str(ai_sums[4]))),
        },
    }


@router.get("/daily-log/{log_date}")
def get_daily_log(log_date: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = _parse_log_date(log_date)
    return _serialize_day(db, current_user, d)


@router.get("/streak")
def get_calorie_streak(
    days: int = Query(60, ge=1, le=366),
    end_date: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Bulk replacement for fetching `/daily-log/{date}` once per day in a loop.
    Returns total_calories for each of the last `days` calendar days (oldest → newest,
    `end_date` inclusive) in a single query — used by the Home screen streak/last-7-days
    calculations, which previously issued one request per day.

    Days with no logged meals are not backed by a `daily_nutrition_log` row (that row is
    only created when a meal is added — see `_get_or_create_daily_log`), so any date missing
    from the query result is reported as `total_calories: 0`, matching what
    `GET /daily-log/{date}` would have returned for that same day.
    """
    end = _parse_log_date(end_date)
    start = end - timedelta(days=days - 1)

    rows = (
        db.query(DailyNutritionLog.log_date, DailyNutritionLog.total_calories)
        .filter(
            DailyNutritionLog.user_id == current_user.id,
            DailyNutritionLog.log_date >= start,
            DailyNutritionLog.log_date <= end,
        )
        .all()
    )
    totals_by_date = {r.log_date.isoformat(): float(r.total_calories or 0) for r in rows}

    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        key = d.isoformat()
        out.append({"date": key, "total_calories": totals_by_date.get(key, 0.0)})

    streak_stats = calculate_user_streak(db, current_user.id)
    return {
        "days": out,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "current_streak": streak_stats["current_streak"],
        "personal_best_streak": streak_stats["personal_best_streak"],
    }


@router.post("/meals")
def add_meal_entry(payload: MealCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_date = _parse_log_date(payload.log_date)
    log = _get_or_create_daily_log(db, current_user, log_date)
    db.flush()

    q = payload.quantity_g
    c100 = payload.calories_per_100g
    p100 = payload.protein_per_100g
    carb100 = payload.carbs_per_100g
    f100 = payload.fat_per_100g
    fi100 = payload.fiber_per_100g

    total_calories = (c100 / Decimal("100")) * q
    total_protein_g = (p100 / Decimal("100")) * q
    total_carbs_g = (carb100 / Decimal("100")) * q
    total_fat_g = (f100 / Decimal("100")) * q
    total_fiber_g = (fi100 / Decimal("100")) * q

    source_type = payload.source_type if payload.source_type in {"database", "camera_ai", "meal_planner"} else "database"
    food_id = int(payload.food_id) if source_type in {"database", "meal_planner"} and payload.food_id is not None else None

    # Idempotent planner logs: one entry per recipe (or name) for the day.
    if source_type == "meal_planner":
        existing_q = db.query(MealEntry).filter(
            MealEntry.user_id == current_user.id,
            MealEntry.log_id == log.log_id,
            MealEntry.source_type == "meal_planner",
        )
        if food_id is not None:
            existing = existing_q.filter(MealEntry.food_id == food_id).first()
        else:
            existing = existing_q.filter(MealEntry.food_name == payload.food_name.strip()[:200]).first()
        if existing:
            return _serialize_day(db, current_user, log_date)

    entry = MealEntry(
        log_id=log.log_id,
        user_id=current_user.id,
        meal_type=payload.meal_type,
        source_type=source_type,
        food_id=food_id,
        food_name=payload.food_name.strip()[:200],
        quantity_g=q,
        calories_per_100g=c100,
        protein_per_100g=p100,
        carbs_per_100g=carb100,
        fat_per_100g=f100,
        fiber_per_100g=fi100,
        total_calories=total_calories,
        total_protein_g=total_protein_g,
        total_carbs_g=total_carbs_g,
        total_fat_g=total_fat_g,
        total_fiber_g=total_fiber_g,
    )
    db.add(entry)
    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    if total_calories > 0:
        emit_streak_milestone_if_needed(db, user_id=current_user.id, source="meal", source_id=entry.meal_id)
        award_xp_for_meal_log(db, user_id=current_user.id, log_date=log_date)
    return _serialize_day(db, current_user, log_date)


@router.delete("/meals/{meal_id}")
def delete_meal_entry(meal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    meal = db.query(MealEntry).filter(MealEntry.meal_id == meal_id, MealEntry.user_id == current_user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    log = db.query(DailyNutritionLog).filter(DailyNutritionLog.log_id == meal.log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Daily log missing")
    log_date = log.log_date
    db.delete(meal)
    db.flush()
    recalculate_daily_log(db, log)
    reevaluate_xp_after_meal_change(db, user_id=current_user.id, log_date=log_date)
    db.commit()
    return _serialize_day(db, current_user, log_date)


@router.delete("/foods/ai-meals/{ai_meal_id}")
def delete_ai_meal_entry(ai_meal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    meal = db.query(AIFoodMealEntry).filter(AIFoodMealEntry.ai_meal_id == ai_meal_id, AIFoodMealEntry.user_id == current_user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="AI meal not found")
    log_date = meal.log_date
    db.delete(meal)
    db.flush()
    log = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == current_user.id, DailyNutritionLog.log_date == log_date)
        .first()
    )
    if log:
        recalculate_daily_log(db, log)
    reevaluate_xp_after_meal_change(db, user_id=current_user.id, log_date=log_date)
    db.commit()
    return _serialize_day(db, current_user, log_date)


@router.patch("/meals/{meal_id}")
def update_meal_entry(
    meal_id: int,
    payload: MealUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meal = db.query(MealEntry).filter(MealEntry.meal_id == meal_id, MealEntry.user_id == current_user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    if (meal.source_type or "") == "meal_planner":
        raise HTTPException(status_code=400, detail="Planner meals can't be edited — remove the log instead.")
    log = db.query(DailyNutritionLog).filter(DailyNutritionLog.log_id == meal.log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Daily log missing")

    q = payload.quantity_g
    meal.quantity_g = q
    meal.total_calories = (Decimal(meal.calories_per_100g) / Decimal("100")) * q
    meal.total_protein_g = (Decimal(meal.protein_per_100g) / Decimal("100")) * q
    meal.total_carbs_g = (Decimal(meal.carbs_per_100g) / Decimal("100")) * q
    meal.total_fat_g = (Decimal(meal.fat_per_100g) / Decimal("100")) * q
    meal.total_fiber_g = (Decimal(meal.fiber_per_100g) / Decimal("100")) * q

    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    if meal.total_calories > 0:
        emit_streak_milestone_if_needed(db, user_id=current_user.id, source="meal", source_id=meal.meal_id)
        award_xp_for_meal_log(db, user_id=current_user.id, log_date=log.log_date)
    return _serialize_day(db, current_user, log.log_date)


@router.patch("/water")
def patch_water(payload: WaterPatchRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_date = _parse_log_date(payload.date)
    log = _get_or_create_daily_log(db, current_user, log_date)
    db.flush()
    water = db.query(WaterIntakeLog).filter(WaterIntakeLog.user_id == current_user.id, WaterIntakeLog.log_date == log_date).first()
    if not water:
        water = _ensure_water_row(db, current_user.id, log_date, log.target_water_l)
        db.flush()

    cap = max(Decimal("5"), Decimal(log.target_water_l) * Decimal("2"))
    new_total = max(Decimal("0"), min(payload.water_l, cap))
    water.total_water_l = new_total
    water.target_water_l = log.target_water_l
    water.is_target_met = bool(new_total >= log.target_water_l)
    log.total_water_l = new_total
    db.flush()
    recalculate_daily_log(db, log)
    db.commit()
    return _serialize_day(db, current_user, log_date)


@router.get("/foods/search")
def search_food_catalog(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    language: str | None = Query(default=None, max_length=32),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    catalog_language = normalize_language_tag(language or current_user.preferred_language).split("-", 1)[0]
    items = search_foods(db, q, limit, language=catalog_language)
    return {"items": items}


@router.post("/foods/lookup")
def lookup_food_nutrition(
    payload: FoodLookupRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.food_id is None and not (payload.food_name or "").strip():
        raise HTTPException(status_code=422, detail="Provide food_id or food_name.")
    catalog_language = normalize_language_tag(payload.language or current_user.preferred_language).split("-", 1)[0]
    found = lookup_food_scaled(
        db,
        food_id=payload.food_id,
        food_name=payload.food_name,
        quantity_g=payload.quantity_g,
        language=catalog_language,
    )
    if not found:
        raise HTTPException(status_code=404, detail="Food not found.")
    return found


@router.post("/foods/analyze-image")
def analyze_food_image(
    payload: FoodImageAnalyzeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = current_user
    _ = db
    try:
        clean_base64, image_mime = prepare_food_image_for_vision(payload.base64, payload.mime_type)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    def _try_fallbacks() -> dict[str, Any]:
        try:
            return _gemini_food_image_analysis(clean_base64, image_mime, user_id=current_user.id, is_fallback=True)
        except Exception as ge:
            gemini_msg = str(ge)
            try:
                return _openai_food_image_analysis(clean_base64, image_mime)
            except Exception:
                pass
            if "429" in gemini_msg or "quota" in gemini_msg.lower():
                raise HTTPException(
                    status_code=503,
                    detail="Food image analysis is temporarily unavailable. Please enter nutrition manually.",
                ) from ge
            raise HTTPException(
                status_code=502,
                detail="Could not analyze this image right now. Please try again or enter values manually.",
            ) from ge

    try:
        return _groq_food_image_analysis(clean_base64, image_mime, user_id=current_user.id)
    except ValueError as e:
        detail = str(e).strip()
        lowered = detail.lower()
        if "no food detected" in lowered or "could not detect food" in lowered:
            raise HTTPException(status_code=422, detail=detail) from e
        # Model output formatting issues should not hard-fail; fall through to other providers.
        return _try_fallbacks()
    except RuntimeError as e:
        groq_error = str(e)
        lowered = groq_error.lower()
        if "invalid image" in lowered or "image data" in lowered:
            raise HTTPException(
                status_code=422,
                detail="Could not read this photo. Try a JPEG or PNG image under 4MB.",
            ) from e
        return _try_fallbacks()


@router.post("/foods/ai-meals")
def create_ai_meal_entry(
    payload: AIFoodMealCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = _parse_log_date(payload.log_date)
    _get_or_create_daily_log(db, current_user, log_date)
    db.flush()
    confidence = (payload.confidence or "medium").strip().lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "medium"

    row = AIFoodMealEntry(
        user_id=current_user.id,
        log_date=log_date,
        meal_type=payload.meal_type,
        food_name=payload.food_name.strip()[:200],
        quantity_g=payload.quantity_g,
        calories=payload.calories,
        protein=payload.protein,
        carbs=payload.carbs,
        fat=payload.fat,
        fibre=payload.fibre,
        confidence=confidence,
        estimated_serving_size=(payload.estimated_serving_size or "").strip()[:120] or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    if row.calories and row.calories > 0:
        emit_streak_milestone_if_needed(db, user_id=current_user.id, source="ai_meal", source_id=row.ai_meal_id)
        award_xp_for_meal_log(db, user_id=current_user.id, log_date=log_date)
    day_payload = _serialize_day(db, current_user, log_date)
    return {
        "ai_meal_id": row.ai_meal_id,
        "saved": True,
        "meal_type": row.meal_type,
        "food_name": row.food_name,
        "quantity_g": float(row.quantity_g),
        "calories": float(row.calories),
        "protein": float(row.protein),
        "carbs": float(row.carbs),
        "fat": float(row.fat),
        "fibre": float(row.fibre),
        "confidence": row.confidence,
        "estimated_serving_size": row.estimated_serving_size,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "day": day_payload,
    }


@router.get("/coach/insight")
def coach_calorie_insight(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = _parse_log_date(local_date)
    day_payload = _serialize_day(db, current_user, log_date)
    # Free the pooled connection before Groq/Gemini HTTP (can take 30–60s).
    from src.db.session import release_db_connection

    release_db_connection(db)
    try:
        return _groq_coach(db, day_payload, current_user)
    except Exception as e:
        err = str(e)
        if has_gemini_key() and _ai_provider_fallback_error(err):
            try:
                return _gemini_coach(db, day_payload, current_user)
            except Exception:
                pass
        return _fallback_coach(day_payload)


def _onboarding_weight_kg(onboarding: dict[str, Any] | None) -> float | None:
    if not isinstance(onboarding, dict):
        return None
    personal = onboarding.get("personal")
    if not isinstance(personal, dict):
        return None
    try:
        if personal.get("unit_system") == "imperial" and personal.get("weight_lb") is not None:
            return float(personal["weight_lb"]) * 0.45359237
        if personal.get("weight_kg") is not None:
            return float(personal["weight_kg"])
    except (TypeError, ValueError):
        return None
    return None


def _onboarding_target_weight_kg(onboarding: dict[str, Any] | None) -> float | None:
    if not isinstance(onboarding, dict):
        return None
    goal = onboarding.get("goal")
    if not isinstance(goal, dict):
        return None
    try:
        if goal.get("target_weight_kg") is not None:
            return float(goal["target_weight_kg"])
    except (TypeError, ValueError):
        return None
    return _onboarding_weight_kg(onboarding)


@goal_progress_router.get("/goal-progress")
def get_goal_progress(
    local_date: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Goal timeline using latest weigh-in weight when available."""
    _ = _parse_log_date(local_date)

    ob = db.query(UserOnboarding).filter(UserOnboarding.user_id == current_user.id).first()
    onboarding_json = ob.onboarding_json if ob and isinstance(ob.onboarding_json, dict) else {}
    targets_json = ob.targets_json if ob and isinstance(ob.targets_json, dict) else {}
    timeline = targets_json.get("timeline") if isinstance(targets_json.get("timeline"), dict) else {}

    onboarding_weight_kg = _onboarding_weight_kg(onboarding_json)
    target_weight_kg = _onboarding_target_weight_kg(onboarding_json)

    latest_log = (
        db.query(WeightLog)
        .filter(WeightLog.user_id == current_user.id)
        .order_by(WeightLog.log_date.desc())
        .first()
    )

    current_weight_kg = (
        latest_log.weight_kg
        if latest_log
        else (current_user.weight or onboarding_weight_kg)
    )
    days_since_weigh_in = (
        (date.today() - date.fromisoformat(latest_log.log_date)).days if latest_log else None
    )

    weekly_change_kg = None
    try:
        raw_weekly = timeline.get("weekly_change_kg") or timeline.get("weekly_delta_kg")
        if raw_weekly is not None:
            weekly_change_kg = float(raw_weekly)
    except (TypeError, ValueError):
        weekly_change_kg = None

    weeks_to_goal = None
    if (
        current_weight_kg is not None
        and target_weight_kg is not None
        and weekly_change_kg is not None
        and weekly_change_kg > 0
    ):
        weeks_to_goal = max(0, round(abs(current_weight_kg - target_weight_kg) / weekly_change_kg))

    first_log = (
        db.query(WeightLog)
        .filter(WeightLog.user_id == current_user.id)
        .order_by(WeightLog.log_date.asc())
        .first()
    )
    total_change_kg = None
    weight_change_label = None
    if first_log and latest_log and first_log.id != latest_log.id:
        total_change_kg = round(latest_log.weight_kg - first_log.weight_kg, 1)
        if total_change_kg > 0:
            weight_change_label = f"+{total_change_kg}kg total"
        elif total_change_kg < 0:
            weight_change_label = f"{total_change_kg}kg total"
        else:
            weight_change_label = "No net change"
    elif first_log and latest_log:
        weight_change_label = "No net change"
        total_change_kg = 0.0

    journey_started_at: str | None = None

    try:
        goal_started_raw = onboarding_json.get("goal_started_at")
        if goal_started_raw:
            date.fromisoformat(str(goal_started_raw)[:10])
            journey_started_at = str(goal_started_raw)[:10]
    except Exception:
        journey_started_at = None

    if not journey_started_at:
        try:
            if first_log and first_log.log_date:
                journey_started_at = str(first_log.log_date)[:10]
        except Exception:
            pass

    if not journey_started_at and current_user.created_at:
        try:
            journey_started_at = current_user.created_at.date().isoformat()
        except Exception:
            pass

    return {
        "current_weight_kg": current_weight_kg,
        "target_weight_kg": target_weight_kg,
        "onboarding_weight_kg": onboarding_weight_kg,
        "weeks_to_goal": weeks_to_goal,
        "weekly_change_kg": weekly_change_kg,
        "daily_delta_kcal": timeline.get("daily_delta_kcal"),
        "exercise_share": timeline.get("exercise_share"),
        "diet_share": timeline.get("diet_share"),
        "exercise_delta_kcal": timeline.get("exercise_delta_kcal"),
        "diet_delta_kcal": timeline.get("diet_delta_kcal"),
        "pace_label": timeline.get("pace_label"),
        "total_change_kg": total_change_kg,
        "weight_change_label": weight_change_label,
        "days_since_weigh_in": days_since_weigh_in,
        "needs_weigh_in": days_since_weigh_in is None or days_since_weigh_in >= 7,
        "journey_started_at": journey_started_at,
        "timeline": {
            **timeline,
            "weeks_to_goal": weeks_to_goal if weeks_to_goal is not None else timeline.get("weeks_to_goal"),
        },
    }
