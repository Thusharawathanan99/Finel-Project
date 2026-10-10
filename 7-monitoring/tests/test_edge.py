import copy
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from edge.activity import ActivityEngine, Point, Pose, Track, Tracker, features
from edge.protocol import ApiClient, ApiError, ConsentGate
from edge.storage import EventQueue
from edge.worker import flush
from edge.camera import _capture
from research.evaluate import metrics
from research.split import assert_no_leakage, split_manifest


def pose(kind="standing", x=0.5, y=0.5, visibility=0.98):
    points = [Point(x, y, visibility) for _ in range(33)]
    for shoulder, hip, knee, ankle, offset in [(11, 23, 25, 27, -0.02), (12, 24, 26, 28, 0.02)]:
        if kind == "lying":
            points[shoulder] = Point(x-0.25, y-0.02+offset, visibility)
            points[hip] = Point(x, y+offset, visibility)
            points[knee] = Point(x+0.12, y+0.015+offset, visibility)
            points[ankle] = Point(x+0.25, y+0.04+offset, visibility)
        else:
            points[shoulder] = Point(x+offset, y-0.25, visibility)
            points[hip] = Point(x+offset, y, visibility)
            points[knee] = Point(x+offset+(0.15 if kind == "sitting" else 0), y+0.15, visibility)
            points[ankle] = Point(x+offset+(0.15 if kind == "sitting" else 0), y+0.30, visibility)
    return Pose(tuple(points))


def feed(engine, kind, when, y=None, x=0.5, visibility=0.98):
    return engine.update(Track(1, pose(kind, x=x, y=y if y is not None else 0.5, visibility=visibility), when))


def config(**extra):
    return {"enabled": True, "cameraState": "running", "configValidForSeconds": 30,
            "residents": [{"residentId": "R001", "cameraConsent": True, "activityConsent": True}],
            "settings": {}, "zones": [], **extra}


class TemporalTests(unittest.TestCase):
    def test_ordinary_sitting_is_not_a_fall(self):
        engine = ActivityEngine()
        results = feed(engine, "standing", 0)
        for i in range(1, 10):
            results += feed(engine, "sitting", i*0.2, y=0.65)
        self.assertIn("sitting", [e["activity"] for e in results])
        self.assertNotIn("fall", [e["activity"] for e in results])
        self.assertNotIn("collapse", [e["activity"] for e in results])

    def test_fall_needs_temporal_confirmation(self):
        engine = ActivityEngine()
        feed(engine, "standing", 0)
        initial = feed(engine, "lying", 0.2, y=0.82)
        self.assertNotIn("fall", [e["activity"] for e in initial])
        results = []
        for i in range(2, 9):
            results += feed(engine, "lying", i*0.2, y=0.82)
        self.assertEqual(sum(e["activity"] == "fall" for e in results), 1)
        fall = next(e for e in results if e["activity"] == "fall")
        self.assertGreaterEqual(fall["evidence"]["durationMs"], 1000)
        self.assertEqual(fall["evidence"]["method"], "experimental_temporal_rules")

    def test_recovered_transition_cancels_fall(self):
        engine = ActivityEngine(); feed(engine, "standing", 0)
        feed(engine, "lying", 0.2, y=0.82)
        output = feed(engine, "standing", 0.4)
        for i in range(3, 10):
            output += feed(engine, "standing", i*0.2)
        self.assertNotIn("fall", [e["activity"] for e in output])

    def test_slow_intentional_lying_does_not_trigger_fall(self):
        engine = ActivityEngine(); output = []
        for i in range(21):
            output += feed(engine, "standing" if i < 18 else "lying", i*0.2, y=0.5+i*0.015)
        self.assertNotIn("fall", [e["activity"] for e in output])

    def test_inactivity_requires_continuous_visible_pose(self):
        engine = ActivityEngine({"inactivitySeconds": 2})
        output = []
        for i in range(15):
            output += feed(engine, "standing", i*0.2)
        self.assertEqual(sum(e["activity"] == "inactivity" for e in output), 1)
        self.assertTrue(next(e for e in output if e["activity"] == "inactivity")["evidence"]["verificationRequired"])

    def test_gap_and_occlusion_reset_inactivity(self):
        engine = ActivityEngine({"inactivitySeconds": 2})
        for i in range(9):
            feed(engine, "standing", i*0.2)
        self.assertEqual(feed(engine, "standing", 1.8, visibility=0.4), [])
        self.assertNotIn("inactivity", [e["activity"] for e in feed(engine, "standing", 2.0)])
        self.assertNotIn("inactivity", [e["activity"] for e in feed(engine, "standing", 8.0)])

    def test_resting_does_not_claim_sleep(self):
        engine = ActivityEngine({"restingSeconds": 1})
        output = []
        for i in range(10):
            output += feed(engine, "lying", i*0.2, y=0.6)
        self.assertIn("resting", [e["activity"] for e in output])
        self.assertNotIn("sleeping", [e["activity"] for e in output])

    def test_walking_and_restricted_entry(self):
        engine = ActivityEngine(); feed(engine, "standing", 0, x=0.4)
        output = engine.update(Track(1, pose(x=0.5), 0.2), [{"zoneId": 1, "name": "Exit", "zoneType": "restricted", "polygon": [[0.45, 0.4], [0.65, 0.4], [0.65, 0.7], [0.45, 0.7]]}])
        self.assertIn("walking", [e["activity"] for e in output])
        self.assertIn("restricted_entry", [e["activity"] for e in output])

    def test_disabled_activity_is_not_emitted(self):
        engine = ActivityEngine({"enabledActivities": []})
        self.assertEqual(feed(engine, "standing", 0), [])

    def test_low_classifier_score_abstains(self):
        class Classifier:
            def predict(self, _): return "standing", 0.4
        output = feed(ActivityEngine(classifier=Classifier()), "standing", 0)
        self.assertEqual(output[0]["activity"], "unknown")

    def test_visibility_setting_cannot_weaken_classifier_abstention(self):
        class Classifier:
            def predict(self, _): return "standing", 0.6
        output = feed(ActivityEngine({"minPoseVisibility": 0.4}, Classifier()), "standing", 0)
        self.assertEqual(output[0]["activity"], "unknown")

    def test_invalid_classifier_predictions_never_use_confident_rule_fallback(self):
        for label, score in [("sleeping", 0.95), ("unknown", 0.9), ("standing", float("nan")),
                             ("standing", float("inf")), ("standing", -0.1), ("standing", 1.1),
                             ("standing", True), ("standing", "0.9")]:
            with self.subTest(label=label, score=score):
                class Classifier:
                    def predict(self, _): return label, score
                output = feed(ActivityEngine(classifier=Classifier()), "standing", 0)
                self.assertEqual(output[0]["activity"], "unknown")
                self.assertEqual(output[0]["confidence"], 0)

    def test_truncated_pose_is_rejected(self):
        self.assertIsNone(features(Pose(tuple(Point(0.1, 0.1) for _ in range(10)))))


