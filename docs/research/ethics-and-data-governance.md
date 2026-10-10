# Ethics and data governance protocol

Status: **draft protocol; university ethics decision and approval number not supplied**. The proposal explicitly requires university ethics approval for human participation. Software completion does not provide that approval. Study recruitment, observation, recordings and participant evaluation begin only after the institutional decision and site permission have been recorded.

| Governance field | To be completed by the study team |
| --- | --- |
| University ethics committee | ____________________ |
| Approval/reference number | ____________________ |
| Decision date and expiry | ____________________ |
| Approved protocol/form versions | ____________________ |
| Principal investigator and contact | ____________________ |
| Independent ethics/complaints contact | ____________________ |
| Participating site and permission | ____________________ |
| Data custodian and breach contact | ____________________ |
| Approved retention and deletion dates | ____________________ |

## Approval submission pack

Submit the proposal, these participant sheets, translated-form review, recruitment and capacity process, interview/survey instruments, observation/simulation safety plan, data flow, risk assessment, dataset agreements, approved retention schedule, access/deletion process, complaints route and evaluation protocol. Record the actual committee conditions and amendments. Review applicable institutional and Sri Lankan requirements with the university; this dossier does not establish legal compliance.

The project title concerns elderly care. Any participation by children, people unable to provide informed consent, or a different institution needs explicit inclusion in the approved protocol and appropriate safeguards; approval for adult volunteers must not be extrapolated.

## Informed consent process

1. Explain the sheet in the person's preferred English, Tamil or Sinhala, away from recruitment pressure. Offer reading support and questions. Use the approved capacity assessment rather than assuming inability because of age or diagnosis.
2. Ask the person to explain the purpose, choices, risks and withdrawal route in their own words. Record comprehension support, interpreter and witness where used.
3. Obtain separate, unticked choices for `camera`, `activity`, `emotion` and `research`. The first two are both needed for the pose worker. Refusing research must not prevent ordinary care. Expression analysis is optional and is not medical diagnosis.
4. When an authorized representative is needed under the approved process, verify the authority and record it privately. Seek the resident's assent and stop when they object. An administrator recording a choice does not substitute for the resident/representative's valid consent.
5. Give the participant a signed copy. Store the signed original and any authority evidence separately from pseudonymized research records. Record scope, grant/withdrawal, language, form version, signer role, effective/expiry date and the staff actor in the append-only consent history.
6. Reconfirm after material changes to purposes, camera coverage, cloud providers, research use or forms. Do not infer consent from login, camera permission, a checkbox that was preselected, or a caregiver's convenience.

The UI/database record is operational evidence of a consent decision, not a replacement for the approved written process. Optional cloud photo processing needs a separate provider-specific permission and disclosure; the four production scopes do not encode every provider or media-storage choice. No face recognition is implemented. A future biometric identity feature needs separate review and explicit permission.

## Withdrawal and pause

The resident can ask staff to pause/stop a camera and withdraw any scope through the consent controls. Record withdrawal immediately; disable dependent monitoring and verify fresh server configuration reaches the edge. The worker polls every five seconds and uses a lease of at most 30 seconds, so revocation must be tested under normal, disconnected and blocked-camera conditions. Already queued resident metadata is removed on withdrawal; new capture stops when authorization cannot refresh. Server acceptance also checks current consent.

Log withdrawal time, requested scopes, camera-stop verification, affected queue/export locations and researcher notification. Exclude withdrawn identifiable research data where feasible before the approved anonymization cutoff. Already irreversibly aggregated anonymous results may be impossible to trace; explain that limitation before consent. Do not promise automatic erasure of every care/incident/audit record: apply the approved retention policy and documented exceptions. Preserve the minimum audit of the decision.

## Privacy boundaries and storage

