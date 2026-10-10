# Installation, deployment and role guide

Revision: 10 October 2026. This guide describes current source behavior. Real Firebase/EAS/cloud identities, downloaded model permissions, physical camera/phone tests, HTTPS and a care-site deployment remain operator validation tasks. See [completion status](completion-status.md) and [operational test matrix](testing-and-evaluation.md).

## Prepare the installation

Use Node supported by the locked component dependencies, MySQL, and an optional compatible Python 3.11 environment for Donut/MediaPipe. Record actual runtime versions. Install each component from the repository root:

```powershell
npm ci --prefix 1-ui-ux
npm ci --prefix 4-system-engine/api
npm ci --prefix 5-patient
npm ci --prefix 6-caretaker
```

Root scripts orchestrate components; root `npm ci` is not their dependency installation. Preserve an existing `.env`. For a new installation, copy [.env.example](../../.env.example) to a private root `.env`; each mobile app also needs its own copy of its [patient](../../5-patient/.env.example)/[caretaker](../../6-caretaker/.env.example) example. Populate MySQL settings and Firebase public client configuration for the **same intended project**. Set each app's `EXPO_PUBLIC_API_URL` to a reachable LAN endpoint for development or the deployed HTTPS API; a phone cannot use the computer's localhost. Limit permitted origins with `CORS_ORIGINS`.

Enable Firebase email/password authentication. Keep the private Admin credential outside Git, configure its absolute path in `FIREBASE_SERVICE_ACCOUNT_KEY`, and enable/verify the actual admin identity. Client Firebase configuration is public; Gemini/OAuth/Admin/device credentials must not appear in `VITE_`, `EXPO_PUBLIC_`, reports or mobile builds. Configure optional cloud services only when approved. Leave unconfigured services disabled and verify their unavailable state.

Back up an existing database privately and review [migrations](../../4-system-engine/api/migrations.js). Normal setup preserves data and does not seed demo users:

```powershell
npm run db:setup:dry --prefix 4-system-engine/api
node 4-system-engine/api/setup_db.js --migrate --confirm
npm run admin:bootstrap --prefix 4-system-engine/api -- --uid YOUR_VERIFIED_FIREBASE_UID --email admin@example.com
```

Bootstrap is a preview until the reviewed command includes `--confirm`. Use the exact real Firebase UID/email, then sign in again to refresh role claims. Do not use reset/demo-seed scripts on care records. Startup requires MySQL, Firebase verification and the current schema; `/api/health` reports unavailable dependencies. Verify fresh-install and upgrade separately.

Start local development with `npm run dev:web` (web 5173/API 3001), `npm run dev:app` (API/caretaker Expo 8081/patient Expo 8082), or `npm run dev:all` (also optional Donut). The [root guide](../../README.md) covers face-model/report configuration. API/web build and tests are in [testing](testing-and-evaluation.md).

## Optional Donut prescription service

