# System architecture and diagrams

The diagrams describe the repository prototype. Cloud calls, push transport and hardware operation require configuration and separate end-to-end evidence. Authoritative implementation contracts are in `4-system-engine/api/schema.sql`, `schema_notifications.sql`, `routes/monitoring.js`, `routes/edge.js`, and `7-monitoring/README.md`.

## Components and trust boundaries

```mermaid
flowchart LR
  subgraph client[Authenticated user devices]
    W[React web admin and caretaker portal]
    P[Expo patient application]
    C[Expo caretaker application]
    F[Local facial-expression observation]
  end
  subgraph edge[Registered camera device]
    CAM[USB / IP / supported Pi CSI camera]
    G[Short consent lease and camera control]
    POSE[MediaPipe pose adapter]
    TRACK[Anonymous temporal tracks]
    RULE[Activity and temporal event rules]
    Q[SQLite metadata retry queue]
    H[Health telemetry]
    CAM --> G --> POSE --> TRACK --> RULE --> Q
    G --> H
  end
  subgraph backend[Protected server]
    API[Express API: identity, scope, validation]
    B[Manual care-plan anomaly rules]
    N[Medication schedule and notification worker]
    DB[(MySQL care records / incidents / audit)]
    OCR[Optional local Donut service]
  end
  AUTH[Firebase Authentication and Admin verification]
  CLOUD[Optional configured prescription / photo providers]
  PUSH[Expo push transport to FCM / APNs]
  W --> API
  P --> API
  C --> API
  P --> F
  W --> F
  API --> AUTH
  API --> DB
  API --> OCR
  API --> CLOUD
  B --> DB
  N --> DB
  N --> PUSH --> P
  PUSH --> C
  Q -->|HTTPS bearer token; numeric evidence| API
  H -->|HTTPS heartbeat| API
  API -->|Running / paused / stopped; consent lease| G
```

Raw pose frames stay in edge RAM. The camera pipeline stores numeric summaries, timestamps, anonymous track information and permitted room attribution; it does not store video or snapshots. This differs from explicit prescription/photo uploads in other modules, which need their own purpose and handling. Server credentials stay outside client bundles. Device token hashes are stored server-side; the one-time token belongs in the restricted edge environment file.

Camera capture fails closed when consent cannot be refreshed. Previously queued metadata may retry, but internet loss does not authorize continued capture. Queue capacity/expiry are bounded. This privacy choice creates a monitoring gap that staff must recognize and measure.

## Core ER diagram

