from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


DEFAULT_LANGUAGE = "en"
_LOCALE_DIR = Path(__file__).resolve().parents[1] / "i18n" / "locales"


def normalize_language_tag(language: str | None) -> str:
    raw = str(language or "").strip().replace("_", "-")
    if not raw:
        return DEFAULT_LANGUAGE
    primary, *rest = raw.split("-")
    if not primary:
        return DEFAULT_LANGUAGE
    return "-".join([primary.lower(), *[part.upper() for part in rest if part]])


def language_label(language: str | None) -> str:
    tag = normalize_language_tag(language)
    labels = {
        "en": "English",
        "hi": "Hindi",
        "hinglish": "Hinglish",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "ta": "Tamil",
        "te": "Telugu",
        "bn": "Bengali",
        "mr": "Marathi",
        "gu": "Gujarati",
        "kn": "Kannada",
        "ml": "Malayalam",
        "pa": "Punjabi",
    }
    return labels.get(tag.lower(), tag)


def ai_language_instruction(language: str | None) -> str:
    tag = normalize_language_tag(language)
    label = language_label(tag)
    return (
        "\n\nLANGUAGE REQUIREMENT:\n"
        f"- Preferred language: {label} ({tag}).\n"
        "- Generate every user-facing natural-language string directly in this language.\n"
        "- Do not add a translation step or bilingual explanation.\n"
        "- Keep JSON keys, enum values, IDs, numeric values, icon names, and machine-readable fields exactly as specified.\n"
        "- Exercise names, food names, meal_type values, muscle names, and category enum values may remain standard catalog/common names when needed for app matching."
    )


@lru_cache(maxsize=16)
def _load_locale(language: str) -> dict[str, Any]:
    tag = normalize_language_tag(language)
    candidates = [tag, tag.split("-", 1)[0], DEFAULT_LANGUAGE]
    for candidate in dict.fromkeys(candidates):
        path = _LOCALE_DIR / f"{candidate}.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _lookup(data: dict[str, Any], key: str) -> str | None:
    current: Any = data
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current if isinstance(current, str) else None


def translate(language: str | None, key: str, values: dict[str, Any] | None = None) -> str:
    tag = normalize_language_tag(language)
    template = _lookup(_load_locale(tag), key) or _lookup(_load_locale(DEFAULT_LANGUAGE), key) or key
    values = values or {}

    def replace(match: re.Match[str]) -> str:
        name = match.group(1).strip()
        return str(values.get(name, ""))

    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", replace, template)
