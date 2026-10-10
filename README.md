# CareConnect

CareConnect connects a resident care website, patient app, caretaker app and optional registered camera worker to a shared authenticated API. It supports prescription review, exact dose schedules, wellness history, care records, appointments, complaints, SOS alerts, meal plans and consent-based activity incident review.

The [research dossier](docs/research/index.md) contains the proposal traceability, diagrams, English/Tamil/Sinhala consent drafts, study instruments, evaluation plan and deployment/role guides. The [dated completion status](docs/research/completion-status.md) separates verified software from pending physical-device, model and participant validation. This is a research prototype; no complete clinical or research validation is claimed.

## Run the project

Open a terminal in `ML-based-prescription-reader-system`.

```powershell
npm run dev:web
```

This starts the API at `http://localhost:3001` and the website at `http://localhost:5173`. Both mobile apps and the API can be started together:

```powershell
npm run dev:app
```

Caretaker Expo uses port 8081; patient Expo uses port 8082. `npm run dev:all` additionally starts the website and the optional Donut server. Donut needs its Python environment and model files; cloud analysis remains available when Donut is offline and server AI credentials are configured.

## Configure a new installation

1. Install the dependencies in `1-ui-ux`, `4-system-engine/api`, `5-patient` and `6-caretaker` using `npm ci` in each folder. The root package only contains orchestration scripts, so use the component lockfiles rather than `npm ci` at the root.
2. Copy `.env.example` to `.env` **only if `.env` does not already exist**. Fill in MySQL connection settings and Firebase web configuration.
3. Enable email/password sign-in in Firebase Authentication. Set `FIREBASE_SERVICE_ACCOUNT_KEY` to the absolute path of your local Firebase Admin service-account JSON file. Protected endpoints reject access when server authentication is unavailable.
4. Set `GEMINI_API_KEY` on the server for cloud prescription and meal analysis. Face photo reports use Google Cloud Vision OAuth credentials as described below. Cloud Healthcare NLP is optional; it requires `GOOGLE_CLOUD_PROJECT_ID` and an OAuth service account with the appropriate Healthcare permissions. Set `VITE_ENABLE_CLOUD_NLP=false` when that service is not configured.
5. For phone testing, set `EXPO_PUBLIC_API_URL` in **each mobile app's** local `.env` to your computer's reachable LAN address, for example `http://192.168.1.10:3001/api`. A phone cannot reach your computer through `localhost`. Firebase settings in each app use the required `EXPO_PUBLIC_FIREBASE_*` variables in its Firebase configuration file; the apps fail fast instead of selecting a fallback Firebase project when these values are missing.

6. To enable local Donut OCR, use Python 3.11, create the project `.venv`, and install `3-prescription-reader/server/requirements.txt`. The `dev:all` launcher skips Donut with an actionable message when that environment is unavailable; the web and cloud analysis services remain usable.

Each mobile app's `.env.example` lists the Firebase variables it actually reads. Normal `npm ci` also applies the narrow Metro asset adapter for the patched image-size 2 API. If installing with `--ignore-scripts`, run `node scripts/patch-metro-image-size.cjs 5-patient` and the equivalent `6-caretaker` command from the project root before exporting. The adapter fails explicitly if Metro's expected call changes.

Provider API keys belong in server environment variables. Firebase's client configuration is public application configuration. Never copy a Gemini/provider key into `VITE_` or `EXPO_PUBLIC_` variables. Rotate the Gemini key that was previously embedded in the mobile source; removing it from new builds cannot invalidate older copies.

## Live Face Detection and Google Cloud reports

Live detection runs on the device without Google credentials. A background worker uses locally hosted face-api.js models for multiple faces, 68 landmarks, seven visible-expression probabilities and matching emojis. GPU acceleration is preferred, with CPU fallback. English, Tamil and Sinhala cover the interface, results and reports. The website offers balanced Tiny Face Detector and enhanced SSD MobileNet detection; its captured photos use SSD. The patient app includes its Tiny detector, landmark and expression weights offline. The camera stays continuous while mobile analysis samples one frame at a time; a separate live preview remains visible beside the exact analyzed image. Sampling adapts to device speed rather than promising a fixed frame rate.

Live results update after each completed analysis, with a compact expression/emoji/confidence display beside the video and a measured result-update rate. The website targets 120 ms between samples, skips unchanged video frames and reuses its canvas. Patient sampling targets 250 ms and uses an oriented native image reference to avoid a full-resolution camera JPEG write/decode before normalization. Slow analysis receives a small scheduling yield; requests never overlap or accumulate. Detector resolution and confidence safeguards are preserved. These targets are not guaranteed camera frame rates. The reproducible synthetic-video check in `scripts/live-face-speed-smoke.cjs` measures actual website session cadence without requesting camera access; results are recorded in `audit/live-face-speed-verification.json`.

