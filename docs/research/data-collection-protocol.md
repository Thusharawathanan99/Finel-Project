# Primary data collection protocol and instruments

Version: draft 1, 10 October 2026. No participants have been recruited and no study results are recorded here. This protocol requires supervisor, university ethics and site review. Complete the [governance fields](ethics-and-data-governance.md) and approved [consent forms](index.md) before human participation. Refusal or withdrawal must not affect care.

## Design and recruitment

Use a mixed-method feasibility study: staff needs interviews, a preferences survey, consented ordinary activity observation, safe adult-volunteer simulations, usability tasks and an approved baseline comparison. Include the original proposal's prescription/multilingual, dietary and wellness questions alongside activity/alert integration. Keep consent for camera, activity, expression and research separate. No older resident is asked to fall, simulate collapse or change medication for this study.

Recruit through an authorized neutral site contact. Eligibility, capacity/representative procedure, languages, dates, compensation, exclusions and investigator contacts must be filled in the approved protocol. Record who was invited, eligible, consented, declined, withdrew and completed, using pseudonyms. Staff participation is voluntary and employer access to individual criticism must be restricted. Seek variation in caregiver role/experience, age, language, camera lighting and device conditions; disclose missing groups.

Proposed exploratory planning targets, **not collected counts or a powered clinical trial**, are 6–10 caretaker/supervisor interviews across roles, 20–30 caregiver preference questionnaires if the site can support them, and 12–20 consenting prototype users across the relevant roles/languages. Explain the feasible eligible population and planned variation to the supervisor. Review thematic sufficiency rather than declaring saturation from a fixed count. A small convenience sample limits generalization.

Choose activity observation hours and independent sequences from a pre-specified uncertainty goal, class coverage and safe feasibility, not by copying a model benchmark sample count. Frame-level repetition does not increase independent participant count. For a simple proportion, an initial planning approximation is `n ≈ 1.96² × p(1−p) / margin²`; this assumes independent observations and is inadequate alone for clustered residents/events or rare falls. The supervisor should approve a cluster-aware sample/precision calculation after an ethical pilot. Record assumptions and revise prospectively. No precision/power claim is made for the suggested feasibility counts.

## Session procedure

1. Check institutional/site permission and translated information; explain optional choices and withdrawal. Obtain signed consent and privately record capacity/representative evidence if required.
2. Assign a pseudonym and record only approved demographic/context fields. Keep the reidentification key and signatures outside the application export/repository.
3. Conduct interviews/survey without recording audio unless separately approved. Demonstrate the app with test records first. Record assistance, language and interruptions.
4. For ordinary camera observation, verify every assigned resident's active camera/activity permission, coverage, signage, visitors and pause controls. Synchronize clocks and log observation start/stop and gaps.
5. For safe simulations, use suitable consenting adult volunteers and an approved trained supervisor. Use ordinary standing, walking, sitting, intentional lying/resting, assisted-transfer substitutes and zone entry. Any safe floor-transition simulation needs the approved safety arrangement; exclude genuine fall induction, frail-resident simulations and unsupervised exercises. Stop for discomfort or unsafe conditions.
6. Independent observers label complete sequences from direct observation or separately approved recordings. Record disagreement and blinded adjudication; do not copy system labels. Under the default privacy mode, use observer timestamps and pose features rather than saving video.
7. Run role-specific usability tasks with fictional medical details. Do not ask anyone to ingest/skip a medicine. Confirm notification permissions and distinguish provider receipt, actual phone display and human acknowledgement.
8. Close with comfort feedback, withdrawal reminder and contact details. Record adverse events, missing observations, false/missed alerts and deviations. Securely transfer minimum approved data, verify deletion dates and provide normal care.

## Interview guide

Interview record: participant pseudonym ___; role ___; language ___; date/duration ___; interviewer ___; consent/reference ___; notes/audio permission ___; version ___. Ask open questions and neutral follow-ups:

