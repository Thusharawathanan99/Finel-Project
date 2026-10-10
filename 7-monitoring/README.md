# CareConnect edge monitoring and research tools

This module adds a working camera/pose/event pipeline and an optional trainable
activity classifier. The default fall, collapse, inactivity, wandering and zone
rules are **experimental temporal heuristics**. Their scores describe rule
strength; they are not calibrated medical probabilities. No elderly participant
study, dataset training, real-camera test, device endurance result or accuracy
claim is included. Caretakers must verify incidents.

## Implemented behavior

- Webcam indexes, IP/RTSP streams and Linux V4L2 sources use OpenCV. Raspberry Pi
  CSI cameras can use the optional `picamera2` source.
- MediaPipe Tasks detects up to six people by default. Geometric tracking keeps
  short-lived anonymous IDs; it does not recognize faces or establish identity.
- Standing, walking, sitting, lying and resting are derived from observable
  posture/movement. **Resting does not establish sleep.** Low-quality/occluded
  joints reset temporal evidence; missing people never count as inactivity.
- A fall requires a previously upright person, rapid hip **and** shoulder drop,
  a horizontal torso, and continued low posture for the confirmation period.
  Rapid loss of height with straight knees can produce a collapse candidate.
  Sitting alone cannot satisfy the fall rule. Slow lying and recovery cancel
  candidates. These rules still need camera-specific false-positive validation.
- Prolonged observed stillness, repeated direction changes with sufficient path
  length, and entry into configured restricted polygons produce reviewable events.
- The server controls running, paused and stopped states. The worker polls
  `/api/edge/config` every five seconds. It closes capture on failure, expired
  consent, stopped/paused state, disabled device, or missing consent among any
  assigned residents. Consent leases are at most 30 seconds and the capture
  subprocess also checks the shared lease.
- Exactly one assigned resident plus one detected person permits room-assignment
  attribution. This is an explicit room assumption, not verified identity.
  Multiple people/assignments produce `unknown` events with anonymous track count,
  no resident attribution and no named critical incident. Geometric crossing,
  occlusion and visitors remain limitations; human correction is required.
  Overlapping tracks retire nearby prior IDs so subsequent observations cannot
  revive pre-overlap fall or inactivity evidence.
- Raw images stay in RAM. No image/video file is recorded, uploaded or used as
  event evidence. The SQLite queue contains timestamps, resident assignment and
  numeric pose-derived summaries only. No face recognition is implemented.
- Event IDs remain unchanged on retry. Exponential backoff is bounded to five
  minutes; events expire after 24 hours and capacity is 10,000. Withdrawal removes
  the resident's queued events. Permanent rejection is discarded with a warning.
  Internet failure stops new capture because fresh consent cannot be verified;
  already queued events synchronize when authorization returns.
  Paused cameras retain previously captured metadata; withdrawal purges it.
  Consent is checked again after inference, after blocking camera reads and
  before every queued delivery, including delivery after a slow request.
- Health samples report camera availability, queue depth, CPU, memory and
  temperature when the host exposes those readings. Camera read failures restart
  capture after five seconds. A blocked capture driver runs in a process that can
  be terminated. The API/dashboard handles health/offline incidents.

## Local setup

