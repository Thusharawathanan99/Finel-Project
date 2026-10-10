# Corrected project and verification status

Review date: **10 October 2026 (Asia/Colombo)**. Reference documents: the supplied 12-page research proposal, 147-page thesis and 20-part Tamil checklist. The existing project and uncommitted work were preserved. This report describes verified software and the remaining evidence needed for research completion.

## Repairs completed in this review

| Area | Corrected behavior |
| --- | --- |
| Camera and person tracking | Overlapping people cannot restore earlier tracking identities or reuse their fall/inactivity evidence. Invalid classifier predictions abstain. A visibility setting cannot lower the classifier acceptance threshold. |
| Consent and privacy | Authorization is rechecked after blocking camera reads/inference and before each queued delivery. Withdrawal clears queued observations; pause preserves permitted queued records. Generic evidence fields reject media URLs and common image encodings. |
| Resident attribution | Corrections require assignment and camera/activity consent at capture and review. Corrections cannot attach camera evidence to a resident who lacked permission. |
| Monitoring controls | Partial threshold changes preserve other settings. Admin controls expose activity selection, fall/visibility/inactivity/wandering/offline thresholds and temperature telemetry. Routine settings edits preserve resident assignment timestamps. |
| Human verification | Assigned staff can confirm or reject ordinary activity observations, record their reason and inspect linked incidents. Incident actions remain the route for emergency observations. Named caretaker attribution and a retrievable care-action history are available. |
| Anomaly checks | Current reviewed evidence and care plans are read under the same device locks used by consent and configuration updates, preventing stale evidence from creating an incident. |
| Medication reminders | Snoozed doses remain scheduled and visible across midnight. Actions reject withdrawn, disabled or unconfirmed regimens using the same parent-record lock order as prescription completion. Completed-history retries remain available after archival. Overdue status uses the configured escalation delay and is visible in the website and both mobile apps. |
| Documentation | Restored this previously missing report and reviewed unsupported thesis performance claims. The dossier contains diagrams, consent drafts, study instruments, evaluation procedures and installation/role guides. |

## Verification record

The source tree is uncommitted and contains earlier user changes. Base Git HEAD: `6b82b57`; that commit alone does **not** identify the repaired source. Environment: Windows PowerShell, Node `v24.18.0`, default Python `3.14.6`. Tests use constructed inputs unless explicitly stated otherwise. Retain a private source snapshot alongside the output logs for reproducibility.

| Command/check | Observed result | Evidence boundary |
| --- | --- | --- |
| `npm run typecheck --prefix 1-ui-ux` | Passed | Type correctness, not physical UI/device testing |
| `npm run build:web` | Passed; optional ML bundles still produce size warnings | Website compiles; target-device loading speed remains unmeasured |
| `npm run test:regression` | Passed | Offline clinical/security/mobile/web/face/credential/monitoring/UI/edge scenarios; no real patient alerts sent |
| Monitoring API/notification suites | 94 tests passed in the final combined regression | Constructed inputs; includes withdrawal lock ordering, cross-day snooze visibility and schedule preservation |
| Monitoring UI suite | 16 tests passed | Failed saves, changed-settings/assignment preservation, activity selection, observation/incident linkage, action history and overdue text |
| Edge suite | 34 tests passed | Temporal fall/inactivity, ambiguous tracking, consent expiry, queue retry/privacy and research split/evaluation logic |
| `python -m unittest discover -s 3-prescription-reader/server/tests -v` | 14 tests passed | Prescription normalization, bounded input, training/evaluation safety; no weights downloaded |
| `npm run test:monitoring:mysql` | Passed; all synthetic fixtures rolled back | Actual configured local MySQL: consent, event/incident deduplication, observation review, settings preservation, verified behavior anomaly and dose timezone checks |
| `npm run test:monitoring:startup` | 8 checks passed | Actual API startup/readiness and denied anonymous/forged-device requests; workers and push sending disabled, port 3097 |
| Existing edge Python 3.11/MediaPipe runtime | Passed blank-frame inference, zero poses | Local pose weights load; no camera opened. Python `3.11.3`, MediaPipe `0.10.35`, six-person configuration. No accuracy/FPS claim. |

Root verification logs are retained locally under `tmp/research-review/`: `final-regression.log`, `final-typecheck.log`, `final-build.log`, `final-monitoring-ui.log`, `final-mysql.log`, `final-startup.log` and `prescription-python.log`. Pose runtime verification was reported in tool output without a retained log file. [Verification manifest](verification-manifest.json) records command results and hashes of selected repaired source/lockfiles and logs. Do not add overlapping suite counts into a claimed number of independent research trials.

## What still prevents a 100% completion claim

| Requirement | Remaining work |
| --- | --- |
| Live identities and production setup | Verify the intended enabled/email-verified Firebase administrator, administrator-created caretakers, patient registration and cross-role behavior. Supply intended production credentials and HTTPS; never publish service-account files. |
| Closed-app push delivery | Configure EAS/FCM/APNs for installed phone builds, enable sending deliberately, and measure ticket/receipt/display/read/acknowledgement separately. OS background, reboot and notification-permission tests remain pending. SMS/Telegram and automatic routing to a second caretaker are not implemented. |
| Camera and Pi/Jetson operation | Test actual cameras, lighting, multiperson crossings, stop/revoke, network faults and recovery. Record reboot/endurance/temperature/FPS on the intended edge hardware. Anonymous tracks and room assignments do not establish reliable identity. |
| Activity/fall research | Obtain permitted datasets and independently labeled elderly-relevant sequences; train/freeze weights and measure sensitivity, specificity, precision/recall/F1, errors and subgroup coverage. Default activity/fall rules remain experimental. Sleep and arbitrary abnormal-movement diagnosis are not implemented. |
| Emotion research | Validate independently labeled expressions and deliberate wellbeing reports with the intended population. Continuous body-plus-expression distress inference and learned personal baselines remain research work. Facial expressions cannot establish actual feelings or a medical diagnosis. |
| Donut OCR | Verify the intended model, permitted weights, Python inference environment and authenticated extraction against independently labeled multilingual documents. Offline safety tests do not establish OCR accuracy. |
| Ethics and primary study | Obtain the actual university/site decision, independently review translations, record voluntary scope-specific consent and conduct approved interviews, observations, surveys and UAT. No participant study was conducted by this repair work. |
| Outcomes and report | Measure alert latency, caretaker response, adherence, usability, availability, false-alert rate and comfort against the approved baseline. Replace report result fields only with actual evidence. See [thesis evidence review](thesis-evidence-review.md). |

Use [proposal traceability](proposal-traceability.md) for all 20 items, [deployment and user guide](deployment-and-user-guide.md) to run the project, [testing and evaluation](testing-and-evaluation.md) to execute remaining scenarios, and [evidence register](evidence-register.md) to close each evidence gap.

## Run and review

From the project root:

```powershell
npm run dev:web
```

The website uses `http://localhost:5173` and the authenticated API uses `http://localhost:3001`. Admin monitoring controls are in system management; resident care records contain observation review and the agreed monitoring plan. Both phone apps require a reachable API address and their own installed/configured builds. The source changes do not update an already installed APK automatically.