| Data | Current handling | Required operational control |
| --- | --- | --- |
| Pose camera frames | Processed in RAM; no video/snapshot upload or recording by the edge worker | Visible camera-active notice; controlled coverage; pause for nonconsenting visitors; no bathrooms/personal-care observation unless explicitly approved |
| Pose-derived events | Numeric summaries, timestamps and optional room attribution; bounded SQLite retry queue | Dedicated service identity, restricted files, device encryption, secure backup handling |
| Database care records | Scoped authenticated API and MySQL | Database/backup encryption, least-privilege DB account, HTTPS reverse proxy, tested restore and access review |
| Monitoring consent | Append-only grant/withdrawal history | Separate signed forms, restricted access and approved retention |
| Expression observations | Separate local analysis; explicit cloud photo flow may exist | Distinguish on-device observation from external photo transfer; no diagnosis or automatic clinical escalation from an expression score |
| Prescription/photo reports | Separate explicit user operations | Inventory uploads, downloaded reports, shared files and provider handling; do not assume edge-frame policy applies |
| Research material | No real dataset collected by these docs | Pseudonymous IDs, private reidentification key, approved exports, source agreements, publication disclosure review |
| Push notification | Generic lock-screen wording and identifiers for in-app review | No resident name, medicine or expression text in lock-screen payloads; revoke old account/device registrations |

Raw-frame avoidance reduces storage; it does not make live camera processing anonymous. Room attribution, trajectories, timestamps and medical records can identify a person. Anonymous geometric track IDs are short-lived and can switch with crossings/occlusion. Single-room attribution is an assumption and must be corrected by staff if wrong.

Encryption at rest is an installation responsibility; MySQL/SQLite encryption is not proven by storing token hashes. Edge HTTPS with certificate validation is required off loopback. Development LAN HTTP must not be treated as production protection. Secrets belong outside Git/client bundles and must be rotated when exposed. Limit administrative privileges and review assigned-caregiver access after transfers.

## Retention and deletion register

The server's `MONITORING_RETENTION_DAYS` defaults to 30 and expires eligible activity observations and device health. Observations linked to open/acknowledged incidents are retained. Incident, consent and audit history are not deleted by that job. The edge queue has a 24-hour expiry and 10,000-item cap. These are implementation defaults, not the university's approved research retention policy.

Before deployment, complete an approved per-category schedule for care records, incident history, audit/consent, research manifests, identifier key, device queue, model artifacts, explicit uploaded photos/reports, provider copies and backups. Test deletions on copies and record counts, scope, approver, execution time and exceptions. Automatic deletion of all medical/photo records is not claimed.

No face-image storage is introduced by the pose pipeline. For the separate photo/report flows, respond to a deletion request by locating server uploads if present, user downloads/shared reports, research media and third-party processing records; delete controlled copies under policy, request provider action where available, and report inaccessible/shared-copy limits. Do not claim provider deletion without a receipt. Raw research imagery is not authorized merely because the `research` flag is granted; it needs an approved amendment and additional explicit choice.

## Safety, incident and complaint procedure

- Treat AI output as a prompt to check the resident. Low-quality, unknown or low-confidence observations cannot establish a clinical diagnosis.
- On a suspected urgent event, check safety directly, use the site's emergency plan and document staff responsibility. The app can offer a deliberate telephone action; it does not automatically call emergency services.
- Acknowledge the incident, verify identity/location, correct attribution if needed, mark a false alarm or add emergency-contact/resolution notes. Retain the reason, original event and actor history.
- Stop the study for distress, unsafe simulation, unexpected harm, privacy incident, consent failure or unacceptable missed/false alert burden. Provide normal care and notify the investigator/site lead according to the approved reporting deadlines.
- Receive complaints without affecting care. Record only necessary details, provide the independent ethics contact, investigate access/incident records, document action and communicate the outcome.
- For a suspected breach, contain access, preserve minimum evidence, assess affected data, rotate secrets if needed and follow institution-approved notification requirements. Record findings without exposing medical details in public logs.

## Bias and interpretation safeguards

Recruit an approved age-diverse local validation cohort, report language/lighting/device coverage and subgroup counts, and avoid inferring protected characteristics from camera footage. Demographic disclosures are voluntary and restricted. Small groups or missing labels do not justify fairness claims. Measure abstention and errors for each sufficiently supported subgroup. Staff verify repeated wandering and nighttime movement; negative wellness self-reports are not facial-expression diagnoses. Care-plan thresholds require context and staff review rather than being labelled validated medical thresholds.