class TrackerTests(unittest.TestCase):
    def test_separate_people_keep_ids_when_detection_order_changes(self):
        tracker = Tracker()
        first = tracker.update([pose(x=0.2), pose(x=0.8)], 0)
        second = tracker.update([pose(x=0.79), pose(x=0.21)], 0.2)
        self.assertEqual({round(t.pose.center[0], 1): t.track_id for t in first}, {round(t.pose.center[0], 1): t.track_id for t in second})

    def test_fall_sized_motion_preserves_temporal_track(self):
        tracker = Tracker(); first = tracker.update([pose()], 0)[0]
        second = tracker.update([pose("lying", y=0.82)], 0.2)[0]
        self.assertEqual(first.track_id, second.track_id)

    def test_expiry_and_overlap_reset_identity(self):
        tracker = Tracker(); first = tracker.update([pose()], 0)[0]
        second = tracker.update([pose()], 2)[0]
        self.assertNotEqual(first.track_id, second.track_id)
        overlaps = tracker.update([pose(x=0.49), pose(x=0.51)], 2.2)
        self.assertNotIn(second.track_id, [t.track_id for t in overlaps])

    def test_overlap_cannot_resurrect_pre_overlap_evidence(self):
        tracker = Tracker(); engine = ActivityEngine({"inactivitySeconds": 0.6})
        original = tracker.update([pose()], 0)[0]
        engine.update(original)
        for track in tracker.update([pose(x=0.49), pose(x=0.51)], 0.4):
            engine.update(track)
        recovered = tracker.update([pose()], 0.8)[0]
        self.assertNotEqual(recovered.track_id, original.track_id)
        self.assertNotIn("inactivity", [e["activity"] for e in engine.update(recovered)])

    def test_malformed_detection_does_not_break_valid_tracking(self):
        tracker = Tracker()
        tracks = tracker.update([Pose(tuple(Point(0.1, 0.1) for _ in range(10))), pose()], 0)
        self.assertEqual(len(tracks), 1)


