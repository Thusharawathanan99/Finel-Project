# Final research report draft

**Machine Learning Smart Prescription Reader and Caretaker Assistant System (CareConnect)**

Horizon Campus, Faculty of Information Technology. Author/student ID ___; supervisor ___; submission date ___; approved institutional format ___; ethics/site references **pending**. Draft revision: 10 October 2026.

This is an implementation-and-study draft, not a completed empirical dissertation. Participant research, licensed-dataset training, real camera/hardware trials and physical notification evaluation have not been established. Replace pending fields only with retained verified evidence. The [completion status](completion-status.md), [traceability matrix](proposal-traceability.md) and [evidence register](evidence-register.md) distinguish these categories.

## Abstract

CareConnect is an integrated research prototype comprising an authenticated web portal, patient/caretaker mobile applications, an API/database, optional prescription/photo providers and a privacy-aware edge pose worker. It supports prescription evidence review, exact medication schedules, deliberate wellbeing reporting, dietary assistance, medical records and accountable incident review. The edge pipeline processes camera frames in memory and submits permitted numeric observations, using experimental temporal event rules and an optional trainable pose-feature classifier. Consent leases, scoped access, generic push payloads, durable bounded retries and staff correction address implementation risks. Software and synthetic database checks verify selected behaviors; they do not demonstrate clinical reliability. This report specifies a mixed-method approved study to measure multilingual prescription performance, activity/expression errors, delivery/response timing, adherence, usability and privacy comfort. Numerical research findings remain pending, so no improvement or accuracy claim is made.

## 1. Introduction and problem

The proposal targets care facilities where handwritten prescriptions, medication coordination, wellbeing communication and timely caregiver response are difficult to manage with limited resources. An integrated system may make proposed readings, schedules and care requests easier to review. Its benefit must be measured alongside mistaken extraction, false/missed alerts, identity ambiguity, connectivity gaps and privacy concerns. The research problem is how to provide useful evidence and accountable response without presenting uncertain machine outputs as clinical conclusions.

The original questions are:

1. How accurately can computer vision extract and interpret handwritten and printed prescriptions, including medications and dose schedules?
2. Which OCR/NLP approaches are most effective for diverse handwriting and Tamil, Sinhala and English?
3. What challenges arise when integrating a smart prescription reader with real-time alerts in underfunded care facilities?
4. Can prescription, dietary and emotional support improve adherence and overall care?

Objectives concern expression support with caregiver alerts, prescription/reminder assistance, personalized dietary notifications and caregiver responsiveness. The supplied completion checklist adds continuous pose activity observation, temporal fall/inactivity candidates, edge deployment, consent and operational evaluation. [Traceability](proposal-traceability.md) states implemented coverage and remaining work for all 20 items.

## 2. Literature review

The [literature synthesis](literature-and-datasets.md) reviews ten checked primary sources: UCF101, Kinetics, TSN, I3D, ST-GCN, BlazePose, AffectNet, the FER2013 contest report, Donut and TrOCR. Video/sequence papers motivate temporal evaluation; pose estimation enables numeric edge evidence; expression datasets require careful interpretation; document transformers motivate OCR-free/OCR-based comparisons. Published benchmark performance cannot be assigned to CareConnect. Existing placeholder proposal references and unverified caregiver-improvement percentages must not appear as established findings. Dataset permissions, exact versions, rights and label compatibility remain to be approved.

## 3. Methodology

Use the [data collection protocol](data-collection-protocol.md) and [ethics/governance plan](ethics-and-data-governance.md): voluntary multilingual consent, interviews, caregiver preferences, ordinary observations, approved safe adult-volunteer scenarios and role-specific usability tasks. No older resident is asked to fall and care is never withheld. Proposed feasibility counts require supervisor/site justification and do not constitute a powered efficacy trial. All achieved recruitment/withdrawal counts are pending.

Maintain separate research consent, signed forms and pseudonymous manifests. Independent observers/annotators provide labels, agreement/adjudication and retained provenance. Group by participant, original recording/writer and duplicate content before splitting; freeze thresholds/models before the held-out test. Compare methods on the same independent examples and report language/class/subgroup support, abstention, missingness, clustering and uncertainty. A baseline/follow-up adherence comparison must preserve routine care and acknowledge self-report/confounding.

## 4. Design and implementation

The [architecture dossier](architecture.md) supplies component/trust-boundary, ER, use-case, activity and sequence diagrams. Web and two Expo clients use Firebase-authenticated scoped APIs and MySQL records. Optional local Donut and configured cloud prescription paths produce proposed readings requiring source review. Exact Asia/Colombo medication occurrences carry times, weekdays, dates and food instructions; patient/caretaker actions and bounded push attempts preserve status. Dietary suggestions and visible-expression outputs remain assistive and reviewable.

