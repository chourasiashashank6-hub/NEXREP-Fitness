from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.core.config import settings
from src.models.models import User, UserOnboarding
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry, WaterIntakeLog
from src.schemas.calories_api import (
    DailyLogEnsureRequest,
    AIFoodMealCreateRequest,
    FoodImageAnalyzeRequest,
    FoodLookupRequest,
    MealCreateRequest,
    MealUpdateRequest,
    WaterPatchRequest,
)
from src.services.food_catalog_service import lookup_food_scaled, search_foods
from src.utils.auth import get_current_user

router = APIRouter()

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


def _fallback_coach(day_payload: dict[str, Any]) -> dict[str, Any]:
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    c = _num(log.get("total_calories"))
    t = _num(log.get("target_calories"))
    p = _num(log.get("total_protein_g"))
    pt = _num(log.get("target_protein_g"))
    carbs = _num(log.get("total_carbs_g"))
    fat = _num(log.get("total_fat_g"))
    water_ml = int(round(_num(water.get("total_water_l")) * 1000))
    remaining = int(round(t - c))
    meals = len(day_payload.get("meals") or [])

    alerts: list[dict[str, str]] = []
    if water_ml < 600:
        alerts.append({"type": "critical", "icon": "💧", "title": "Hydration low", "subtitle": "Drink water now"})
    elif water_ml < 1200:
        alerts.append({"type": "warning", "icon": "💧", "title": "Low hydration", "subtitle": "Increase water intake"})
    else:
        alerts.append({"type": "success", "icon": "💧", "title": "Water good", "subtitle": "Hydration on track"})

    if pt > 0 and p < pt * 0.7:
        alerts.append({"type": "critical", "icon": "🥩", "title": "Protein gap", "subtitle": "Add lean protein"})
    else:
        alerts.append({"type": "info", "icon": "🥗", "title": "Macros tracked", "subtitle": "Keep balanced meals"})

    if remaining < -200:
        alerts.append({"type": "critical", "icon": "⚠️", "title": "Over target", "subtitle": "Keep meals very light"})
    elif remaining < 0:
        alerts.append({"type": "warning", "icon": "⚖️", "title": "Near limit", "subtitle": "Prefer low-cal foods"})
    else:
        alerts.append({"type": "success", "icon": "✅", "title": "Calories OK", "subtitle": f"{remaining} kcal left"})

    if meals == 0:
        alerts.append({"type": "info", "icon": "📝", "title": "No meals logged", "subtitle": "Start with first meal"})
    else:
        alerts.append({"type": "success", "icon": "🧾", "title": "Logs updated", "subtitle": f"{meals} meal(s) recorded"})

    insight = (
        f"You have consumed {int(round(c))} kcal so far with {int(round(remaining))} kcal remaining. "
        f"Protein is {int(round(p))}g, carbs {int(round(carbs))}g, fat {int(round(fat))}g. "
        "Prioritize high-protein, high-fiber, low-calorie choices for remaining meals and keep hydration steady."
    )
    return {"insight": insight, "alerts": alerts[:4], "source": "fallback"}


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Fallback: find the first balanced JSON object to survive model outputs like:
    #   { ... }\n\nExtra notes...
    # or multiple JSON blobs back-to-back.
    start = text.find("{")
    if start >= 0:
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
                    parsed = json.loads(candidate)
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