class ConsentTests(unittest.TestCase):
    def test_running_pause_stop_withdrawal_and_expiry(self):
        gate = ConsentGate(); gate.update(config(), 1)
        self.assertTrue(gate.can_capture(2)); self.assertFalse(gate.can_capture(31))
        for state in ("paused", "stopped"):
            gate.update(config(cameraState=state), 1); self.assertFalse(gate.can_capture(2))
        value = config(); value["residents"][0]["activityConsent"] = False
        gate.update(value, 1); self.assertFalse(gate.can_capture(2))
        gate.update(config(), 1); gate.invalidate(); self.assertFalse(gate.can_capture(2))

    def test_all_assigned_people_need_consent(self):
        value = config(); value["residents"].append({"residentId": "R002", "cameraConsent": False, "activityConsent": True})
        gate = ConsentGate(); gate.update(value, 1); self.assertFalse(gate.can_capture(2))

    def test_insecure_remote_api_and_invalid_settings_fail_closed(self):
        with self.assertRaises(ValueError): ApiClient("http://example.org/api/edge", "a"*32)
        for bad in ("fast", 0, float("nan"), True):
            with self.assertRaises(ValueError): ConsentGate().update(config(settings={"fallConfirmSeconds": bad}), 1)

    def test_api_default_settings_contract(self):
        # Read the actual backend defaults; a mirrored fixture hid configuration drift.
        source = (Path(__file__).parents[2]/"4-system-engine/api/monitoringConfig.js").read_text(encoding="utf-8")
        definition = source.split("export const DEFAULT_SETTINGS = Object.freeze({", 1)[1].split("});", 1)[0]
        defaults = {key: float(value) for key, value in re.findall(r"(\w+):\s*(\d+(?:\.\d+)?)", definition)}
        for key, value in ActivityEngine.DEFAULTS.items():
            self.assertEqual(defaults[key], value, key)
        gate = ConsentGate(); gate.update(config(settings=defaults), 1)
        self.assertTrue(gate.can_capture(2))
        self.assertEqual(gate.config["settings"]["wanderingSeconds"], 180)


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.path = Path(self.directory.name)/"q.sqlite3"
        self.queue = EventQueue(self.path)
        self.payload = {"requestId": "test-event-123", "residentId": "R001", "activity": "standing", "confidence": 0.8, "evidence": {"hipY": 0.5}}

    def tearDown(self):
        self.queue.close(); self.directory.cleanup()

    def test_durable_queue_same_id_and_backoff(self):
        self.queue.enqueue(self.payload, 100); self.queue.enqueue(copy.deepcopy(self.payload), 100)
        self.assertEqual(self.queue.depth(), 1)
        self.queue.close(); self.queue = EventQueue(self.path)
        original = self.queue.due(100)[0][1]
        self.queue.retry(self.payload["requestId"], 0, 100)
        self.assertEqual(self.queue.due(101), [])
        self.assertEqual(self.queue.due(102)[0][1], original)
        self.queue.acknowledge(self.payload["requestId"]); self.assertEqual(self.queue.depth(), 0)

    def test_same_request_cannot_change_payload(self):
        self.queue.enqueue(self.payload, 100)
        with self.assertRaises(ValueError): self.queue.enqueue({**self.payload, "confidence": 0.9}, 100)

    def test_no_pixels_and_withdrawal_deletes_queue(self):
        for key in ("image", "videoData", "base64", "snapshot", "frame"):
            with self.assertRaises(ValueError): self.queue.enqueue({**self.payload, "evidence": {"nested": [{key: "x"}]}}, 100)
        self.queue.enqueue(self.payload, 100); self.queue.retain_residents([])
        self.assertEqual(self.queue.depth(), 0)

    def test_media_values_under_generic_keys_are_rejected(self):
        for media in ("data:image/png;base64,iVBORw0KGgo", "https://host/private.png", "rtsp://host/stream",
                      "blob:local-resource", "file:///private/photo.png", "/9j/4AAQSkZJRg", "iVBORw0KGgoAAA",
                      "R0lGODlhAQAB", "UklGRiIAAABXRUJQ"):
            with self.subTest(media=media):
                with self.assertRaises(ValueError):
                    self.queue.enqueue({**self.payload, "evidence": {"sample": [media]}}, 100)
        self.assertEqual(self.queue.depth(), 0)

    def test_retention_and_capacity(self):
        self.queue.enqueue(self.payload, 100); self.queue.prune(86501); self.assertEqual(self.queue.depth(), 0)
        self.queue.capacity = 1; self.queue.enqueue(self.payload, 100)
        with self.assertRaises(OverflowError): self.queue.enqueue({**self.payload, "requestId": "other-id"}, 100)

    def test_network_retry_replays_original_and_permanent_rejection_drops(self):
        gate = ConsentGate(); gate.update(config(), 0)
        self.queue.enqueue(self.payload)
        class Offline:
            def request(self, *_): raise ApiError(503)
        flush(Offline(), self.queue, gate, 1)
        self.assertEqual(self.queue.depth(), 1)
        self.queue.db.execute("UPDATE pending SET next_at=0"); self.queue.db.commit()
        class Reject:
            def request(self, *_): raise ApiError(403)
        flush(Reject(), self.queue, gate, 1)
        self.assertEqual(self.queue.depth(), 0)
        self.assertFalse(gate.can_capture(1))

    def test_slow_delivery_cannot_reuse_expired_consent_lease(self):
        gate = ConsentGate(); gate.update(config(configValidForSeconds=1), 0)
        self.queue.enqueue(self.payload)
        self.queue.enqueue({**self.payload, "requestId": "second-event"})
        clock = Mock(side_effect=[10, 10, 12])
        api = Mock()
        flush(api, self.queue, gate, 0, clock=clock)
        self.assertEqual(api.request.call_count, 1)
        self.assertEqual(self.queue.depth(), 1)
        self.assertEqual(self.queue.due()[0][0], "second-event")

    def test_pause_keeps_queue_and_withdrawal_purges_it(self):
        gate = ConsentGate(); gate.update(config(cameraState="paused"), 0)
        self.queue.enqueue(self.payload)
        api = Mock()
        flush(api, self.queue, gate, 1)
        api.request.assert_not_called()
        self.assertEqual(self.queue.depth(), 1)
        withdrawn = config(cameraState="paused")
        withdrawn["residents"][0]["cameraConsent"] = False
        gate.update(withdrawn, 0)
        flush(api, self.queue, gate, 1)
        self.assertEqual(self.queue.depth(), 0)


