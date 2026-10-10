"""Server consent lease and transport. HTTPS is required outside loopback."""
import json
import math
import re
import urllib.error
import urllib.request
from urllib.parse import urlparse


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # A redirect must never forward a device secret.


class ApiError(Exception):
    def __init__(self, status=None):
        self.status = status
        super().__init__("API request failed" if status is None else f"API request failed ({status})")


class ApiClient:
    def __init__(self, base_url, token, timeout=3):
        parsed = urlparse(base_url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
            raise ValueError("Use HTTPS for the API; HTTP is permitted only on loopback for development")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("API URL must not contain credentials, query, or fragment")
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", token or ""):
            raise ValueError("A registered device bearer token is required")
        self.base, self.token, self.timeout = base_url.rstrip("/"), token, timeout
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, payload=None):
        raw = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        req = urllib.request.Request(self.base+path, data=raw, headers={"Authorization": "Bearer "+self.token, "Content-Type": "application/json"}, method="GET" if raw is None else "POST")
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                raw_response = response.read(100001)
                if len(raw_response) > 100000:
                    raise ApiError()
                return json.loads(raw_response)
        except urllib.error.HTTPError as exc:
            raise ApiError(exc.code) from None
        except (OSError, ValueError, urllib.error.URLError):
            raise ApiError() from None


SETTING_RANGES = {"inactivitySeconds": (30, 86400), "fallDropThreshold": (0.05, 0.8),
                  "fallWindowSeconds": (0.1, 5), "fallConfirmSeconds": (0.3, 10),
                  "minPoseVisibility": (0.4, 1), "eventIntervalSeconds": (1, 300),
                  "maxObservationGapSeconds": (0.1, 2), "walkingSpeed": (0.01, 3),
                  "restingSeconds": (5, 3600), "wanderingSeconds": (30, 86400),
                  "wanderingBodyLengths": (1, 100), "offlineTimeoutSeconds": (30, 3600)}


class ConsentGate:
    def __init__(self):
        self.config = {}; self.expires_at = 0.0

    def update(self, config, now):
        if not isinstance(config, dict) or config.get("cameraState") not in {"running", "paused", "stopped"}:
            raise ValueError("Invalid edge camera configuration")
        residents = config.get("residents")
        if not isinstance(residents, list) or any(not isinstance(r, dict) or not isinstance(r.get("residentId"), str) or
                not isinstance(r.get("cameraConsent"), bool) or not isinstance(r.get("activityConsent"), bool) for r in residents):
            raise ValueError("Invalid consent configuration")
        if len({r["residentId"] for r in residents}) != len(residents):
            raise ValueError("Duplicate resident assignment")
        settings = config.get("settings") or {}
        if not isinstance(settings, dict):
            raise ValueError("Invalid threshold configuration")
        cleaned = {}
        for key, (low, high) in SETTING_RANGES.items():
            if key in settings:
                value = settings[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                    raise ValueError("Invalid threshold: "+key)
                cleaned[key] = value
        if "enabledActivities" in settings:
            if not isinstance(settings["enabledActivities"], list) or any(not isinstance(item, str) for item in settings["enabledActivities"]):
                raise ValueError("Invalid activity selection")
            cleaned["enabledActivities"] = settings["enabledActivities"]
        lease = config.get("configValidForSeconds", 30)
        if isinstance(lease, bool) or not isinstance(lease, (int, float)) or not math.isfinite(lease) or not 1 <= lease <= 30:
            raise ValueError("Invalid consent lease")
        zones = config.get("zones", [])
        if not isinstance(zones, list):
            raise ValueError("Invalid zone configuration")
        for zone in zones:
            if not isinstance(zone, dict) or not isinstance(zone.get("name"), str) or "zoneId" not in zone:
                raise ValueError("Invalid zone")
            polygon = zone.get("polygon")
            if not isinstance(polygon, list) or not 3 <= len(polygon) <= 64 or any(not isinstance(p, list) or len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in polygon):
                raise ValueError("Invalid normalized polygon")
        self.config = {**config, "settings": cleaned, "zones": zones}
        self.expires_at = now+lease

    def invalidate(self):
        self.expires_at = 0

    def fresh(self, now):
        return now < self.expires_at

    def consented(self):
        return [r["residentId"] for r in self.config.get("residents", []) if r["cameraConsent"] and r["activityConsent"]]

    def can_capture(self, now):
        residents = self.config.get("residents", [])
        return (self.fresh(now) and self.config.get("enabled") is True and self.config.get("cameraState") == "running"
                and bool(residents) and len(self.consented()) == len(residents))