def _groq_food_image_analysis(base64: str, mime_type: str | None) -> dict[str, Any]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing on server")
    # Use a vision-capable model explicitly. settings.GROQ_MODEL may point to text-only models
    # (used elsewhere for coach text generation), which reject multimodal `content` arrays.
    model_name = "meta-llama/llama-4-scout-17b-16e-instruct"
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
    req = Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(
            {
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
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Accept": "application/json",
            "User-Agent": "fitness-food-analyzer/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        if e.code == 400 and "messages[1].content must be a string" in body:
            raise RuntimeError(
                "The configured Groq model is text-only for this account. "
                "Use a vision-capable Groq model/key for food image analysis."
            ) from e
        if e.code == 429:
            raise RuntimeError("Too many requests, try again in a moment.") from e
        raise RuntimeError(f"Groq HTTP {e.code}: {body[:260]}") from e
    except URLError as e:
        raise RuntimeError(f"Groq network error: {e.reason}") from e

    raw = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not raw:
        raise RuntimeError("Groq returned empty content")
    parsed = _extract_json_object(raw)
    return _normalize_food_analysis_payload(parsed)


def _gemini_food_image_analysis(base64: str, mime_type: str | None) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing on server")
    image_mime = (mime_type or "image/jpeg").strip() or "image/jpeg"
    model_candidates = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-2.0-flash",
    ]
    last_err: str | None = None
    payload: dict[str, Any] | None = None
    for model_name in model_candidates:
        req = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?"
            + urlencode({"key": settings.GEMINI_API_KEY}),
            data=json.dumps(
                {
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
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=40) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                break
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            if e.code == 404 and ("not found" in body.lower() or "not supported" in body.lower()):
                last_err = f"{model_name}: unavailable"
                continue
            raise RuntimeError(f"Gemini HTTP {e.code}: {body[:260]}") from e
        except URLError as e:
            raise RuntimeError(f"Gemini network error: {e.reason}") from e

    if payload is None:
        raise RuntimeError(f"No compatible Gemini model available. Last tried: {last_err or 'unknown'}")
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


def _gemini_coach(db: Session, day_payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing on server")

    now_local = datetime.now().strftime("%I:%M %p")
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    meals = day_payload.get("meals") or []

    dataset_rows: list[dict[str, Any]] = []
    # Include reference rows from normalized food catalog for realistic suggestions.
    try:
        refs = (
            db.execute(
                text(
                    """
                    SELECT food_name, calories_per_100g, protein_g, carbs_g, fat_g
                    FROM food_items
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

    # Also include today's actually logged meals for personalization.
    for m in meals[:15]:
        dataset_rows.append(
            {
                "food": m.get("food_name"),
                "cal_per_100g": m.get("calories_per_100g"),
                "protein_per_100g": m.get("protein_per_100g"),
                "carbs_per_100g": m.get("carbs_per_100g"),
                "fat_per_100g": m.get("fat_per_100g"),
            }
        )

    system_prompt = (
        "You are an expert nutrition coach inside a calorie tracker app. "
        "Return ONLY valid JSON object with keys: insight and alerts. "
        "Insight must be concise and fit in max 4 short lines on a mobile card. "
        "Use 2-4 short plain-language sentences that still include: calorie status, macros, hydration, and next best action. "
        "Also include body-impact health factors in the insight, such as likely effects on energy, recovery, digestion, hydration, or muscle retention based on today's intake. "
        "Mention these effects carefully and practically (no fear language, no medical diagnosis). "
        "Mention concrete, realistic foods and quantities where useful. "
        "No markdown, no bullets, no headings, no emojis in insight. "
        "alerts must be exactly 4 items with keys: type/icon/title/subtitle."
    )
    user_msg = {
        "time_of_day": now_local,
        "consumed_calories": log.get("total_calories", 0),
        "daily_goal": log.get("target_calories", 0),
        "remaining_calories": (log.get("target_calories", 0) or 0) - (log.get("total_calories", 0) or 0),
        "protein_g": log.get("total_protein_g", 0),
        "carbs_g": log.get("total_carbs_g", 0),
        "fat_g": log.get("total_fat_g", 0),
        "water_ml": int(round((_num(water.get("total_water_l"))) * 1000)),
        "meals_logged": len(meals),
        "food_dataset_reference": dataset_rows,
        "rules": [
            "If remaining_calories <= 0 suggest stopping intake or very light options.",
            "If no meals logged, suggest a full-day plan.",
            "Use approximate quantities."
        ],
    }

    prompt_text = (
        f"{system_prompt}\n\n"
        "Return only JSON object with keys insight and alerts.\n\n"
        f"DATA:\n{json.dumps(user_msg)}"
    )

    model_candidates = [
        settings.GEMINI_MODEL.strip() if settings.GEMINI_MODEL else "",
        "gemini-2.0-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash",
    ]
    model_candidates = [m for i, m in enumerate(model_candidates) if m and m not in model_candidates[:i]]

    payload: dict[str, Any] | None = None
    last_err: str | None = None
    for model_name in model_candidates:
        req = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?"
            + urlencode({"key": settings.GEMINI_API_KEY}),
            data=json.dumps(
                {
                    "contents": [{"parts": [{"text": prompt_text}]}],
                    "generationConfig": {
                        "temperature": 0.3,
                        "responseMimeType": "application/json",
                        "maxOutputTokens": 500,
                    },
                }
            ).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                break
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            # Try next model if provider says model not found/unsupported.
            if e.code == 404 and ("not found" in body.lower() or "not supported" in body.lower()):
                last_err = f"{model_name}: not available"
                continue
            raise RuntimeError(f"Gemini HTTP {e.code}: {body[:260]}") from e
        except URLError as e:
            raise RuntimeError(f"Gemini network error: {e.reason}") from e

    if payload is None:
        raise RuntimeError(f"No compatible Gemini model available. Last tried: {last_err or 'unknown'}")

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
    alerts = parsed.get("alerts") if isinstance(parsed, dict) else None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("insight"), str) or not isinstance(alerts, list):
        raise RuntimeError("Gemini invalid JSON shape")
    return {"insight": _normalize_insight_text(parsed["insight"]), "alerts": alerts[:4], "source": "gemini"}


def _groq_coach(db: Session, day_payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing on server")

    now_local = datetime.now().strftime("%I:%M %p")
    log = day_payload.get("log", {})
    water = day_payload.get("water", {})
    meals = day_payload.get("meals") or []

    dataset_rows: list[dict[str, Any]] = []
    try:
        refs = (
            db.execute(
                text(
                    """
                    SELECT food_name, calories_per_100g, protein_g, carbs_g, fat_g
                    FROM food_items
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
        dataset_rows.append(
            {
                "food": m.get("food_name"),
                "cal_per_100g": m.get("calories_per_100g"),
                "protein_per_100g": m.get("protein_per_100g"),
                "carbs_per_100g": m.get("carbs_per_100g"),
                "fat_per_100g": m.get("fat_per_100g"),
            }
        )

    system_prompt = (
        "You are an expert nutrition coach inside a calorie tracker app. "
        "Return ONLY valid JSON object with keys: insight and alerts. "
        "Insight must be concise and fit in max 4 short lines on a mobile card. "
        "Use 2-4 short plain-language sentences that still include: calorie status, macros, hydration, and next best action. "
        "Also include body-impact health factors in the insight, such as likely effects on energy, recovery, digestion, hydration, or muscle retention based on today's intake. "
        "Mention these effects carefully and practically (no fear language, no medical diagnosis). "
        "Mention concrete, realistic foods and quantities from the provided dataset. "
        "No markdown, no bullets, no headings, no emojis in insight. "
        "alerts must be exactly 4 items with keys: type/icon/title/subtitle."
    )
    user_msg = {
        "time_of_day": now_local,
        "consumed_calories": log.get("total_calories", 0),
        "daily_goal": log.get("target_calories", 0),
        "remaining_calories": (log.get("target_calories", 0) or 0) - (log.get("total_calories", 0) or 0),
        "protein_g": log.get("total_protein_g", 0),
        "carbs_g": log.get("total_carbs_g", 0),
        "fat_g": log.get("total_fat_g", 0),
        "water_ml": int(round((_num(water.get("total_water_l"))) * 1000)),
        "meals_logged": len(meals),
        "food_dataset_reference": dataset_rows,
        "rules": [
            "If remaining_calories <= 0 suggest stopping intake or very light options.",
            "If no meals logged, suggest a full-day plan.",
            "Use approximate quantities.",
        ],
    }

    model_candidates = [
        settings.GROQ_MODEL.strip() if settings.GROQ_MODEL else "",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
    ]
    model_candidates = [m for i, m in enumerate(model_candidates) if m and m not in model_candidates[:i]]

    payload: dict[str, Any] | None = None
    last_err: str | None = None
    for model_name in model_candidates:
        req = Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=json.dumps(
                {
                    "model": model_name,
                    "temperature": 0.3,
                    "max_tokens": 220,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": json.dumps(user_msg)},
                    ],
                }
            ).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Accept": "application/json",
                "User-Agent": "fitness-ai-coach/1.0",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                break
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            lower = body.lower()
            # Model decommissioned/unsupported -> try next candidate.
            if e.code in (400, 404) and (
                "decommissioned" in lower
                or "no longer supported" in lower
                or "model_not_found" in lower
                or "not found" in lower
            ):
                last_err = f"{model_name}: unavailable"
                continue
            raise RuntimeError(f"Groq HTTP {e.code}: {body[:260]}") from e
        except URLError as e:
            raise RuntimeError(f"Groq network error: {e.reason}") from e

    if payload is None:
        raise RuntimeError(f"No compatible Groq model available. Last tried: {last_err or 'unknown'}")

    raw = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not raw:
        raise RuntimeError("Groq returned empty content")
    clean = raw.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(clean)
    alerts = parsed.get("alerts") if isinstance(parsed, dict) else None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("insight"), str) or not isinstance(alerts, list):
        raise RuntimeError("Groq invalid JSON shape")
    return {"insight": _normalize_insight_text(parsed["insight"]), "alerts": alerts[:4], "source": "groq"}


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
        # Missing table, wrong schema, or aborted transaction — fall back to onboarding / defaults.
        db.rollback()

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
    log = (
        db.query(DailyNutritionLog)
        .filter(DailyNutritionLog.user_id == user.id, DailyNutritionLog.log_date == log_date)
        .first()
    )
    t = resolve_user_targets(db, user)
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


@router.post("/daily-log")
def ensure_daily_log(
    payload: DailyLogEnsureRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_date = _parse_log_date(payload.date if payload else None)
    return _serialize_day(db, current_user, log_date)


@router.get("/daily-log/{log_date}")
def get_daily_log(log_date: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = _parse_log_date(log_date)
    return _serialize_day(db, current_user, d)


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

    source_type = payload.source_type if payload.source_type in {"database", "camera_ai"} else "database"

    entry = MealEntry(
        log_id=log.log_id,
        user_id=current_user.id,
        meal_type=payload.meal_type,
        source_type=source_type,
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = current_user
    items = search_foods(db, q, limit)
    return {"items": items}


@router.post("/foods/lookup")
def lookup_food_nutrition(
    payload: FoodLookupRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = current_user
    if payload.food_id is None and not (payload.food_name or "").strip():
        raise HTTPException(status_code=422, detail="Provide food_id or food_name.")
    found = lookup_food_scaled(
        db,
        food_id=payload.food_id,
        food_name=payload.food_name,
        quantity_g=payload.quantity_g,
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
        return _groq_food_image_analysis(payload.base64, payload.mime_type)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except RuntimeError as e:
        groq_error = str(e)
        try:
            return _gemini_food_image_analysis(payload.base64, payload.mime_type)
        except Exception as ge:
            raise HTTPException(
                status_code=502,
                detail=f"Food image analysis failed: {groq_error} | Gemini fallback failed: {str(ge)}",
            ) from ge


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    day_payload = _serialize_day(db, current_user, today)
    try:
        return _groq_coach(db, day_payload)
    except Exception as e:
        err = str(e)
        # Groq can be blocked by Cloudflare policy (HTTP 403 / code 1010) in some regions/networks.
        # In that case, transparently fallback to Gemini so the user still gets insights.
        if "Groq HTTP 403" in err or "error code: 1010" in err:
            try:
                return _gemini_coach(db, day_payload)
            except Exception as ge:
                raise HTTPException(
                    status_code=502,
                    detail=f"AI insight generation failed: Groq blocked ({err}) | Gemini failed: {str(ge)}",
                ) from ge
        raise HTTPException(status_code=502, detail=f"AI insight generation failed: {err}") from e
