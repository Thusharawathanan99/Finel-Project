"""Pose-derived temporal rules. Scores are rule strength, NOT clinical probability.

No facial identity, pixels, or image encodings enter this module. Coordinates are
normalized; callers must scale x by camera aspect ratio before measurement.
"""
from collections import deque
from dataclasses import dataclass, field
import math


@dataclass(frozen=True)
class Point:
    x: float
    y: float
    visibility: float = 1.0


@dataclass(frozen=True)
class Pose:
    points: tuple[Point, ...]
    aspect_ratio: float = 1.0

    @property
    def center(self):
        return ((self.points[23].x + self.points[24].x) / 2,
                (self.points[23].y + self.points[24].y) / 2)


@dataclass(frozen=True)
class Features:
    x: float
    y: float
    shoulder_y: float
    height: float
    torso_length: float
    tilt: float
    knee_angle: float
    quality: float

    def vector(self, speed=0.0):
        return [self.tilt, self.knee_angle, self.height / self.torso_length, speed]


FEATURE_NAMES = ["torsoTiltDegrees", "kneeAngleDegrees", "heightToTorsoRatio", "speedBodyLengthsPerSecond"]
CLASSIFIER_MIN_CONFIDENCE = 0.75
CLASSIFIER_ACTIVITIES = {"walking", "sitting", "standing", "lying", "resting"}


def _angle(a, b, c):
    u, v = (a.x - b.x, a.y - b.y), (c.x - b.x, c.y - b.y)
    den = math.hypot(*u) * math.hypot(*v)
    return math.degrees(math.acos(max(-1, min(1, (u[0]*v[0] + u[1]*v[1]) / den)))) if den > 1e-6 else 0


def features(pose):
    if len(pose.points) != 33 or not math.isfinite(pose.aspect_ratio) or pose.aspect_ratio <= 0:
        return None
    required = [pose.points[i] for i in (11, 12, 23, 24, 25, 26, 27, 28)]
    if any(not all(math.isfinite(v) for v in (p.x, p.y, p.visibility)) for p in required):
        return None
    # Out-of-view body joints are not evidence of lying or falling.
    if any(not 0 <= p.x <= 1 or not 0 <= p.y <= 1 for p in required):
        return None
    scaled = [Point(p.x * pose.aspect_ratio, p.y, p.visibility) for p in pose.points]
    shx = (scaled[11].x + scaled[12].x) / 2
    shy = (scaled[11].y + scaled[12].y) / 2
    x, y = pose.center
    torso = math.hypot(shx - x * pose.aspect_ratio, shy - y)
    height = max(p.y for p in required) - min(p.y for p in required)
    if torso < 0.025 or height < 0.025:
        return None
    tilt = math.degrees(math.atan2(abs(shx-x*pose.aspect_ratio), abs(shy-y)))
    knees = (_angle(scaled[23], scaled[25], scaled[27]) + _angle(scaled[24], scaled[26], scaled[28])) / 2
    return Features(x, y, shy, height, torso, tilt, knees, max(0, min(1, min(p.visibility for p in required))))


@dataclass
class Track:
    track_id: int
    pose: Pose
    seen_at: float


class Tracker:
    """Short-lived geometric tracks, not resident identity. Crossing can reset IDs."""
    def __init__(self, max_distance=0.45, ttl=1.0):
        self.max_distance, self.ttl = max_distance, ttl
        self.tracks, self.next_id = {}, 1

    def update(self, poses, at):
        self.tracks = {k: t for k, t in self.tracks.items() if 0 <= at-t.seen_at <= self.ttl}
        poses = [pose for pose in poses if features(pose) is not None]
        ambiguous = {index for index, pose in enumerate(poses)
                     if any(index != other and math.dist(pose.center, candidate.center) < 0.06
                            for other, candidate in enumerate(poses))}
        # Retire prior IDs near an overlap rather than keeping them dormant: a
        # later single detection must not revive pre-overlap fall/inactivity data.
        self.tracks = {key: track for key, track in self.tracks.items()
                       if not any(math.dist(track.pose.center, poses[index].center) <= self.max_distance
                                  for index in ambiguous)}
        pairs = []
        for key, track in self.tracks.items():
            for index, pose in enumerate(poses):
                distance = math.dist(track.pose.center, pose.center)
                if distance <= self.max_distance:
                    pairs.append((distance, key, index))
        used_ids, used_poses, output = set(), set(), []
        for _, key, index in sorted(pairs):
            if key in used_ids or index in used_poses:
                continue
            # If two detections are close, preserve no identity through ambiguity.
            if index in ambiguous:
                continue
            used_ids.add(key); used_poses.add(index)
            track = Track(key, poses[index], at)
            self.tracks[key] = track; output.append(track)
        for index, pose in enumerate(poses):
            if index in used_poses:
                continue
            track = Track(self.next_id, pose, at)
            self.next_id += 1; self.tracks[track.track_id] = track; output.append(track)
        return output