The registered edge worker uses supported OpenCV/Pi camera sources, a local MediaPipe pose model, anonymous tracking, measured posture/movement and temporal candidate rules. It closes capture without refreshed permission and stores only bounded numeric retry metadata. Single-person room assignment is an explicit assumption; ambiguous groups remain unknown. A staff-entered care-plan baseline adds explainable inactivity/night-movement context. The optional standardized balanced logistic-regression trainer uses pose features, not an implemented I3D/TSN/ST-GCN network; no trained activity weights are bundled. Resting does not establish sleep, and visible expressions do not establish actual emotion, disease or emergency.

Incidents retain original evidence and human actions: acknowledgement, false alarm, attribution correction, emergency contact and resolution. Provider receipt, in-app read and staff response are distinct. Three-language scope controls, append-only consent/audit, raw-frame avoidance, recipient rechecks and retention boundaries support privacy; production TLS/encryption/site permissions still require installation evidence. The [role/deployment guide](deployment-and-user-guide.md) covers setup and operation.

## 5. Testing and results

### 5.1 Software verification

The final [completion status](completion-status.md) records 10 October 2026 build, regression, startup, Python and rolled-back MySQL integration results. Tests cover constructed landmark transitions, permission/consent boundaries, event retry/queue behavior, medication occurrence uniqueness and source/recipient validation. Source-level assertions and synthetic database fixtures establish implementation behavior under their stated assumptions. Record the exact final command/version/source state and counts from that status; do not equate these tests with participant/model accuracy.

### 5.2 Empirical results: pending

| Required result | Evidence/value |
| --- | --- |
| Approved cohort, recruitment/declines/withdrawals, site and dates | Pending |
| Held-out multilingual prescription field/document accuracy and error severity | Pending |
| Same-set OCR/NLP comparator performance and runtime/cost | Pending |
| Activity class support/confusion/precision/recall/F1/coverage | Pending |
| Sequence fall sensitivity/specificity, misses and false alarms/hour | Pending |
| Separate expression accuracy/coverage and age/language/lighting limitations | Pending |
| Detection/server/provider/observed-phone latency, failures and p95 | Pending |
| Caretaker acknowledgement/resolution time and unresolved cases | Pending |
| Eligible-dose denominators and baseline/follow-up reported adherence | Pending |
| UAT completion/assistance/time and custom usability scores | Pending |
| Hardware availability/resources/endurance/connectivity gaps | Pending |
| Privacy/comfort themes, complaints and consent decisions | Pending |

Use the [metric definitions](testing-and-evaluation.md), registered thresholds and result template. Preserve denominator, participant count, confidence intervals and missing observations. An empty result is not zero error; a successful model export is not validated accuracy.

## 6. Discussion framework

After evidence collection, answer each original question using the matching outcome table. Discuss severe prescription errors and the cost of human review; report language/writer gaps instead of general multilingual claims. Explain facility costs, target-hardware resource limits, consent/network gaps, phone OS behavior and response responsibility. Assess any adherence/usability differences with baseline comparability, attrition, self-report and nonrandom confounding. Include negative feedback, abstention and missed/false alerts. Do not infer causality or clinical outcomes from feasibility questionnaires or operational incident counts.

## 7. Limitations and future work

Current limits include experimental pose rules, uncalibrated scores, absent trained activity weights, no local clinical test dataset, anonymous tracks that can switch, no reliable cross-camera identity, no sleep inference, no continuous pose/expression critical model, manual care-plan baselines and no automatic emergency call. SMS/Telegram and independently validated no-response rerouting are not implemented. Consent-revalidation failure intentionally creates observation gaps. Local medication fallback is time-limited; real push, physical camera, Pi/Jetson endurance, production encryption and cloud transactions require configuration and validation. Translation drafts need independent review. Dataset agreements and university/site approvals remain external work.

Potential future work is justified by measured errors: validated sequence models, improved uncertainty/calibration, approved local age-diverse cohorts, stronger bedside/occlusion handling, supported target-hardware acceleration, carefully approved identity methods if necessary, evaluated escalation policy and reproducible prospective studies. Do not add biometric/raw-video collection without separate review and explicit permission.

## 8. Conclusion

The repository supplies an integrated prototype and a reproducible study/validation plan. Its tested software behavior supports further supervised evaluation. The available evidence does not establish complete research fulfillment, clinical reliability, participant acceptability, model superiority or improved adherence/care. Those conclusions require the pending approved experiments.

## References and appendices

Use the ten primary entries and dataset agreements in [literature-and-datasets.md](literature-and-datasets.md), applying the university's required citation style. Append [diagrams](architecture.md), [protocol/instruments](data-collection-protocol.md), [consent/governance](ethics-and-data-governance.md), [evaluation/UAT](testing-and-evaluation.md), [installation/role manuals](deployment-and-user-guide.md), [20-item traceability](proposal-traceability.md) and restricted-evidence references from the [register](evidence-register.md). Do not attach identifiable media, signatures, private keys or participant records to a public submission/repository.