The face analysis studio uses responsive camera/result cards, smooth face boxes, measured processing rates and evidence-quality guidance in English, Tamil and Sinhala. Low confidence, uncertain expressions, small faces, stale results and CPU/slow processing remain visible when measured. Expression stability is not a health indicator. The website also exposes all seven smoothed probabilities for each face.

The separate urgent-help panel accepts deliberate patient/observer reports with optional symptoms and a note; it works without a face result. It never detects or diagnoses a heart attack, stroke or other emergency from facial expressions. A direct `tel:1990` action is provided for immediate help in Sri Lanka. Only reported details are saved through the authenticated SOS API, without camera images or expression scores. Identical failed-request retries reuse a UUID and return the original saved alert; a saved receipt does not confirm anyone has seen it. The assigned-caregiver dashboard and app refresh while active, with bounded reads and resolution actions, visible failures and safe retries. The configured notification worker can additionally queue permitted Expo pushes; sending defaults to disabled until real project/device setup. SMS is not implemented. See the [verification plan](docs/research/testing-and-evaluation.md) and [push setup](docs/research/deployment-and-user-guide.md).

Optional cloud assistance sends a sampled photo through the authenticated API to Google Cloud Vision at most once every 15 seconds after the user enables it. Capture/upload and explicit cloud photo analysis remain available. Original photo analysis preserves a normalized JPEG up to 1600 pixels; local photo analysis uses a bounded copy (960 pixels on the website, 640 in the app). Boxes map to the same image geometry, and reports state the actual analyzed dimensions. Local model probabilities and Google categorical likelihoods remain distinct. Unclear predictions show uncertainty instead of a guaranteed emotion. Clear group photos receive separate per-face results; multiple people alone do not require a retake.

Website reports download as printable HTML with the image; patient reports share translated text, including retained frozen-frame results. Face analysis does not choose wellness scores, determine actual feelings, pain, health or identity, write mood history or create wellness alerts. Explicit self-reported wellness recording remains separate. Pausing, closing, backgrounding, retaking and account changes cancel or discard stale analysis. See the [completion status](docs/research/completion-status.md) for verification and activation limits.

Local models are bundled in `1-ui-ux/public/models/face-api`. Run `npm run build:face:mobile` after changing the portable model runtime or those models; it regenerates the offline patient runtime with asset hashes and its license. Run `npm run test:face` for face detection/report/session regressions. `node scripts/live-face-browser-smoke.cjs` serves a blank-image model check at `http://127.0.0.1:8767`; it uses no camera, account or cloud service.

