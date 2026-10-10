# Software testing, operational validation and research evaluation

Revision: 10 October 2026. Use the [completion status](completion-status.md) for final commands/results. Offline checks, rolled-back MySQL integration, physical operation and participant research are separate evidence categories. Passing software checks does not establish model accuracy, background delivery or clinical benefit.

## Reproducible software checks

Run from the repository root with component dependencies installed. Preserve date/time, Node/Python versions, exact command, source-tree state and final exit status. If work is uncommitted, do not invent a commit SHA; use an approved source snapshot/hash or record the dirty tree explicitly.

```powershell
npm run build:web
npm run test:regression
npm run test:monitoring:mysql
npm run test:monitoring:startup
python -m unittest discover -s 3-prescription-reader/server/tests -v
```

`test:regression` includes clinical, security, mobile, web, face, credentials, monitoring, monitoring UI and dependency-free edge tests. Monitoring/MySQL fixtures use synthetic data with rollback; execute only against an authorized development database and retain the result. Startup checks exercise authentication/schema/dependency boundaries. Python prescription tests do not require downloaded models. Web type checking is recorded separately in the final status. Individual module counts should not be added when suites overlap.

## Operational scenario matrix

For every test fill operator/date/build/environment, expected result, observed result, pass/fail, evidence location and follow-up. These rows are required procedures, not already passed results.

| Scenario | Expected observation and evidence |
| --- | --- |
| Real authentication and roles | Verified admin provisioned; caretaker created by admin; patient registered/assigned; denied cross-resident reads/writes; disabled/expired-token behavior; no secrets in client bundles |
| Camera start/pause/stop | Approved assignments/consent required; active state visible; pause/stop closes capture; no event after lease expires; hardware indicator and timestamp log |
| Consent withdrawal/expiry | Signed decision recorded; server rejects newly unauthorized events; worker closes camera/removes affected queue items; disconnected/blocked-driver revocation within documented lease boundary |
| Camera unplug/blocked driver | Unavailable health displayed; capture process can terminate/recover; no fabricated activity during missing observations; device-offline incident follows threshold |
| Network failure/recovery | New capture stops without refreshed consent; bounded already-authorized queue retries with stable IDs; recovery synchronizes once; permanent rejection/expiry discarded and visible |
| Multiple people/visitors | Anonymous/unknown attribution when ambiguous; no named critical inference from identity guess; tracks reset on crossing/occlusion; staff correction retains original event/history |
| Activity/fall false alerts | Independent normal sitting/slow lying/recovery/occlusion and safe transitions; complete sequences, abstention and missed/false candidates logged; no clinical sensitivity inferred from constructed landmarks |
| Exact dose schedules | One-to-eight distinct approved times; dates/weekdays/Asia/Colombo boundaries; independent occurrence per dose; edit/cancel/end-date behavior; two concurrent actions produce one effective terminal status |
| Taken/skipped/snooze | Due occurrence only; duplicate retry does not duplicate action; stale snooze round rejected; completed history retained; self-report meaning visible |
| Local/mobile reminder | Physical installed build; permission denied/revoked; next-48-hour fallback refresh; app closed/background/phone reboot/timezone changes; fallback removed on remote enable, schedule edit, dose action and sign-out |
| Remote push | Both EAS project IDs allowed; real FCM/APNs credentials; ticket/receipt/display/read separately recorded; closed-app sound/vibration subject to OS settings; denial/invalid token/provider failure/retry |
| Recipient changes | Transfer/resolution disables stale queued delivery; logout/account switch/offline revocation and in-flight registration checked; shared phone displays no old account's scheduled reminder |
| Emergency workflow | Location/time/reason/numeric evidence; staff verify identity and safety; acknowledge/false alarm/emergency-contact/correct/resolve history; response durations auditable; manual 1990 call only |
| Records/privacy | Assigned access, care notes and prescription review; raw pose frames absent from disk/log/API; limited exports; expiry deletes eligible observations while active incident/consent/audit retained |
| Load and multiuser | Approved synthetic load steps, request rate/concurrency, p50/p95 latency, resource use, error rate, database contention, notification backlog and health; record saturation and recovery |
| Hardware endurance | Target Pi/compatible Jetson, OS/runtime/model/hash, 24–72-hour supervised nonparticipant trial, CPU/memory/temp/inference/queue/gaps, reboot and camera/network faults |
| Backup/deployment | HTTPS certificate and secret protection; least privilege; tested backup restore on an isolated copy; installed builds and rollback; no public database/Python inference port |

Set load and deployment acceptance thresholds prospectively with the supervisor/site; no safe user count or performance guarantee is inferred from a web build. Record all failures and remediation, then rerun the affected scenario.

