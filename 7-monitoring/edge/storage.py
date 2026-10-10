"""Persistent idempotent event queue. Never accepts raw visual evidence."""
import json
import math
import re
import sqlite3
import time
from pathlib import Path

FORBIDDEN = re.compile(r"image|frame|snapshot|base64|data.?url|video|photo", re.I)
MEDIA_VALUE = re.compile(r"(?:data:|blob:|https?://|rtsps?://|file://|/9j/|iVBORw0KGgo|R0lGOD|UklGR)", re.I)


def validate_private(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if FORBIDDEN.search(str(key)):
                raise ValueError("Raw visual evidence is prohibited")
            validate_private(item)
    elif isinstance(value, list):
        for item in value:
            validate_private(item)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Non-finite measurements are prohibited")
    elif isinstance(value, str) and MEDIA_VALUE.search(value):
        raise ValueError("Media encodings and external media references are prohibited")


class EventQueue:
    def __init__(self, path, retention_seconds=86400, capacity=10000):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA secure_delete=ON")
        self.db.execute("CREATE TABLE IF NOT EXISTS pending (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0)")
        self.retention, self.capacity = retention_seconds, capacity
        self.db.commit()

    def enqueue(self, payload, now=None):
        validate_private(payload)
        now = time.time() if now is None else now
        encoded = json.dumps(payload, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode()) > 12000:
            raise ValueError("Event exceeds privacy-safe evidence limit")
        self.prune(now)
        existing = self.db.execute("SELECT payload FROM pending WHERE request_id=?", (payload["requestId"],)).fetchone()
        if existing:
            if existing[0] != encoded:
                raise ValueError("A retry request ID must retain exactly the original payload")
            return
        if self.depth() >= self.capacity:
            raise OverflowError("Offline queue capacity reached; event cannot be retained")
        self.db.execute("INSERT INTO pending(request_id,payload,created_at) VALUES(?,?,?)", (payload["requestId"], encoded, now))
        self.db.commit()

    def due(self, now=None, limit=5):
        now = time.time() if now is None else now
        self.prune(now)
        return [(key, json.loads(payload), attempts) for key, payload, attempts in self.db.execute(
            "SELECT request_id,payload,attempts FROM pending WHERE next_at <= ? ORDER BY created_at LIMIT ?", (now, limit))]

    def retry(self, key, attempts, now=None):
        now = time.time() if now is None else now
        self.db.execute("UPDATE pending SET attempts=?,next_at=? WHERE request_id=?", (attempts+1, now+min(300, 2**min(attempts+1, 9)), key))
        self.db.commit()

    def acknowledge(self, key):
        self.db.execute("DELETE FROM pending WHERE request_id=?", (key,)); self.db.commit()

    def prune(self, now=None):
        now = time.time() if now is None else now
        self.db.execute("DELETE FROM pending WHERE created_at < ?", (now-self.retention,)); self.db.commit()

    def retain_residents(self, residents, allow_anonymous=False):
        allowed = set(residents)
        for key, payload in self.db.execute("SELECT request_id,payload FROM pending").fetchall():
            resident = json.loads(payload).get("residentId")
            if resident not in allowed and not (resident is None and allow_anonymous):
                self.db.execute("DELETE FROM pending WHERE request_id=?", (key,))
        self.db.commit()

    def depth(self):
        return self.db.execute("SELECT COUNT(*) FROM pending").fetchone()[0]

    def close(self):
        self.db.close()