Use a Python version with a supported MediaPipe wheel for your OS/architecture.
The local Python 3.11 environment successfully loads the supplied pose asset and
processes blank frames. This checks runtime availability only; no camera was
opened and no detection accuracy or device endurance was measured.
From `7-monitoring`, create an isolated environment and install dependencies:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
$env:EDGE_API_URL = 'http://127.0.0.1:3001/api/edge'
$env:EDGE_DEVICE_TOKEN = '<token from admin device registration>'
$env:EDGE_POSE_MODEL = 'C:\secure-models\pose_landmarker.task'
.venv\Scripts\python -m edge.worker --self-check
.venv\Scripts\python -m edge.worker --source 0
```

Supply a local pose `.task` model obtained explicitly from the official model
page. No model is downloaded automatically. Record its source, license and SHA-256.
Do not put bearer tokens or camera credentials in command-line arguments. The
worker reads the token from `EDGE_DEVICE_TOKEN` and camera source from
`EDGE_CAMERA_SOURCE`. A populated environment file belongs outside the repository.
HTTPS is enforced for every API host except loopback. TLS certificate validation
remains enabled and redirects are rejected to protect the bearer token.

Register an enabled device in the admin portal, assign residents, record active
camera/activity consent for every assignment, and start the camera. The worker
remains paused until that server configuration is available. Camera settings do
not override withdrawn consent. There is no local consent-bypass option.

## Configuration contract and units

`GET /api/edge/config` uses the device bearer token and returns:

```json
{
  "deviceId": "EDGE-001", "enabled": true, "cameraState": "running",
  "configVersion": "server-version", "configValidForSeconds": 30,
  "settings": {"inactivitySeconds": 300, "wanderingSeconds": 180},
  "residents": [{"residentId": "R001", "cameraConsent": true, "activityConsent": true}],
  "zones": [{"zoneId": 1, "name": "Exit", "zoneType": "restricted", "enabled": true,
             "polygon": [[0.1,0.1],[0.3,0.1],[0.3,0.4],[0.1,0.4]]}]
}
```

| Setting | Units / meaning | Worker default |
| --- | --- | --- |
| inactivitySeconds | continuously observed stillness, seconds | 300 |
| fallDropThreshold | hip and shoulder downward distance / pre-transition body height | 0.40 |
| fallWindowSeconds | maximum time for rapid transition, seconds | 1 |
| fallConfirmSeconds | continued low posture before fall candidate event, seconds | 1 |
| minPoseVisibility | minimum visibility of all required body joints, 0..1 | 0.75 |
| eventIntervalSeconds | per-track/per-label normal event cooldown, seconds | 30 |
| wanderingSeconds | trailing path/reversal observation window, seconds | 180 |
| enabledActivities | optional array of labels; empty disables event output | all |
| maxObservationGapSeconds | gap after which temporal evidence resets, seconds | 1 |
| walkingSpeed | hip displacement / body height / second | 0.12 |
| restingSeconds | stillness while horizontal, seconds | 30 |
| wanderingBodyLengths | minimum accumulated horizontal path / body height | 6 |
| offlineTimeoutSeconds | server device-health deadline; accepted by worker | server default |

Normal coordinates and zone polygons use x/y in `[0,1]`. Torso angles compensate
for camera aspect ratio. Fall displacement divides normalized vertical motion by
the previous body's vertical extent. Camera perspective, bed geometry and chair
occlusion can invalidate these approximations. Calibration and labeled trials are
required. `abnormal_movement` should be derived from validated resident baselines;
this worker does not invent a medical interpretation for arbitrary body motion.

## Raspberry Pi / Linux service

1. Use a maintained 64-bit OS and a MediaPipe-compatible Python/architecture.
   Test `pip install -r requirements.txt` on that device before deployment.
   Legacy Jetson Nano environments may lack compatible Python/MediaPipe wheels;
   no CUDA/Jetson acceleration or tested FPS is claimed. USB/V4L2 and supported
   compatible environments use the same worker.
2. Copy this directory to `/opt/careconnect-edge`. Create a dedicated
   `careconnect-edge` service user with video/render access, create the environment
   at `/opt/careconnect-edge/.venv`, and keep model files under `models/`.
3. For Pi CSI, install the OS-provided `python3-picamera2`/libcamera packages and
   create the virtual environment with `--system-site-packages` so their matching
   ABI remains available. Set `EDGE_CAMERA_SOURCE=picamera2`. USB cameras can use
   `0` or `/dev/video0`; IP cameras use the device's stream URL. Check access with
   the OS camera utilities before starting this service.
4. Copy `.env.example` to `/etc/careconnect-edge.env`, insert the registered token,
   valid HTTPS server, camera source and local model path. Restrict that file to
   the administrator/service user; use full-disk encryption for the device's
   metadata queue and disable core dumps in production.
5. Install `deploy/careconnect-edge.service` into `/etc/systemd/system/`, run
   `systemctl daemon-reload` and `systemctl enable --now careconnect-edge`.
   Service state resides under `/var/lib/careconnect-edge` with restrictive umask.
6. Review `journalctl -u careconnect-edge`. Start monitoring from the admin portal;
   the service's start does not grant resident consent. Rotate a token by updating
   the restricted environment file and restarting the service.
7. Verify stop/pause/revoke close the camera, unplugging produces unavailable
   health, reboot restarts the process, network loss closes capture, existing
   queued metadata replays once, and thresholds work under actual room lighting.
   Record CPU/memory/temperature, inference time, missed observations and uptime
   during a real 24–72 hour endurance trial. That trial has not been performed here.

## Tests

```console
python -m unittest discover -s tests -v
python check_pose_runtime.py --model models/pose_landmarker_lite.task
```

The current suite passes 34 deterministic tests without any ML dependencies:
temporal fall confirmation, normal sitting, slow lying, recovery, inactivity,
occlusion/gaps, resting versus sleep, walking/zones, disabled activity output,
classifier abstention, multiperson identity reset, backend configuration defaults,
consent withdrawal/expiration, HTTPS policy, durable queue/idempotency/backoff,
permanent rejection, privacy/retention, metrics and split leakage. These are code
tests with constructed landmarks, **not research accuracy or camera validation**.
Additional regressions cover overlap recovery, malformed detections, classifier
threshold stability, invalid classifier scores, slow delivery crossing a consent
lease, pause versus withdrawal, blocking reads and media disguised as generic
evidence values. The blank-frame runtime check uses the separately installed ML
dependencies and local model; it does not open a camera.

## Reproducible activity training and evaluation

Install `requirements-research.txt` in a compatible isolated environment. The
included baseline learns standing/walking/sitting/lying/resting from four pose
features: torso tilt degrees, mean knee angle degrees, height-to-torso ratio, and
speed in body heights per second. Those features are defined in `edge.activity`;
expert labels must come from actual observations, not from the same heuristic
whose accuracy you are trying to measure. No trained weights are bundled.

Prepare JSONL records with unique `sampleId`, pseudonymous `participantId`,
original `recordingId`, original recording's SHA-256 `contentHash`, `label` and
`features` mapping keyed by `edge.activity.FEATURE_NAMES`. Maintain a separate
restricted provenance ledger with dataset release, source/license reference,
review date, retention terms, participant consent and ethics approval reference.
Do not put names or identifying images in the research manifest.

```console
python -m research.split approved-manifest.jsonl --output approved-split.jsonl
python -m research.split approved-split.jsonl --verify --output verified-split.jsonl
python -m research.train_activity verified-split.jsonl --output-dir results/experiment-001
python -m edge.worker --model models/pose_landmarker.task --activity-model results/experiment-001/activity-model.joblib
python -m research.evaluate actual-predictions.csv --output results/heldout-evaluation.json
```

The splitter joins participant, original-recording and duplicate-content groups
before assigning approximately 70/15/15 train/validation/test sets. Exact source
hashes must represent the original recording before clipping or augmentation.
Near duplicates and undocumented participant overlap still require manual review;
never substitute a missing subject ID with one new ID per frame. Three independent
groups are the minimum for the tool, not a sample-size justification.

The trainer fits a standardized, balanced logistic-regression baseline on the
training split only. It rejects leakage and absent training classes, reports
validation/test confusion matrices, precision/recall/F1, accuracy and coverage,
and records manifest/model hashes, seed and library versions. It abstains below
0.75, counting abstentions as errors. Keep thresholds fixed before the final
held-out test. Only load a trusted local `joblib` artifact: serialized models can
execute code. A fit/export completed successfully is not evidence of clinical
reliability. Falling/collapse/inactivity require separate **sequence-level** trials.

`research.evaluate` accepts CSV fields `actual,predicted,confidence` and optional
`participantId,lighting,ageBand,gender,skinTone,durationSeconds`. It includes
abstentions in the confusion matrix and reports fall sensitivity/specificity.
Unsupported denominators remain `null`. Provided non-overlapping, measured
durations enable false alarms per non-fall hour. Subgroup tables report sample
counts to expose coverage gaps; small subgroups do not support fairness claims.
No measured data means no accuracy or false-alarm report should be presented.

For proposal evaluation, compare a pre-registered manual/rule baseline with the
trained system on the same independent participants. Separately measure camera
availability; detection-to-server and server-to-phone latency (synchronized
clocks); acknowledgement/resolution time; medication adherence before/after;
caretaker usability; and consent/privacy comfort. Record missed falls as well as
false alarms, including staged sitting, kneeling, intentional lying, assisted
transfers, bed/chair occlusion, different lighting and visitors. Genuine falls
must never be induced in older adults; supervised simulations need the approved
ethics protocol and suitable volunteers/safety arrangements.

UCF101/Kinetics/CASIA and FER2013/AffectNet are potential sources from the proposal,
not downloaded datasets or verified permissions in this repository. Confirm each
release's actual license and permitted research use with its provider, preserve
the permission evidence, map compatible labels, and collect an independent
age-diverse Sri Lankan validation cohort only after approval. Dataset names or
license of a model repository do not grant permission for every underlying video.
Emotion evaluation remains a separate model/module.

## Primary implementation references

The adapter follows the official [MediaPipe Pose Landmarker Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python):
local model path, VIDEO mode, multiple-pose configuration, monotonic timestamps,
and normalized landmarks. Live camera decoding uses the documented
[OpenCV VideoCapture interface](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html).
CSI configuration uses the [Raspberry Pi Picamera2 manual](https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf),
including its RGB888 BGR byte order. Consult current official platform support
before installing these optional runtimes.