1. How are prescriptions checked and medicines scheduled today? Which errors or unclear handwriting/languages are difficult?
2. How are allergies, dietary needs, appointments and changes in wellbeing communicated?
3. How do staff notice falls, prolonged inactivity or care requests? Describe the workflow without naming a resident.
4. What makes an alert useful or disruptive? Who should receive it, when, and through which available device?
5. What should happen when a phone/camera/network is unavailable or an alert receives no response?
6. Which information is necessary to verify an event? How should wrong identity and false alarms be corrected?
7. What camera, consent, privacy or expression-analysis concerns would residents/staff have?
8. What hardware, staff time, connectivity and recurring costs can the site support?
9. After trying the prototype, which tasks were easy/difficult and what would prevent use?
10. What changes should be made before a care-environment trial?

Do not prompt for a positive answer. Remove identifying anecdotes before thematic coding. Keep a coding memo, dissenting cases, researcher reflexivity and a deidentified quote-permission decision. Have a second reviewer inspect a subset; report the actual method and disagreements.

## Caregiver alert/preference survey

Record pseudonym, role, preferred language, experience band and whether the prototype was tried; all optional demographic disclosures follow approval. Use `1 = strongly disagree` to `5 = strongly agree`, plus `not applicable/prefer not to answer`:

| Item | Response |
| --- | --- |
| The current prescription-checking workflow is clear. | ___ |
| Unclear handwriting or language causes extra verification work. | ___ |
| Exact dose reminders would help my work. | ___ |
| Camera monitoring would be acceptable with separate consent and pause controls. | ___ |
| Numeric event evidence is sufficient to begin checking an alert. | ___ |
| I need a clear acknowledgement/escalation process. | ___ |
| Generic lock-screen text protects residents' privacy adequately. | ___ |
| I am comfortable using uncertain expression observations only with human verification. | ___ |

Choose permitted recipients (assigned caretaker/on-duty team/other approved role) ___; preferred information/warning/critical channel ___; quiet-hours exceptions ___; expected response process ___; maximum tolerable false-alert burden **as a preference, not an adopted safety limit** ___; main privacy concern ___; free comments ___. Report counts and distributions; this custom questionnaire is not a validated clinical instrument.

## Usability and comfort instrument

After the [UAT tasks](testing-and-evaluation.md), ask eight custom items on the same 1–5 scale: task navigation was clear; prescription uncertainty was understandable; dose actions were understandable; incident evidence was understandable; errors/retry instructions were understandable; consent choices were understandable; I could pause/withdraw; I would feel comfortable using the prototype in the described supervised setting. Include not applicable and optional free text.

Report each item's distribution and an exploratory mean across answered items with the denominator. Name it the **CareConnect custom usability questionnaire**, not SUS or a validated score. Use an approved independently sourced standardized instrument if the supervisor requires one; preserve its wording/scoring/licence and report it separately. Ask what worried participants and what should change; criticism is an outcome, not a failure to delete.

## Observation and baseline forms

| Sequence field | Value |
| --- | --- |
| Pseudonym/session/original recording ID, approved source and consent reference | ___ |
| Device/model/hash/config version, observer, date/time/timezone | ___ |
| Lighting, camera height/angle, occlusion/assistive device, room context | ___ |
| Start/end, independently labeled activity/event, observer certainty | ___ |
| System label/abstention, numeric score, detection/server/phone timestamps | ___ |
| False/missed candidate, identity ambiguity/correction, acknowledgement/resolution | ___ |
| Pause/network gap/adverse event/deviation and disposition | ___ |

Compare manual monitoring and the proposed system using the same approved independent scenarios or a prospectively defined observation-period design. Keep ordinary care in both conditions; do not hide an urgent event to create a baseline. Counterbalance task order when safe and feasible, record learning/carryover, workloads and network changes. Separate laboratory task results from facility outcomes.

Adherence comparison needs an approved care record: eligible prescribed dose count, reported taken/skipped/unknown, clinician-approved exclusions, baseline/follow-up period and participant attrition. App actions alone are self-reports. No medication intervention or causal benefit is assumed. [Metric definitions](testing-and-evaluation.md) describe denominators and uncertainty; the [evidence register](evidence-register.md) holds actual results once collected.