## User acceptance test sheet

Session pseudonym ___; role/language ___; consent/reference ___; build/device ___; facilitator ___; date ___; fictional test resident ___. For each task log success without help, success with help, failure, elapsed time, errors, assistance and participant comments.

| Role | Task |
| --- | --- |
| Administrator | Provision a caretaker; register/assign device; record actual consent reference; set activities/zones; start/pause/stop; inspect device health/report/audit |
| Caretaker | Open only assigned records; add a care note; review routine baseline; compare extracted medicine with source; set exact times; inspect dose status |
| Caretaker | Verify a simulated incident; acknowledge; mark false alarm; correct ambiguous identity; document emergency contacted/resolution; explain delivery-versus-response status |
| Patient/representative | Understand English/Tamil/Sinhala scope information; grant/refuse one scope; pause/withdraw; locate own prescription/appointment; record test taken/skipped/snooze |
| Mobile user | Deny and restore notification permission; reopen app after background; distinguish pending/failed save; sign out/shared-device change; identify how to seek deliberate urgent help |

Finish with the [custom usability/comfort instrument](data-collection-protocol.md). UAT with real participants is pending; developer walkthroughs and source assertions do not count as participant acceptance.

## Research metrics and comparison

Freeze model, thresholds, split, annotation guide and hypotheses before final testing. Labelers should be independent of predictions; use agreement/adjudication and retained provenance. Report sample/participant/recording counts, missingness, class support and uncertainty. Use participant/recording grouping for confidence intervals or cluster bootstrap as approved; avoid treating neighboring frames as independent trials.

| Outcome | Definition and essential denominator |
| --- | --- |
| Prescription extraction | Field exact match for medicine, dose/unit, frequency, date and food/time instructions; document-level complete-correct rate; false medication additions, omissions, consequential dose errors and manual review time. Report handwritten/printed and language strata separately. |
| OCR/NLP comparison | Same writer/document-disjoint test set and reference labels for each frozen method; CER/WER where transcriptions exist, structured-field metrics and latency/cost; no best-model claim without comparison |
| Activity classification | Confusion matrix, per-class precision/recall/F1, macro F1, accuracy and coverage. Count abstentions as errors in primary accuracy and show selective results separately. |
| Fall events | One independent labeled sequence/window per trial; sensitivity `TP/(TP+FN)` and specificity `TN/(TN+FP)`; define time-match tolerance before scoring. Report false alerts per measured non-fall hour, missed events and lead/confirmation delay. |
| Expression | Independent expression-label test set, per-class/support/confusion/coverage and confidence limitations; separate deliberate wellbeing reports. Do not infer actual feelings or disease from agreement with expression labels. |
| Alert latency | Detection→server, server→provider acceptance, provider→observed phone display separately, with synchronized clocks; report median/p95 and failures. A provider receipt alone cannot measure device latency. |
| Caretaker response | Detection/server receipt→first acknowledgement, acknowledgement→resolution; retain actor/time and unresolved cases. Report censoring and operational counts separately from clinical care quality. |
| Medication adherence | Reported taken eligible occurrences / eligible prescribed occurrences, with skipped/unknown and approved exclusions separate; compare baseline/follow-up within participants where possible. Actions do not verify ingestion. |
| Usability | Task completion/assistance/error/time plus custom questionnaire distributions/mean with response count; no unsupported SUS or clinical cut-off |
| Availability | Authorized scheduled monitoring time with valid capture/inference/connection divided by authorized scheduled time; report consent pauses, camera faults and network gaps separately. API uptime is a separate measure. |
| Privacy/comfort | Consent/refusal/withdrawal counts, approved survey distributions, deidentified themes/complaints and missing replies; no presumption of acceptability |

The [activity evaluator](../../7-monitoring/research/evaluate.py) handles labeled prediction CSV, abstention, confusion/class/subgroup metrics and fall measures. Non-overlapping positive durations are required for its false-alert/hour denominator. The [trainer](../../7-monitoring/research/train_activity.py) records split/model hashes and versions. The [dataset plan](literature-and-datasets.md) specifies license and leakage control. Neither script creates measured data.

## Result template

Experiment ID ___; ethics/site/data permission ___; source/build/model/hash ___; frozen threshold/config ___; data period/source ___; independent participants/recordings/windows ___; class/subgroup support ___; baseline ___; exclusion/missing/withdrawal handling ___; annotation agreement ___; metrics with denominators/intervals ___; resource/network/phone context ___; failures/adverse events ___; deviations ___; reviewer ___; restricted raw-evidence location ___; approved publishable summary ___. Leave every unmeasured value pending.
