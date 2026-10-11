"""Run: python -m edge.worker --model /path/pose_landmarker.task

Local source/token configuration is never obtained from resident event evidence.
"""
import argparse
from datetime import datetime, timezone
import logging
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from . import VERSION
from .activity import ActivityEngine, Tracker
from .camera import Camera
from .pose import PoseDetector, ResearchClassifier
from .protocol import ApiClient, ApiError, ConsentGate
from .storage import EventQueue

LOG = logging.getLogger("careconnect.edge")


def utc_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def health(camera_available, queue_depth):
    body = {"capturedAt": utc_iso(), "cameraAvailable": camera_available, "queueDepth": queue_depth, "softwareVersion": VERSION}
    try:
        import psutil
        body.update(cpuPercent=round(psutil.cpu_percent(), 2), memoryPercent=round(psutil.virtual_memory().percent, 2))
        if hasattr(psutil, "sensors_temperatures"):
            values = [t.current for rows in psutil.sensors_temperatures().values() for t in rows]
            if values and -40 <= max(values) <= 150:
                body["temperatureC"] = round(max(values), 2)
    except (ImportError, OSError):
        pass
    return body


def flush(api, queue, gate, now, limit=2, clock=time.monotonic):
    started_at = clock()
    if not gate.fresh(now):
        return
    consented = gate.consented()
    all_consented = bool(consented) and len(consented) == len(gate.config.get("residents", []))
    queue.retain_residents(consented, allow_anonymous=all_consented)
    if not gate.can_capture(now):
        return  # Keep already captured metadata while the camera is paused.
    for key, payload, attempts in queue.due(limit=limit):
        if not gate.can_capture(now + max(0, clock()-started_at)):
            break  # A slow request can consume the lease before the next event.
        try:
            api.request("/events", payload); queue.acknowledge(key)
        except ApiError as error:
            if error.status in {400, 403, 409, 410, 422}:
                queue.acknowledge(key)
                LOG.warning("Rejected event discarded (status %s)", error.status)
                if error.status == 403:
                    gate.invalidate()
                    break  # Permission may have changed since config polling.
            else:
                queue.retry(key, attempts)
                if error.status == 401:
                    gate.invalidate()
                break


