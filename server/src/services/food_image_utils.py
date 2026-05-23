"""Normalize and compress food photos before vision API calls."""

from __future__ import annotations

import base64
import io
import re

DATA_URI_RE = re.compile(r"^data:(image/[\w.+-]+);base64,(.+)$", re.IGNORECASE | re.DOTALL)

# Groq base64 payloads must stay under ~4MB; keep a safety margin.
MAX_IMAGE_BYTES = 3_500_000
MAX_DIMENSION_PX = 1280


def _detect_mime(data: bytes) -> str | None:
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "image/heic"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _normalize_mime(mime: str | None) -> str:
    cleaned = (mime or "").strip().lower()
    if cleaned in ("image/jpg", "image/jpe", "image/pjpeg"):
        return "image/jpeg"
    if cleaned.startswith("image/"):
        return cleaned
    return "image/jpeg"


def _compress_with_pillow(data: bytes) -> tuple[bytes, str]:
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    width, height = img.size
    longest = max(width, height)
    if longest > MAX_DIMENSION_PX:
        scale = MAX_DIMENSION_PX / float(longest)
        img = img.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)

    for quality in (85, 72, 60):
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        compressed = out.getvalue()
        if len(compressed) <= MAX_IMAGE_BYTES:
            return compressed, "image/jpeg"

    raise ValueError("Image is too large. Please use a smaller photo.")


def prepare_food_image_for_vision(raw_base64: str, mime_hint: str | None = None) -> tuple[str, str]:
    """
    Strip data-URI prefixes, validate base64, convert/compress to JPEG when needed.
    Returns (clean_base64, mime_type).
    """
    payload = (raw_base64 or "").strip()
    if not payload:
        raise ValueError("No image data received.")

    match = DATA_URI_RE.match(payload)
    if match:
        mime_hint = match.group(1)
        payload = match.group(2)

    payload = re.sub(r"\s+", "", payload)
    pad = (-len(payload)) % 4
    if pad:
        payload += "=" * pad

    try:
        data = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise ValueError("Invalid image encoding. Please try another photo.") from exc

    if len(data) < 64:
        raise ValueError("Image file is too small or corrupted.")

    detected = _detect_mime(data)
    mime = _normalize_mime(detected or mime_hint)
    hint = _normalize_mime(mime_hint) if mime_hint else None

    needs_convert = (
        mime in ("image/heic", "image/heif")
        or detected in ("image/heic",)
        or len(data) > MAX_IMAGE_BYTES
        or (detected and hint and detected != hint)
        or mime not in ("image/jpeg", "image/png", "image/webp", "image/gif")
    )

    if needs_convert:
        try:
            data, mime = _compress_with_pillow(data)
        except ImportError as exc:
            if mime in ("image/heic", "image/heif") or detected in ("image/heic",):
                raise ValueError(
                    "HEIC photos are not supported. Please choose JPEG or PNG, or take a new photo."
                ) from exc
            if len(data) > MAX_IMAGE_BYTES:
                raise ValueError("Image is too large. Please use a smaller photo.") from exc
            mime = _normalize_mime(detected or mime)

    clean_b64 = base64.b64encode(data).decode("ascii")
    return clean_b64, mime