From the project root, use a compatible Python environment and the pinned [requirements](../../3-prescription-reader/server/requirements.txt):

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r 3-prescription-reader/server/requirements.txt
npm run dev:donut
```

Set a random private `DONUT_INTERNAL_TOKEN`, loopback `DONUT_HOST`, and the server-side `DONUT_API_URL`. Client apps use the authenticated API relay; do not expose the Python service or token to a browser/phone. Review [donut_server.py](../../3-prescription-reader/server/donut_server.py) before starting: it chooses local `3-prescription-reader/best_model` or `server/models/donut-prescription` when compatible safetensors exist, otherwise its configured external model repository. Resolve access, license, download size, revision and hash first; model download/load success is not prescription accuracy. Retain reviewed model provenance and test reference prescriptions. Donut runtime/model installation is not established by offline Python unit tests.

## Mobile build and push activation

Both apps contain `expo-notifications` registration and generic private notification text. Remote sending defaults to disabled. Installed builds on physical phones are required for remote notification validation; a simulator/Expo Go walkthrough does not establish delivery.

1. Link each app to the operator's intended EAS project/account using the reviewed project configuration and `npm run eas:link` when needed. Preserve ownership and use each app's actual `extra.eas.projectId` from its app configuration; do not copy another person's account credentials.
2. Configure that project's Android FCM and, for iOS, APNs credentials through the platform/EAS workflow. Build with `npm run build:apk:patient` and `npm run build:apk:caretaker` for the current Android preview profiles. Verify artifact signatures, configuration and intended API/Firebase project before installation.
3. Set server `EXPO_PUSH_PROJECT_IDS` to the comma-separated intended project IDs. Configure private `EXPO_ACCESS_TOKEN` if the project's push-security policy requires it. Enable `PUSH_NOTIFICATIONS_ENABLED=true` only when operator setup is complete. Restart the API; retain registration/status evidence.
4. Sign in on each physical device and grant notification permission voluntarily. Denial/error states remain visible. The server verifies device ownership and role/resident scope; transfers and sign-out revoke stale registrations. Never publish push/install keys.
5. Run foreground/background/closed-app/reboot, permission-revocation, provider retry, account-switch and recipient-transfer scenarios. Record provider ticket, later receipt, actual phone display, in-app read and human acknowledgement separately. OS quiet settings/battery controls may suppress sound or display.

When remote sending is disabled and a patient phone registers successfully, it schedules approved pending occurrences for the next **48 hours**, capped at 60; open the app daily to refresh. Remote enable cancels the local fallback. Taken/skipped/snooze, schedule changes and account changes cancel/refresh affected local entries. Local fallback is not indefinite offline monitoring or guaranteed delivery. Caretaker remote alerts require server activation.

`NOTIFICATION_WORKER_INTERVAL_MS` defaults to 15000 and `MEDICATION_ESCALATION_MINUTES` to 30 (accepted range 5–1440). Overdue reminders target permitted assigned caretakers. Transport retries are bounded; stale resolved/transferred records are rechecked. No Twilio/Telegram or automatic emergency telephone call is configured by this implementation. See [notification worker](../../4-system-engine/api/notificationService.js) for the current transport/status contract.

## Camera and edge installation

Follow [7-monitoring/README.md](../../7-monitoring/README.md) for the complete Windows/local/Pi instructions, feature units, model contract and research commands. The worker accepts USB indexes/IP/RTSP/V4L2, and optional supported Pi CSI via `picamera2`. A MediaPipe-compatible OS/Python wheel and a licensed local pose `.task` model are prerequisites. Legacy Jetson Nano may lack compatible wheels; no tested CUDA performance or universal Nano support is claimed.

For a Linux service, use `/opt/careconnect-edge`, a dedicated `careconnect-edge` user with video/render access, its virtual environment, and [systemd unit](../../7-monitoring/deploy/careconnect-edge.service). Copy the [edge example](../../7-monitoring/.env.example) into restricted `/etc/careconnect-edge.env`, containing the registered device's one-time token, HTTPS API, camera source, pose model path and `/var/lib/careconnect-edge/events.sqlite3`. Install the unit, reload systemd and enable/start it. Restrict environment/model/queue files; use device disk encryption and disable production core dumps. Rotate device tokens through admin management and update/restart the service.

Register the device, assign residents, record actual camera/activity consent for **every assignment**, then select running. Device process start does not grant consent. No resident-consent bypass exists. Exactly one detected person/assigned resident uses a room assumption; multiperson ambiguity remains unknown. Raw frames remain in RAM. Internet loss closes new capture because the short consent lease cannot refresh; authorized queued metadata may synchronize after recovery. Verify pause/withdrawal, unplug, blocked camera, network loss/reboot and a measured endurance trial before relying on this module.

## Production deployment and maintenance

The [Compose file](../../docker-compose.yml) defines MySQL, schema setup, API and private Donut services. Use nonempty private MySQL/internal-service passwords, a read-only Admin credential secret and deployed CORS origins. Validate the current compose configuration before launching. Donut stays inside its service network; expose the API through a managed HTTPS reverse proxy, restrict direct port 3001 as appropriate, and never publish the database port. Compose alone does not install HTTPS, mobile push credentials or the separate physical edge worker.

Use least-privilege production DB/service identities, certificate validation for remote MySQL (`MYSQL_SSL_CA`), encrypted disks/backups, limited log access and scheduled restore tests. Define retention with the institution: `MONITORING_RETENTION_DAYS` defaults to 30 for eligible observations/health, while linked open incidents and consent/audit history follow separate policy. Apply reviewed migrations after backup. Keep an approved rollback/source/build record. Test alerts on artificial records with a supervised operator before participant use; preserve explicit save/error/status evidence.

## Administrator workflow

Sign in with the verified provisioned admin identity. Create caretaker accounts and check resident assignments. In camera/device management, register an enabled device and securely copy its one-time token; assign room/residents, thresholds, enabled activities and normalized polygon zones. Review health before running. Pause/stop for privacy or maintenance. Record consent only from the resident/authorized representative's actual decision, with signed reference/date/language; administrators cannot consent for them. In systems management use **Export response report** or **Export recent audit records** for JSON summaries; these are operational counts/history, not model accuracy. Handle downloaded records under the approved policy. Configure recipient access through care assignments and device/account registration.

## Caretaker workflow

Use only assigned residents. Open **Care record and monitoring plan** to review medical history, allergies, emergency contacts, appointments/doctors, recent check-in/help-request counts and care notes. Add factual notes with the actor/time retained; a failed save preserves the note for retry. Select **Edit agreed care plan** to configure inactivity, the rest period/night-movement option, verified wandering observations per hour and negative self-reported check-ins per day. These are individualized staff rules, not a learned or medically validated baseline. Patient profile access is read-only for the staff editing controls.

Compare every extracted medication with the prescription source and confirm it before setting times. In **Dose reminders**, set one-to-eight distinct `HH:MM` times, start/end dates, selected weekdays and approved food instruction. Times use Asia/Colombo. Review each occurrence's taken/skipped/snoozed state and overdue follow-up; do not treat actions as proof of ingestion. Save failures require retry; a medication listing alone is not an exact schedule.

For an incident, check the resident/location immediately under the site's emergency plan. Read numeric evidence/reason/confidence, verify identity, acknowledge, document false alarm or corrected attribution, record emergency contact and resolution notes. The alert may be a false/missed candidate; a saved/provider-delivered notification is not evidence that another caretaker responded. Use the deliberate 1990 action when appropriate; the system does not call automatically.

## Patient/authorized representative workflow

Register through Patient Register and choose the available assigned caretaker. View own records and use the language selector for monitoring permission information. Grant/refuse each scope separately; pause/withdraw when wanted. Staff assistance must reflect your actual decision. Review verified medications and approved dose times with the care team; record **Taken**, **Skipped** or **Snooze 10m** for the due test/actual occurrence as directed. Do not change the regimen because of an AI reading or notification. The application does not prescribe medicines.

Enable device notifications if desired; read its registration/local-fallback status and reopen daily when using fallback. Report wellbeing deliberately; expression observations are optional estimates. Request urgent help using the explicit action when needed. Sign out before another person uses the phone and report failed saves or unexpected records to authorized staff.