@dataclass
class TemporalState:
    history: deque = field(default_factory=lambda: deque(maxlen=256))
    motion_history: deque = field(default_factory=lambda: deque(maxlen=86402))
    cumulative_path: float = 0.0
    cumulative_reversals: int = 0
    motion_direction: int = 0
    last_motion: float | None = None
    still_anchor: Features | None = None
    candidate: tuple | None = None
    last_emitted: dict = field(default_factory=dict)
    last_label: str | None = None


def inside_polygon(point, polygon):
    if len(polygon) < 3:
        return False
    x, y = point; inside = False
    for i, (ax, ay) in enumerate(polygon):
        bx, by = polygon[i-1]
        if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay) + ax:
            inside = not inside
    return inside


class ActivityEngine:
    DEFAULTS = {"inactivitySeconds": 300.0, "fallDropThreshold": 0.40,
                "fallWindowSeconds": 1.0, "fallConfirmSeconds": 1.0,
                "minPoseVisibility": 0.75, "eventIntervalSeconds": 30.0,
                "maxObservationGapSeconds": 1.0, "walkingSpeed": 0.12,
                "restingSeconds": 30.0, "wanderingSeconds": 180.0,
                "wanderingBodyLengths": 6.0}

    def __init__(self, settings=None, classifier=None):
        self.settings = {**self.DEFAULTS, **(settings or {})}
        self.states = {}; self.classifier = classifier

    def reset(self):
        self.states.clear()

    def update(self, track, zones=()):
        at = track.seen_at; f = features(track.pose)
        if f is None or f.quality < self.settings["minPoseVisibility"]:
            self.states.pop(track.track_id, None)
            return []
        state = self.states.setdefault(track.track_id, TemporalState())
        previous = state.history[-1] if state.history else None
        if previous and (at <= previous[0] or at-previous[0] > self.settings["maxObservationGapSeconds"]):
            state = TemporalState(); self.states[track.track_id] = state; previous = None
        if state.last_motion is None:
            state.last_motion = at; state.still_anchor = f
        speed = 0.0
        if previous:
            dt = at-previous[0]
            speed = math.hypot((f.x-previous[1].x)*track.pose.aspect_ratio, f.y-previous[1].y) / max(f.height, previous[1].height) / dt
        anchor = state.still_anchor
        # Relative to the stillness anchor, so small repeated changes accumulate.
        if (math.hypot((f.x-anchor.x)*track.pose.aspect_ratio, f.y-anchor.y) / max(f.height, anchor.height) > 0.06
                or abs(f.tilt-anchor.tilt) > 10 or abs(f.knee_angle-anchor.knee_angle) > 12):
            state.last_motion = at; state.still_anchor = f
        still_for = at-state.last_motion
        lying = f.tilt >= 60
        label = "lying" if lying else "sitting" if f.knee_angle < 140 else "standing"
        if label == "standing" and speed >= self.settings["walkingSpeed"]:
            label = "walking"
        if lying and still_for >= self.settings["restingSeconds"]:
            label = "resting"  # Sleep cannot be established from pose.
        score = min(f.quality, 0.85)
        classifier_method = "experimental_temporal_rules"
        if self.classifier:
            predicted, predicted_score = self.classifier.predict(f.vector(speed))
            classifier_method = "research_activity_classifier"
            if (predicted in CLASSIFIER_ACTIVITIES and isinstance(predicted_score, (int, float))
                    and not isinstance(predicted_score, bool) and math.isfinite(predicted_score)
                    and 0 <= predicted_score <= 1):
                label, score = predicted, min(f.quality, predicted_score)
                if score < max(CLASSIFIER_MIN_CONFIDENCE, self.settings["minPoseVisibility"]):
                    label, score = "unknown", 0.0
            else:
                label, score = "unknown", 0.0
        events = []

        def emit(activity, confidence, extra=None, cooldown=None):
            enabled = self.settings.get("enabledActivities")
            if enabled is not None and activity not in enabled:
                return
            if at-state.last_emitted.get(activity, -math.inf) < (cooldown if cooldown is not None else self.settings["eventIntervalSeconds"]):
                return
            state.last_emitted[activity] = at
            temporal_rule = activity in {"fall", "collapse", "inactivity", "wandering", "restricted_entry"}
            evidence = {"method": "experimental_temporal_rules" if temporal_rule else classifier_method,
                        "scoreMeaning": "uncalibrated_rule_strength" if temporal_rule or not self.classifier else "uncalibrated_classifier_score",
                        "trackId": track.track_id, "torsoTiltDegrees": round(f.tilt, 2),
                        "kneeAngleDegrees": round(f.knee_angle, 2), "speedBodyLengthsPerSecond": round(speed, 4),
                        "poseVisibility": round(f.quality, 4), **(extra or {})}
            events.append({"activity": activity, "confidence": round(confidence, 4), "evidence": evidence})

        # Need an upright pre-transition body AND rapid drop AND continued low pose.
        # A bent-knee sit alone can never become a fall candidate.
        for when, old, old_label in reversed(state.history):
            if at-when > self.settings["fallWindowSeconds"]:
                break
            drop = (f.y-old.y) / old.height
            head_drop = (f.shoulder_y-old.shoulder_y) / old.height
            if old_label in {"standing", "walking"} and drop >= self.settings["fallDropThreshold"] and head_drop >= self.settings["fallDropThreshold"]:
                collapsed = f.height / old.height < 0.55 and f.knee_angle >= 145
                if lying or collapsed:
                    if state.candidate is None:
                        state.candidate = (at, "fall" if lying else "collapse", old, drop)
                    break
        if state.candidate:
            since, kind, old, drop = state.candidate
            remains_low = f.y-old.y >= old.height*self.settings["fallDropThreshold"]*0.8
            if not remains_low or (kind == "fall" and not lying):
                state.candidate = None
            elif at-since >= self.settings["fallConfirmSeconds"]:
                emit(kind, min(f.quality, 0.80), {"durationMs": int((at-since)*1000), "dropBodyLengths": round(drop, 3),
                                                "verificationRequired": True}, cooldown=60)
                state.candidate = None
        if still_for >= self.settings["inactivitySeconds"]:
            emit("inactivity", min(f.quality, 0.80), {"durationMs": min(86400000, int(still_for*1000)),
                                                     "verificationRequired": True}, cooldown=self.settings["inactivitySeconds"])
        # Avoid accumulating inactive tracks forever.
        for key in list(self.states):
            last = self.states[key].history[-1][0] if self.states[key].history else at
            if at-last > 10:
                del self.states[key]
        state.history.append((at, f, "lying" if lying else "sitting" if f.knee_angle < 140 else "standing"))
        # One geometric sample per second, cumulative totals permit O(1) windows
        # even when an administrator configures long wandering periods.
        motion = state.motion_history
        if not motion or at-motion[-1][0] >= 1:
            if motion:
                dx = f.x-motion[-1][1]
                state.cumulative_path += abs(dx)*track.pose.aspect_ratio/f.height
                if abs(dx) > 0.004:
                    direction = 1 if dx > 0 else -1
                    if state.motion_direction and direction != state.motion_direction:
                        state.cumulative_reversals += 1
                    state.motion_direction = direction
            motion.append((at, f.x, state.cumulative_path, state.cumulative_reversals))
            while motion and at-motion[0][0] > self.settings["wanderingSeconds"]:
                motion.popleft()
            if len(motion) >= 4 and motion[-1][0]-motion[0][0] >= self.settings["wanderingSeconds"]*0.8:
                length = motion[-1][2]-motion[0][2]
                reversals = motion[-1][3]-motion[0][3]
                if reversals >= 3 and length >= self.settings["wanderingBodyLengths"]:
                    emit("wandering", min(f.quality, 0.80), {"directionReversals": reversals, "pathBodyLengths": round(length, 2), "verificationRequired": True}, cooldown=60)
        for zone in zones:
            if zone.get("enabled", True) and zone.get("zoneType") == "restricted" and inside_polygon((f.x, f.y), zone["polygon"]):
                emit("restricted_entry", min(f.quality, 0.80), {"zoneName": zone["name"], "zoneId": zone["zoneId"], "verificationRequired": True}, cooldown=60)
        if label != state.last_label or at-state.last_emitted.get(label, -math.inf) >= self.settings["eventIntervalSeconds"]:
            emit(label, score)
        state.last_label = label
        return events
