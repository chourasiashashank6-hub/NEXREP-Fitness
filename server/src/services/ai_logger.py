from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from src.core.ai_pricing import calculate_cost
from src.db.session import SessionLocal
from src.models.admin_models import AiUsageLog


def _write_log(
    *,
    db: Session | None,
    user_id: Optional[int],
    feature: str,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    endpoint: str | None,
    is_fallback: bool,
    success: bool,
    meal_slot: str | None = None,
    counts_toward_scan_quota: bool = False,
) -> None:
    cost_usd, cost_inr = calculate_cost(model, prompt_tokens, completion_tokens)
    own_session = db is None
    session = db if db is not None else SessionLocal()
    try:
        log = AiUsageLog(
            user_id=user_id,
            feature=feature,
            provider=provider,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
            cost_inr=cost_inr,
            success=success,
            is_fallback=is_fallback,
            endpoint=endpoint,
            meal_slot=meal_slot,
            counts_toward_scan_quota=counts_toward_scan_quota,
        )
        session.add(log)
        session.commit()
    finally:
        if own_session:
            session.close()


def log_groq_call(
    *,
    db: Session | None = None,
    user_id: Optional[int] = None,
    feature: str,
    model: str,
    endpoint: str,
    response_json: dict[str, Any],
    is_fallback: bool = False,
    success: bool = True,
    meal_slot: str | None = None,
    counts_toward_scan_quota: bool = False,
) -> None:
    usage = response_json.get("usage", {}) or {}
    prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
    completion_tokens = int(usage.get("completion_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", prompt_tokens + completion_tokens) or 0)
    _write_log(
        db=db,
        user_id=user_id,
        feature=feature,
        provider="groq",
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        endpoint=endpoint,
        is_fallback=is_fallback,
        success=success,
        meal_slot=meal_slot,
        counts_toward_scan_quota=counts_toward_scan_quota,
    )


def log_gemini_call(
    *,
    db: Session | None = None,
    user_id: Optional[int] = None,
    feature: str,
    model: str,
    endpoint: str,
    response_json: dict[str, Any],
    is_fallback: bool = False,
    success: bool = True,
    meal_slot: str | None = None,
    counts_toward_scan_quota: bool = False,
) -> None:
    usage = response_json.get("usageMetadata", {}) or {}
    prompt_tokens = int(usage.get("promptTokenCount", 0) or 0)
    completion_tokens = int(usage.get("candidatesTokenCount", 0) or 0)
    total_tokens = int(usage.get("totalTokenCount", prompt_tokens + completion_tokens) or 0)
    _write_log(
        db=db,
        user_id=user_id,
        feature=feature,
        provider="gemini",
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        endpoint=endpoint,
        is_fallback=is_fallback,
        success=success,
        meal_slot=meal_slot,
        counts_toward_scan_quota=counts_toward_scan_quota,
    )


def log_openai_call(
    *,
    db: Session | None = None,
    user_id: Optional[int] = None,
    feature: str,
    model: str,
    endpoint: str,
    response_json: dict[str, Any],
    is_fallback: bool = False,
    success: bool = True,
    meal_slot: str | None = None,
    counts_toward_scan_quota: bool = False,
) -> None:
    usage = response_json.get("usage", {}) or {}
    prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
    completion_tokens = int(usage.get("completion_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", prompt_tokens + completion_tokens) or 0)
    _write_log(
        db=db,
        user_id=user_id,
        feature=feature,
        provider="openai",
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        endpoint=endpoint,
        is_fallback=is_fallback,
        success=success,
        meal_slot=meal_slot,
        counts_toward_scan_quota=counts_toward_scan_quota,
    )


def log_provider_failure(
    *,
    db: Session | None = None,
    user_id: Optional[int] = None,
    feature: str,
    provider: str,
    model: str,
    endpoint: str,
    is_fallback: bool = False,
    meal_slot: str | None = None,
) -> None:
    _write_log(
        db=db,
        user_id=user_id,
        feature=feature,
        provider=provider,
        model=model,
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        endpoint=endpoint,
        is_fallback=is_fallback,
        success=False,
        meal_slot=meal_slot,
        counts_toward_scan_quota=False,
    )


def log_scan_quota_attempt(
    *,
    db: Session | None = None,
    user_id: Optional[int] = None,
    meal_slot: str | None = None,
) -> None:
    """One user-facing food scan attempt — counts toward daily/per-meal quota."""
    _write_log(
        db=db,
        user_id=user_id,
        feature="food_photo_analysis",
        provider="quota",
        model="scan_attempt",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        endpoint="/api/calories/foods/analyze-image",
        is_fallback=False,
        success=True,
        meal_slot=meal_slot,
        counts_toward_scan_quota=True,
    )