def main(argv=None):
    parser = argparse.ArgumentParser(description="Experimental pose monitoring with fresh server consent")
    parser.add_argument("--model", default=os.environ.get("EDGE_POSE_MODEL"))
    parser.add_argument("--activity-model", default=os.environ.get("EDGE_ACTIVITY_MODEL"))
    parser.add_argument("--source", default=os.environ.get("EDGE_CAMERA_SOURCE", "0"))
    parser.add_argument("--api", default=os.environ.get("EDGE_API_URL", "http://127.0.0.1:3001/api/edge"))
    parser.add_argument("--queue", default=os.environ.get("EDGE_QUEUE_PATH", "./state/events.sqlite3"))
    parser.add_argument("--fps", type=float, default=5)
    parser.add_argument("--max-people", type=int, default=6)
    parser.add_argument("--self-check", action="store_true", help="Validate configuration and local model; never open camera")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.model or not 1 <= args.fps <= 15 or not 1 <= args.max_people <= 12:
        parser.error("Supply --model, --fps from 1 to 15, and --max-people from 1 to 12")
    api = ApiClient(args.api, os.environ.get("EDGE_DEVICE_TOKEN"))
    detector = PoseDetector(args.model, args.max_people)
    classifier = ResearchClassifier(args.activity_model) if args.activity_model else None
    if args.self_check:
        detector.close(); LOG.info("Local configuration and model load succeeded; camera remains closed")
        return 0
    queue = EventQueue(args.queue)
    camera = Camera(args.source)
    gate = ConsentGate(); tracker = Tracker(); engine = ActivityEngine(classifier=classifier)
    stopped = False

    def stop_signal(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGINT, stop_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_signal)
    next_config = next_health = next_sync = next_infer = reconnect_at = 0.0
    last_sample = None; opened_at = 0.0; config_signature = None; previous_allowed = False
    last_unknown = -float("inf")
    executor = ThreadPoolExecutor(max_workers=2)
    config_future = None
    flush_future = None
    health_future = None
    try:
        while not stopped:
            now = time.monotonic()
            if now >= next_config and config_future is None:
                config_future = executor.submit(api.request, "/config")
                next_config = now + 5

            if config_future and config_future.done():
                try:
                    cfg = config_future.result()
                    gate.update(cfg, time.monotonic())
                    signature = (gate.config.get("configVersion"), repr(gate.config["settings"]), repr(gate.config["residents"]), repr(gate.config["zones"]))
                    if signature != config_signature:
                        engine = ActivityEngine(gate.config["settings"], classifier); tracker = Tracker()
                        config_signature = signature
                except (ApiError, ValueError):
                    gate.invalidate()
                camera.update_lease(gate.expires_at)
                config_future = None

            now = time.monotonic(); allowed = gate.can_capture(now)
            if allowed != previous_allowed:
                LOG.info("Camera processing %s", "active (fresh consent)" if allowed else "paused or stopped (no active consent lease)")
                previous_allowed = allowed
            if not allowed:
                camera.stop(); tracker = Tracker(); engine.reset(); last_sample = None
            elif camera.process is None and now >= reconnect_at:
                camera.start(gate.expires_at); opened_at = now; last_sample = None
            if allowed and camera.process:
                sample = camera.read()
                if sample:
                    captured_at, pixels = sample
                    last_sample = captured_at
                    if now >= next_infer and now-captured_at < 1.0 and gate.can_capture(time.monotonic()):
                        try:
                            poses = detector.detect(pixels, captured_at)
                            if not gate.can_capture(time.monotonic()):
                                camera.stop(); engine.reset(); tracker = Tracker()
                                del pixels
                                continue  # Inference must not outlive permission.
                            tracks = tracker.update(poses, captured_at)
                            observed = utc_iso()
                            resident_ids = gate.consented()
                            for track in tracks:
                                events = engine.update(track, gate.config["zones"])
                                if len(resident_ids) == 1 and len(tracks) == 1:
                                    for event in events:
                                        queue.enqueue({**event, "requestId": str(uuid4()), "residentId": resident_ids[0],
                                                       "observedAt": observed, "modelVersion": classifier.version if classifier else VERSION})
                                elif events and now-last_unknown >= 30:
                                    # Identity ambiguity never attaches an incident to a named resident.
                                    queue.enqueue({"requestId": str(uuid4()), "activity": "unknown", "confidence": 0.0,
                                                   "observedAt": observed, "modelVersion": VERSION,
                                                   "evidence": {"method": "anonymous_pose_tracking", "trackCount": len(tracks), "identity": "unresolved", "verificationRequired": True}})
                                    last_unknown = now
                        except Exception as error:
                            LOG.warning("Inference/event processing failed (%s)", type(error).__name__)
                            engine.reset(); tracker = Tracker()
                        next_infer = time.monotonic()+1/args.fps
                    del pixels
                now = time.monotonic()
                if not camera.alive() or now-(last_sample if last_sample is not None else opened_at) > 4:
                    camera.stop(); engine.reset(); tracker = Tracker(); last_sample = None
                    reconnect_at = now+5
                    LOG.warning("Camera unavailable; reconnect scheduled")
            now = time.monotonic()
            if now >= next_sync and flush_future is None:
                flush_future = executor.submit(flush, api, queue, gate, now)
                next_sync = now + 1

            if flush_future and flush_future.done():
                try:
                    flush_future.result()
                    camera.update_lease(gate.expires_at)
                except Exception:
                    pass
                flush_future = None

            if now >= next_health and health_future is None:
                health_payload = health(bool(allowed and last_sample is not None and now-last_sample < 4), queue.depth())
                health_future = executor.submit(api.request, "/health", health_payload)
                next_health = now + 15

            if health_future and health_future.done():
                try:
                    health_future.result()
                except ApiError as error:
                    if error.status in {401, 403}:
                        gate.invalidate(); camera.update_lease(0)
                except Exception:
                    pass
                health_future = None

            queue.prune()
            time.sleep(0.03)
    finally:
        executor.shutdown(wait=False)
        camera.stop(); detector.close(); queue.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
