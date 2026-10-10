"""Offline-testable extraction and input checks. Scores are unvalidated heuristics."""
import base64
import binascii
import io
import math
import re
from PIL import Image

def normalize_medication(value):
    if not isinstance(value, dict):
        return None
    name = value.get("drugName") or value.get("drug_name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 160:
        return None
    def field(key, default):
        result = value.get(key)
        return result.strip() if isinstance(result, str) and result.strip() else default
    frequency = field("frequency", "Needs Review")
    schedule = re.fullmatch(r"(\d+(?:\.\d+)?|\.\d+)\s*-\s*(\d+(?:\.\d+)?|\.\d+)\s*-\s*(\d+(?:\.\d+)?|\.\d+)", frequency)
    if schedule:
        periods = ["in the morning", "in the afternoon", "at night"]
        frequency = ", ".join(f"{count} {period}" for count, period in zip(schedule.groups(), periods) if float(count) != 0) or "Needs Review"
    dosage = field("dosage", "Needs Review")
    dosage = re.sub(r"^\.(?=\d)", "0.", dosage)
    reported = value.get("confidence")
    reported = reported if isinstance(reported, (int, float)) and not isinstance(reported, bool) and math.isfinite(reported) and 0 <= reported <= 1 else None
    result = {"drugName": name.strip(), "dosage": dosage, "frequency": frequency,
              "duration": field("duration", "As directed"), "instructions": field("instructions", "Follow doctor guidance"),
              "route": field("route", ""), "confidence": min(0.5, reported) if reported is not None else 0.5,
              "confidenceKind": "unvalidated-heuristic", "needsReview": True,
              "reviewReasons": ["Donut extraction has no calibrated confidence; verify every field against the image."], "source": "donut"}
    if reported is not None:
        result["reportedConfidence"] = reported
    return result

def normalize_medications(values):
    if not isinstance(values, list):
        return []
    result, seen = [], set()
    for value in values:
        medication = normalize_medication(value)
        if medication is None:
            continue
        key = tuple(medication[k].lower() for k in ["drugName", "dosage", "frequency", "duration", "instructions", "route"])
        if key not in seen:
            seen.add(key)
            result.append(medication)
    return result

def decode_image_base64(value, max_bytes):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Image base64 data is required.")
    if value.startswith("data:"):
        match = re.fullmatch(r"data:image/(?:jpeg|png|webp|bmp);base64,([A-Za-z0-9+/=]+)", value)
        if not match:
            raise ValueError("Unsupported image data URL.")
        value = match.group(1)
    if len(value) > 4 * ((max_bytes + 2) // 3):
        raise ValueError("Image exceeds the byte limit.")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid base64 image.") from error
    if not data or len(data) > max_bytes:
        raise ValueError("Image exceeds the byte limit.")
    return data

def load_image_bytes(data, max_bytes, max_pixels):
    if not isinstance(data, bytes) or not data or len(data) > max_bytes:
        raise ValueError("Image exceeds the byte limit or is empty.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP", "BMP"}:
                raise ValueError("Unsupported image format.")
            if image.width <= 0 or image.height <= 0 or image.width * image.height > max_pixels:
                raise ValueError("Image exceeds the pixel limit.")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            return image.convert("RGB")
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("Image exceeds the pixel limit.") from error
    except Exception as error:
        if isinstance(error, ValueError):
            raise
        raise ValueError("Image could not be decoded.") from error