```mermaid
erDiagram
  USERS {
    string id PK
    string role
    string resident_id
  }
  RESIDENTS {
    string resident_id PK
    string name
    string room_number
  }
  CARETAKERS {
    string caretaker_id PK
    string email
    boolean is_active
  }
  CARETAKER_RESIDENTS {
    string caretaker_id FK
    string resident_id FK
  }
  PRESCRIPTIONS {
    string prescription_id PK
    string resident_id FK
    date date_issued
  }
  MEDICATIONS {
    int id PK
    string prescription_id FK
    boolean confirmed
  }
  MEDICATION_SCHEDULES {
    int schedule_id PK
    string resident_id FK
    int medication_id FK
    json times
    date start_date
    date end_date
  }
  MEDICATION_REMINDERS {
    int reminder_id PK
    int schedule_id FK
    string resident_id FK
    datetime scheduled_at
    datetime presentation_at
    string status
  }
  PUSH_DEVICES {
    int device_id PK
    string owner_uid
    string token_hash
    boolean enabled
  }
  PUSH_DELIVERIES {
    int delivery_id PK
    int device_id FK
    string resident_id FK
    string status
  }
  MONITORING_DEVICES {
    string device_id PK
    string token_hash
    string camera_state
  }
  MONITORING_DEVICE_RESIDENTS {
    string device_id FK
    string resident_id FK
    datetime assigned_at
    datetime unassigned_at
  }
  MONITORING_CONSENTS {
    int consent_id PK
    string resident_id FK
    string scope
    string status
    datetime effective_at
  }
  ACTIVITY_EVENTS {
    string event_id PK
    string device_id FK
    string resident_id FK
    string activity
    datetime observed_at
    json evidence
  }
  MONITORING_INCIDENTS {
    int incident_id PK
    string event_id FK
    string device_id FK
    string resident_id FK
    string corrected_resident_id FK
    string status
  }
  MONITORING_INCIDENT_ACTIONS {
    int action_id PK
    int incident_id FK
    string actor_uid
    string action
  }
  CARE_NOTES {
    int note_id PK
    string resident_id FK
    string recorded_by_uid
  }
  ACTIVITY_BASELINES {
    string resident_id PK
    json baseline
    string model_version
  }
  AUDIT_EVENTS {
    int audit_id PK
    string actor_id
    string resource_type
    string resident_id
  }
  RESIDENTS ||--o{ USERS : profile_binding
  CARETAKERS ||--o{ CARETAKER_RESIDENTS : assigned
  RESIDENTS ||--o{ CARETAKER_RESIDENTS : supported
  RESIDENTS ||--o{ PRESCRIPTIONS : has
  PRESCRIPTIONS ||--o{ MEDICATIONS : contains
  MEDICATIONS ||--o| MEDICATION_SCHEDULES : scheduled
  MEDICATION_SCHEDULES o|--o{ MEDICATION_REMINDERS : generates
  RESIDENTS ||--o{ MEDICATION_REMINDERS : receives
  USERS ||--o{ PUSH_DEVICES : logical_owner
  PUSH_DEVICES ||--o{ PUSH_DELIVERIES : attempts
  RESIDENTS ||--o{ PUSH_DELIVERIES : relates
  MONITORING_DEVICES ||--o{ MONITORING_DEVICE_RESIDENTS : assignments
  RESIDENTS ||--o{ MONITORING_DEVICE_RESIDENTS : monitored
  RESIDENTS ||--o{ MONITORING_CONSENTS : append_only_history
  MONITORING_DEVICES ||--o{ ACTIVITY_EVENTS : observes
  RESIDENTS o|--o{ ACTIVITY_EVENTS : optional_attribution
  ACTIVITY_EVENTS o|--o| MONITORING_INCIDENTS : may_create
  MONITORING_DEVICES ||--o{ MONITORING_INCIDENTS : source
  RESIDENTS o|--o{ MONITORING_INCIDENTS : optional_subject
  MONITORING_INCIDENTS ||--o{ MONITORING_INCIDENT_ACTIONS : history
  RESIDENTS ||--o{ CARE_NOTES : documented
  RESIDENTS ||--o| ACTIVITY_BASELINES : configured_plan
  RESIDENTS o|--o{ AUDIT_EVENTS : logical_reference
```

This is a core relationship diagram, not the entire physical schema. Logical owner/audit/profile bindings do not necessarily have database foreign keys. Also present: appointments, doctors, allergies/conditions within resident fields, emotional self-reports, completed medications, notifications, reminder actions, complaints, meal plans, SOS/wellness alerts, monitoring zones, device health and schema migrations. A nullable resident means unknown; staff correction is recorded separately from the original observation. Consent/audit/incident retention differs from observation retention.

## Use cases

```mermaid
flowchart LR
  A[Administrator] --> D[Register device, assign room/residents, rotate token]
  A --> T[Set thresholds, zones and enabled activities]
  A --> R[Provision caretaker and view audit/report]
  A --> S[Start / pause / stop monitoring]
  K[Caretaker] --> I[Review, acknowledge, correct, resolve incident]
  K --> M[Review medication schedule and dose status]
  K --> B[Configure resident care-plan baseline]
  K --> N[Add care notes and view permitted medical record]
  P[Resident / authorized representative] --> V[Grant or withdraw separate consent scopes]
  P --> E[Self-report wellness / request urgent help]
  P --> O[Record taken / skipped / snooze]
  P --> L[View own prescriptions and appointments]
  Q[Researcher after approval] --> H[Analyze approved pseudonymized exports]
  D --> V
  H --> V
```

Researchers are a study role, not a broad production API role. Research exports need an approved process and minimum fields; production roles remain admin, caretaker and patient.

## Camera event and incident sequence