Leave face credentials blank until ready. In your Google Cloud project, enable billing and the Vision API (`vision.googleapis.com`), then configure a server-side OAuth identity. See [Google's Vision setup guide](https://cloud.google.com/vision/docs/setup).

Set `FACE_VISION_CREDENTIALS` in the project `.env` to the absolute path of a private credential JSON file, and optionally set `FACE_VISION_PROJECT_ID` to the billing/quota project. The fallback credential order is `GOOGLE_APPLICATION_CREDENTIALS`, then `FIREBASE_SERVICE_ACCOUNT_KEY`; the project fallback is `GOOGLE_CLOUD_PROJECT`. An API key or Firebase browser configuration alone cannot enable this endpoint. When a quota project is specified, the principal needs `serviceusage.services.use` there, available through Service Usage Consumer. Follow [Google's authentication instructions](https://cloud.google.com/vision/docs/authentication). Keep credential files outside the repository and never use `VITE_` or `EXPO_PUBLIC_` credential variables. Restart the API after configuration changes.

Docker can reuse its mounted Firebase service-account credential for Vision if that identity has the required Google Cloud configuration. A separate Vision credential requires a private read-only mount and `FACE_VISION_CREDENTIALS` set to its container path. No credentials or live cloud calls were used for the implementation tests.

`POST /api/emotions/analyze-image` accepts `{ "image": "PNG/JPEG base64 or data URL" }` from a registered authenticated account and shares the API inference quotas. Images must have valid headers and structure, fit within 6 MiB and 16 megapixels, and have no side longer than 10,000 pixels. Re-export rotated or animated files as a still normalized JPEG/PNG. The server requests only face detection, with a maximum of 20 results, and bounds the OAuth/request/body operation to 18 seconds. This request format follows [Google's annotation API](https://cloud.google.com/vision/docs/reference/rest/v1/images/annotate).

Successful cloud output uses `face-report-v1`: provider, analysis timestamp, actual image dimensions, face count, normalized boxes, detection/landmark confidence, nullable pose angles, Google likelihood enums, and ordered quality guidance. Zero faces produces a valid `retake` report. `multiple_faces` is informational when it is the only issue. Retake guidance uses detection confidence below 0.8, likely blur/darkness, pose beyond 35 degrees, and a face dimension below 64 pixels or 10% of the image. These are photo heuristics. Failures return `INVALID_IMAGE` (400), `FACE_NOT_CONFIGURED` (503), or `FACE_UNAVAILABLE` (503), without provider details or fabricated results. Credentials can be supplied later; local live detection and the rest of the application remain usable.

## Database and the first administrator

Normal setup preserves records and creates missing tables without inserting demonstration users:

```powershell
npm run db:setup:dry --prefix 4-system-engine/api
node 4-system-engine/api/setup_db.js --migrate --confirm
```

The first command checks the schema and migration plan without opening a database connection. The second creates missing tables and applies idempotent migrations to existing databases, including prescription review evidence, observation retry IDs, medication check-ins and completed-medication history retention. Back up an existing database and review `4-system-engine/api/migrations.js` before applying it. Normal setup inserts no demonstration users. The optional `db:seed` command explicitly inserts demo records and should only be used on a disposable development database.

Create an enabled, email-verified Firebase identity for the administrator and copy its UID. Preview administrator provisioning using that exact UID and email:

```powershell
npm run admin:bootstrap --prefix 4-system-engine/api -- --uid YOUR_FIREBASE_UID --email admin@example.com
```

The command is read-only by default. Append `--confirm` to apply the reviewed change. It checks the identity, creates or updates its SQL profile and preserves other Firebase claims. Sign in again afterward so the identity receives a refreshed token. Administrators create caretaker accounts from the website; patients register through Patient Register and choose an available caretaker.

The API now starts only when MySQL, Firebase verification and the required schema version are available. `/api/health` returns 503 when one becomes unavailable.

Docker uses the configured `MYSQL_DATABASE`, requires a nonempty MySQL password, mounts Firebase credentials as a read-only Compose secret, and applies migrations through its setup service without demo seeding. Set a random private `DONUT_INTERNAL_TOKEN` for the API and Python service; the Python port stays inside the service network. Local Python inference defaults to loopback. The reviewed additive SOS retry migration was applied to the configured local database on 6 October 2026, without modifying patient rows or creating real alerts. No Docker deployment or administrator provisioning was performed during these source repairs.

## Verify before submission

```powershell
npm run build:web
npm run test:regression
```

The regression suite exercises authorization, prescription disagreements and repeated schedules, unavailable emotion analysis, signup recovery, account switching, persistence failures, mobile review controls, medication day rollover and credential isolation. It uses offline test doubles for database and cloud services.

Run Python inference/training safety checks separately with `python -m unittest discover -s 3-prescription-reader/server/tests -v`. These tests exercise normalization, bounded uploads, optimizer accumulation and held-out evaluation without downloading models or writing to cloud services.

Signed APK generation, physical-device camera/login flows, live Firebase/MySQL/cloud transactions and model accuracy on a labeled clinical dataset still require end-to-end validation. Optional ML libraries remain large; role dashboards and analysis features now load separately so the initial website download is smaller.

See the [completion status](docs/research/completion-status.md) for final checks and current limits. [AUDIT_REPAIRS.md](AUDIT_REPAIRS.md) preserves the earlier repair history.

## Prescription review

An extracted medicine is a proposed reading of the original prescription. Conflicting doses, incomplete fields and uncertain schedules retain their evidence and require review. Confirm each medicine against the source image before saving; editing a confirmed medicine invalidates that confirmation. Missing issue dates remain unknown until entered. Failed analysis does not produce a fabricated wellness assessment or a successful save message.

## Exact doses and notifications

Both mobile apps provide **Dose reminders** for confirmed medicines: one-to-eight distinct exact times, start/end dates, repeat weekdays and food instructions, using Asia/Colombo. Each scheduled occurrence records taken, skipped or snoozed status separately; retries and concurrent actions preserve occurrence uniqueness. These records describe reported adherence and cannot prevent someone physically taking an extra dose.

Expo push registration, provider tickets/receipts, generic lock-screen text, bounded retries and assigned-caretaker overdue escalation are implemented. Configure the intended EAS/FCM/APNs projects and physical installed builds before enabling `PUSH_NOTIFICATIONS_ENABLED=true`; delivery defaults to disabled. When remote delivery is disabled, the registered patient app can schedule approved local reminders for the next 48 hours and should be opened daily to refresh. Provider receipt, phone display, in-app read and caretaker acknowledgement are separate evidence. See the [deployment guide](docs/research/deployment-and-user-guide.md).

## Camera monitoring and care response

The [edge module](7-monitoring/README.md) processes supported camera frames in memory, uses local pose estimation and experimental temporal rules, and saves numeric event evidence. It supports pause/stop, short consent leases, health, a bounded metadata retry queue and optional trainable activity classification. It does not bundle trained activity weights, infer sleep, recognize resident faces or diagnose emergencies. Room attribution is an assumption; multiple people remain unknown when ambiguous.

The web portal manages devices, assignments, activities/zones and consent; staff can acknowledge, correct, mark false alarm and resolve incidents in the web/caretaker app. **Care record and monitoring plan** exposes permitted history/notes and agreed staff baseline controls; admin systems management exports response/audit JSON. Research forms and operational validation are documented in the [dossier](docs/research/index.md). Real camera/Pi/Jetson endurance, approved datasets and participant evaluation remain pending.
