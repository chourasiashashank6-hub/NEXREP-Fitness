"""Food photo scan rate limits — enforced before any LLM call."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.models.admin_models import AiUsageLog
from src.models.models import User, UserOnboarding
from src.services.meal_planner_service import _meal_slots_for_count
from src.utils.app_time import infer_meal_type_ist, ist_day_window, next_midnight_ist

FEATURE = "food_photo_analysis"
THROTTLE_WINDOW = timedelta(minutes=5)
THROTTLE_CAP = 8

FREE_DAILY_CAP = 4
PRO_PER_MEAL_CAP = 2
ELITE_PER_MEAL_CAP = 3

# STOPGAP — remove when all clients send meal_type on food scans.
# Pro/Elite requests without meal_type use a flat IST-day cap equal to the tier's
# per-meal limit (Pro=2, Elite=3), counting all successful scans that day.
LEGACY_NO_MEAL_TYPE_DAILY_CAP = {
    "pro": PRO_PER_MEAL_CAP,
    "elite": ELITE_PER_MEAL_CAP,
}


@dataclass(frozen=True)
class ScanLimitState:
    tier: str
    cap: int
    used: int
    remaining: int
    meal_type: str | None
    meals_per_day: int | None
    resets_at: datetime
    limit_type: str  # daily | meal_slot | throttle

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": "FOOD_SCAN_LIMIT",
            "limit_type": self.limit_type,
            "tier": self.tier,
            "cap": self.cap,
            "used": self.used,
            "remaining": self.remaining,
            "meal_type": self.meal_type,
            "meals_per_day": self.meals_per_day,
            "resets_at": self.resets_at.isoformat(),
        }


def normalize_tier(plan_id: str | None) -> str:
    tier = (plan_id or "free").strip().lower()
    if tier not in {"free", "pro", "elite"}:
        return "free"
    return tier


def per_meal_cap(tier: str) -> int:
    if tier == "elite":
        return ELITE_PER_MEAL_CAP
    if tier == "pro":
        return PRO_PER_MEAL_CAP
    return FREE_DAILY_CAP


def meals_per_day_for_user(db: Session, user_id: int) -> int:
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == user_id).first()
    onboarding = row.onboarding_json if row and isinstance(row.onboarding_json, dict) else {}
    dietary = onboarding.get("dietary") if isinstance(onboarding.get("dietary"), dict) else {}
    mpd = int(dietary.get("meals_per_day") or 3)
    return max(2, min(6, mpd))


def _window_bounds() -> tuple[datetime, datetime]:
    start, end = ist_day_window()
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _count_scans(
    db: Session,
    user_id: int,
    *,
    since: datetime,
    until: datetime | None = None,
    meal_slot: str | None = None,
    require_meal_slot: bool = False,
    only_null_meal_slot: bool = False,
) -> int:
    q = db.query(func.count(AiUsageLog.id)).filter(
        AiUsageLog.user_id == user_id,
        AiUsageLog.feature == FEATURE,
        AiUsageLog.counts_toward_scan_quota.is_(True),
        AiUsageLog.created_at >= since,
    )
    if until is not None:
        q = q.filter(AiUsageLog.created_at < until)
    if meal_slot is not None:
        q = q.filter(AiUsageLog.meal_slot == meal_slot)
    if require_meal_slot:
        q = q.filter(AiUsageLog.meal_slot.isnot(None))
    if only_null_meal_slot:
        q = q.filter(AiUsageLog.meal_slot.is_(None))
    return int(q.scalar() or 0)


def resolve_meal_type(meal_type: str | None) -> str:
    cleaned = (meal_type or "").strip()
    return cleaned or infer_meal_type_ist()


@dataclass
class FoodScanAttempt:
    """Tracks one user-facing food scan request across provider fallbacks."""

    meal_slot: str | None
    quota_recorded: bool = False

    def record_if_first_provider(self, db: Session, user_id: int | None) -> None:
        if self.quota_recorded or user_id is None:
            return
        from src.services.ai_logger import log_scan_quota_attempt

        log_scan_quota_attempt(db=db, user_id=user_id, meal_slot=self.meal_slot)
        self.quota_recorded = True


def _count_recent_throttle(db: Session, user_id: int, now_utc: datetime) -> int:
    since = now_utc - THROTTLE_WINDOW
    return _count_scans(db, user_id, since=since)


def _throttle_resets_at(db: Session, user_id: int, now_utc: datetime) -> datetime:
    """When the oldest scan in the rolling window expires (next allowed attempt)."""
    since = now_utc - THROTTLE_WINDOW
    oldest = (
        db.query(func.min(AiUsageLog.created_at))
        .filter(
            AiUsageLog.user_id == user_id,
            AiUsageLog.feature == FEATURE,
            AiUsageLog.counts_toward_scan_quota.is_(True),
            AiUsageLog.created_at >= since,
        )
        .scalar()
    )
    if oldest is None:
        return now_utc
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    return oldest + THROTTLE_WINDOW


def _throttle_usage(db: Session, user_id: int, now_utc: datetime) -> dict[str, Any]:
    used = _count_recent_throttle(db, user_id, now_utc)
    return {
        "cap": THROTTLE_CAP,
        "used": used,
        "remaining": max(0, THROTTLE_CAP - used),
        "resets_at": _throttle_resets_at(db, user_id, now_utc).isoformat(),
    }


def build_scan_usage(
    db: Session,
    user: User,
    *,
    meal_type: str | None = None,
) -> dict[str, Any]:
    tier = normalize_tier(user.plan_id)
    resets_at = next_midnight_ist()
    now_utc = datetime.now(timezone.utc)
    day_start, day_end = _window_bounds()
    mpd = meals_per_day_for_user(db, user.id)
    throttle = _throttle_usage(db, user.id, now_utc)

    if tier == "free":
        used = _count_scans(db, user.id, since=day_start, until=day_end)
        cap = FREE_DAILY_CAP
        remaining = max(0, cap - used)
        remaining = min(remaining, throttle["remaining"])  # free tier only
        return {
            "tier": tier,
            "meals_per_day": mpd,
            "meal_type": None,
            "cap": cap,
            "used": used,
            "remaining": remaining,
            "resets_at": resets_at.isoformat(),
            "slots": None,
            "throttle": throttle,
        }

    cap = per_meal_cap(tier)
    slots = _meal_slots_for_count(mpd)
    slot_stats: list[dict[str, Any]] = []
    for slot in slots:
        used = _count_scans(
            db,
            user.id,
            since=day_start,
            until=day_end,
            meal_slot=slot,
            require_meal_slot=True,
        )
        slot_stats.append(
            {
                "meal_type": slot,
                "cap": cap,
                "used": used,
                "remaining": max(0, cap - used),
            }
        )

    active = meal_type if meal_type in slots else (meal_type or slots[0] if slots else None)
    active_row = next((s for s in slot_stats if s["meal_type"] == active), slot_stats[0] if slot_stats else None)
    slot_remaining = active_row["remaining"] if active_row else cap
    return {
        "tier": tier,
        "meals_per_day": mpd,
        "meal_type": active_row["meal_type"] if active_row else active,
        "cap": active_row["cap"] if active_row else cap,
        "used": active_row["used"] if active_row else 0,
        "remaining": slot_remaining,
        "resets_at": resets_at.isoformat(),
        "slots": slot_stats,
        "throttle": throttle,
    }


def enforce_food_scan_limits(
    db: Session,
    user: User,
    *,
    meal_type: str | None,
) -> None:
    tier = normalize_tier(user.plan_id)
    resets_at = next_midnight_ist()
    now_utc = datetime.now(timezone.utc)
    day_start, day_end = _window_bounds()

    meal_type = resolve_meal_type(meal_type)

    if tier == "free":
        throttle_used = _count_recent_throttle(db, user.id, now_utc)
        if throttle_used >= THROTTLE_CAP:
            raise HTTPException(
                status_code=429,
                detail=ScanLimitState(
                    tier=tier,
                    cap=THROTTLE_CAP,
                    used=throttle_used,
                    remaining=0,
                    meal_type=meal_type,
                    meals_per_day=meals_per_day_for_user(db, user.id),
                    resets_at=_throttle_resets_at(db, user.id, now_utc),
                    limit_type="throttle",
                ).as_dict(),
            )

    if tier == "free":
        used = _count_scans(db, user.id, since=day_start, until=day_end)
        cap = FREE_DAILY_CAP
        if used >= cap:
            raise HTTPException(
                status_code=429,
                detail=ScanLimitState(
                    tier=tier,
                    cap=cap,
                    used=used,
                    remaining=0,
                    meal_type=None,
                    meals_per_day=meals_per_day_for_user(db, user.id),
                    resets_at=resets_at,
                    limit_type="daily",
                ).as_dict(),
            )
        return

    meal_slot = meal_type
    cap = per_meal_cap(tier)
    used = _count_scans(
        db,
        user.id,
        since=day_start,
        until=day_end,
        meal_slot=meal_slot,
        require_meal_slot=True,
    )
    if used >= cap:
        raise HTTPException(
            status_code=429,
            detail=ScanLimitState(
                tier=tier,
                cap=cap,
                used=used,
                remaining=0,
                meal_type=meal_slot,
                meals_per_day=meals_per_day_for_user(db, user.id),
                resets_at=resets_at,
                limit_type="meal_slot",
            ).as_dict(),
        )