```mermaid
sequenceDiagram
  participant Edge as Edge worker
  participant API as Scoped API
  participant DB as MySQL
  participant Push as Push worker
  participant Staff as Caretaker
  Edge->>API: Request device config
  API->>DB: Check device, assignments and active consent
  API-->>Edge: Running state and short lease
  Edge->>Edge: Capture in RAM; pose quality; temporal confirmation
  alt Multiple people or ambiguous assignment
    Edge->>Edge: Keep anonymous / unknown attribution
  else One assigned resident and one observed person
    Edge->>Edge: Apply room-assignment assumption
  end
  Edge->>Edge: Persist metadata with stable event request ID
  Edge->>API: Submit event with numeric evidence
  API->>DB: Recheck consent and scope; idempotent transaction
  DB-->>API: Saved event and eligible incident
  API-->>Edge: Receipt; remove accepted queue item
  Push->>DB: Select relevant incident and permitted recipients
  Push->>Push: Send and later inspect provider receipt
  Staff->>API: Acknowledge / false alarm / correction / resolution
  API->>DB: Record actor, notes, timestamps and audit
```

Provider acceptance does not prove phone receipt, reading or care response. A fall rule candidate creates a reviewable incident; caretaker confirmation is a separate human action. Unknown tracks do not authorize a named critical conclusion.

## Medication sequence

```mermaid
sequenceDiagram
  participant Staff as Authorized staff
  participant API as API
  participant DB as MySQL
  participant Worker as Reminder worker
  participant Phone as Patient phone
  Staff->>API: Confirm source medication; exact schedule
  API->>DB: Save times, weekdays, dates, food instructions
  Worker->>DB: Materialize unique scheduled occurrences
  Worker->>DB: Queue due notification and scoped push
  Worker-->>Phone: Configured Expo transport
  Phone->>API: Taken / skipped / snoozed action
  API->>DB: Lock occurrence; save status/action
  alt Still overdue after configured delay
    Worker->>DB: Queue permitted caretaker escalation
  end
```

Actions record reported adherence, not witnessed ingestion. Occurrence uniqueness prevents duplicate records for the same scheduled time; it cannot physically prevent someone taking a second dose.

## Activity and model pipeline

```mermaid
flowchart TD
  START[Acquire fresh server consent lease] --> OK{Device running and every assigned resident consented?}
  OK -->|No| STOP[Close capture and clear affected queued metadata]
  OK -->|Yes| CAP[Read camera frame into RAM]
  CAP --> QUALITY{Required joints reliable and observation current?}
  QUALITY -->|No| RESET[Reset temporal evidence; abstain]
  QUALITY -->|Yes| TRACK[Anonymous geometric association]
  TRACK --> FEATURE[Extract tilt, knee angle, body ratio, normalized speed]
  FEATURE --> BASE[Posture / motion rules or optional trained classifier]
  BASE --> TIME[Temporal fall, collapse, inactivity, resting and path rules]
  TIME --> IDENT{Attribution unambiguous?}
  IDENT -->|No| UNKNOWN[Unknown anonymous observation]
  IDENT -->|Yes| EVENT[Room-assigned event with reason and model version]
  UNKNOWN --> QUEUE[Bounded SQLite metadata queue]
  EVENT --> QUEUE
  QUEUE --> API[HTTPS submission with consent recheck]
```

```mermaid
flowchart LR
  DATA[Licensed / approved independently labeled pose features] --> GROUP[Group by participant, original recording and duplicate hash]
  GROUP --> TRAIN[Approximately 70 percent training]
  GROUP --> VAL[Approximately 15 percent validation]
  GROUP --> TEST[Approximately 15 percent frozen test]
  TRAIN --> SCALE[Fit StandardScaler on training only]
  SCALE --> LR[Balanced logistic regression]
  LR --> VALID[Fixed classifier threshold; validation review]
  VAL --> VALID
  VALID --> FREEZE[Freeze artifact, threshold, seed and versions]
  FREEZE --> EVAL[One held-out test; confusion matrix and coverage]
  TEST --> EVAL
```

The classifier supports standing, walking, sitting, lying and resting. It is an optional research baseline, not an implemented I3D/TSN/ST-GCN network. The pose network estimates joints; the temporal rules infer event candidates. Fall performance needs independently labeled full sequences and non-fall observation hours, not frame-level posture accuracy. Emotion and prescription evaluation require their own models, labels and splits.
