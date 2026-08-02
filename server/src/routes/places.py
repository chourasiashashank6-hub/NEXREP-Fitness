from __future__ import annotations

from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from src.core.config import settings
from src.models.models import User
from src.utils.auth import get_current_user

router = APIRouter(prefix="/api/places", tags=["places"])

GOOGLE_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
GOOGLE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
GYM_KEYWORDS = (
    "gym",
    "fitness",
    "fit",
    "crossfit",
    "health club",
    "training",
    "workout",
    "yoga",
    "pilates",
    "studio",
)


def _places_key() -> str:
    key = (settings.GOOGLE_PLACES_API_KEY or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Google Places API key is not configured")
    return key


def _google_status_error(payload: dict[str, Any]) -> HTTPException | None:
    status = str(payload.get("status") or "")
    if status in {"OK", "ZERO_RESULTS"}:
        return None
    message = str(payload.get("error_message") or status or "Google Places request failed")
    if status == "REQUEST_DENIED":
        return HTTPException(status_code=502, detail=f"Google Places request denied: {message}")
    if status == "OVER_QUERY_LIMIT":
        return HTTPException(status_code=429, detail="Google Places quota exceeded")
    return HTTPException(status_code=502, detail=message)


def _is_gym_like(name: str, types: list[str]) -> bool:
    normalized_name = name.lower()
    normalized_types = {str(item).lower() for item in types}
    if "gym" in normalized_types:
        return True
    return any(keyword in normalized_name for keyword in GYM_KEYWORDS)


def _place_details(place_id: str, key: str) -> dict[str, Any] | None:
    response = requests.get(
        GOOGLE_DETAILS_URL,
        params={
            "place_id": place_id,
            "fields": "place_id,name,formatted_address,geometry,type",
            "key": key,
        },
        timeout=8,
    )
    response.raise_for_status()
    payload = response.json()
    error = _google_status_error(payload)
    if error:
        raise error
    result = payload.get("result") if isinstance(payload, dict) else None
    return result if isinstance(result, dict) else None


@router.get("/gyms/search")
def search_gyms(
    q: str = Query(..., min_length=2, max_length=120),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    limit: int = Query(default=8, ge=1, le=10),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    key = _places_key()
    query = q.strip()
    params: dict[str, Any] = {
        "input": query,
        "types": "establishment",
        "key": key,
    }
    if lat is not None and lng is not None:
        params.update({"location": f"{lat},{lng}", "radius": 25000})

    try:
        response = requests.get(GOOGLE_AUTOCOMPLETE_URL, params=params, timeout=8)
        response.raise_for_status()
        payload = response.json()
        error = _google_status_error(payload)
        if error:
            raise error
        predictions = payload.get("predictions") if isinstance(payload, dict) else []
        items: list[dict[str, Any]] = []
        for prediction in predictions:
            if not isinstance(prediction, dict):
                continue
            place_id = str(prediction.get("place_id") or "").strip()
            if not place_id:
                continue
            details = _place_details(place_id, key)
            if not details:
                continue
            name = str(details.get("name") or prediction.get("structured_formatting", {}).get("main_text") or "").strip()
            types = [str(item) for item in details.get("types") or []]
            if not name or not _is_gym_like(name, types):
                continue
            location = ((details.get("geometry") or {}).get("location") or {}) if isinstance(details.get("geometry"), dict) else {}
            item = {
                "place_id": str(details.get("place_id") or place_id),
                "name": name,
                "formatted_address": str(details.get("formatted_address") or prediction.get("description") or "").strip(),
                "lat": float(location["lat"]) if location.get("lat") is not None else None,
                "lng": float(location["lng"]) if location.get("lng") is not None else None,
            }
            if item["lat"] is not None and item["lng"] is not None:
                items.append(item)
            if len(items) >= limit:
                break
        return {"items": items}
    except HTTPException:
        raise
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Google Places request failed") from exc