class CameraPrivacyTests(unittest.TestCase):
    def test_blocking_read_finishing_after_lease_never_enqueues_pixels(self):
        cv2 = Mock(); capture = cv2.VideoCapture.return_value
        capture.isOpened.return_value = True
        capture.read.return_value = (True, SimpleNamespace(shape=(480, 640, 3)))
        stop = Mock(); stop.is_set.return_value = False
        output = Mock()
        with patch.dict("sys.modules", {"cv2": cv2}), patch("edge.camera.time.monotonic", side_effect=[0, 2]):
            _capture("0", output, stop, SimpleNamespace(value=1), 640, 480)
        output.put_nowait.assert_not_called()
        capture.release.assert_called_once()


class ResearchTests(unittest.TestCase):
    def test_confusion_and_undefined_denominators(self):
        results = metrics([{"actual": "fall", "predicted": "fall"}, {"actual": "fall", "predicted": "unknown"}, {"actual": "standing", "predicted": "fall"}, {"actual": "standing", "predicted": "standing"}])
        self.assertEqual(results["accuracy"], 0.5)
        self.assertEqual(results["fall"]["sensitivity"], 0.5)
        self.assertEqual(results["fall"]["specificity"], 0.5)
        self.assertIsNone(metrics([{"actual": "standing", "predicted": "standing"}])["fall"]["sensitivity"])

    def test_split_is_subject_and_recording_disjoint(self):
        rows = [{"sampleId": str(i), "participantId": f"p{i//2}", "recordingId": f"v{i//2}", "contentHash": f"{i//2:064x}"} for i in range(20)]
        split = split_manifest(rows); assert_no_leakage(split)
        self.assertEqual(split, split_manifest(rows))
        bad = copy.deepcopy(split); bad[1]["split"] = "test" if bad[0]["split"] != "test" else "train"
        with self.assertRaises(ValueError): assert_no_leakage(bad)

    def test_connected_recordings_cannot_leak(self):
        rows = [{"sampleId": str(i), "participantId": f"p{i}", "recordingId": f"v{i}", "contentHash": f"{i:064x}"} for i in range(8)]
        rows[1]["recordingId"] = rows[0]["recordingId"]
        rows[2]["participantId"] = rows[1]["participantId"]
        split = split_manifest(rows)
        self.assertEqual(split[0]["split"], split[2]["split"])


if __name__ == "__main__":
    unittest.main()
