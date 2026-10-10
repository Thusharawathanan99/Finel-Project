# CareConnect audit repairs

Repair review: 5 October 2026 (Asia/Colombo). Scope: the supplied 23-item audit, plus directly related defects found while checking the current source. The starting workspace already contained repairs and design changes; these were preserved, verified and strengthened.

## Audit findings

| # | Finding | Result in the repaired source |
|---|---|---|
| 1 | Authentication configuration granted development admin access | Missing credentials, absent/invalid tokens and failed permission lookups fail closed. Production has no implicit bypass. |
| 2 | Profile ID/role escalation | Roles come from protected SQL profiles or verified server admin claims. Users cannot alter another UID, upgrade their role or relink a resident. Registration is transactional and idempotent. |
| 3 | Resident read/update/delete ownership | Central authorization scopes resident and nested resource access to the owner, assigned caretaker or administrator. Resident deletion requires administrator authority. |
| 4 | Conflicting doses selected without review | API and both browser readers share reconciliation rules. Stronger evidence is provisional, conflicting values remain visible, and conflicts require review with confidence capped. |
| 5 | Fabricated Stable emotion on provider failure | Missing configuration, provider failure, timeout and invalid assessments return unavailability without a score or saved assessment. |
| 6 | Website caretaker SOS only saved in browser memory | Caretaker SOS persists through the authenticated SOS API for an assigned resident. Failed sends remain open with an error; admin polling reads server alerts. |
| 7 | Patient account reused another account's resident cache | Resident cache is bound to the authenticated UID, cleared on logout and protected against late lookups from another session. |
| 8 | Login profile failure overwrote an account | Login waits for verified role and resident link. Only an explicit 404 can enter atomic patient registration; server errors and other roles are rejected. |
| 9 | Gemini secret embedded in the mobile client | Direct client provider calls and the unused dependency were removed. AI uses authenticated server endpoints. Browser provider secrets were also removed and local settings migrated without displaying values. |
| 10 | Website signup orphaned Firebase identities | Caretaker selection is validated first; resident/profile/assignment registration is atomic. Definitive failures roll back new identities, while ambiguous responses are confirmed or safely retried. |
| 11 | Mood save did not update current website state | A successful emotion save adds the new state to the resident before refreshing. Failed saves leave existing history intact. |
| 12 | Prescription save retry left duplicate local rows | Local prescription publication occurs after successful persistence. A failed save leaves the review available for retry. |
| 13 | Chart displayed the oldest seven records | Latest-state lookup no longer mutates history; charts sort a copy and show the latest seven in chronological order. |
| 14 | Website actions were browser-only; appointments not hydrated | Resident/caretaker/system changes, profile saves and caretaker bookings await API success. Appointments are hydrated from the scoped API. Dashboard loads publish an intact snapshot or show a retry error. |
| 15 | Caretaker could not generate meal plans | The caretaker meal view has generation controls. Successful generation persists before display; failed generation/save reports an error. Meal replacement also persists before mutating the displayed plan. |
| 16 | Prescription image/result races in both mobile apps | Image changes are locked while processing. Request/session checks reject superseded results, including results after unmount. The website uploader also rejects stale image reads. |
| 17 | Caretaker app mixed configured and hardcoded API origins | Shared API helpers use one configured origin and authenticated headers across all screens. Website requests also honor the configured origin. |
| 18 | Medication day rollover reused yesterday/UTC state | Storage keys use the local calendar date and authenticated user. Missing daily data clears checkmarks; stale reads and failed writes are handled. |
| 19 | Password recovery controls had no action | Both mobile login screens invoke Firebase password reset with the entered email and display the result. |
| 20 | Caretaker profile showed undefined room | Profile rendering uses the server's `room_number` field. |
| 21 | Name-only merge discarded repeated dose schedules | Distinct dose/day regimens survive reconciliation and parsing; ambiguous alignment remains reviewable rather than being silently merged. |
| 22 | Food-instruction capture crashed | Instruction parsing uses the matched text safely and preserves schedule, duration and food instructions. |
| 23 | Mobile/all launcher omitted patient app | `app`, `mobile` and `all` include both patient and caretaker apps on separate ports. |

## Additional repairs

- Firebase UID/caretaker ID collisions resolve to the authenticated staff identity. Case-insensitive SQL UID matches cannot inherit another identity's permissions.
- Duplicate-email account provisioning, resident linking and caretaker reassignment use checks and transactions instead of silently altering unrelated records.
- Connection acquisition failures return an API error instead of leaving prescription requests unresolved.
- Website login, token resolution, response parsing and dashboard publication reject account changes. Sign-out invalidates pending loads; refreshing preserves the selected dashboard view.
- Server AI proxies validate text/images, bound requests/timeouts/concurrency and keep provider credentials out of release files. Healthcare NLP uses server OAuth.
- Missing prescription dates and confidence are not invented. Web/mobile save controls require explicit medicine verification and retain source evidence.
- Database utilities no longer guess embedded passwords. Default schema setup excludes demo inserts. Administrator provisioning has a read-only preview. Caretaker reset previews perform reads only.
- Credential JSON files are excluded from Git, and Docker mounts the Firebase account file as a secret.

## Validation and limits

The combined offline regression command passed all 176 scenarios:

| Suite | Passed |
|---|---:|
| Prescription, parser, emotion and launcher regressions | 57 |
| Authentication, authorization, API, setup and bootstrap regressions | 56 |
| Mobile regressions | 34 |
| Website persistence, loading and account-switch regressions | 29 |

An additional credential-isolation check passed across 164 client source/release files without displaying secret values. The full local run is recorded in `regression-results.log`.

Verified builds: standard website production build, both Expo web exports, and both Android JavaScript exports. The environment blocked the Hermes bytecode compiler, so Android exports used `--no-bytecode`; no signed APK was produced. Backend syntax checks and a schema dry-run passed without connecting to a database.

No real patient records were used. No database writes, account provisioning, caretaker reset or deployment was performed. Live MySQL transactions, Firebase permissions, provider availability, real-device camera/login and clinical extraction accuracy still need end-to-end validation with the configured services. The previously exposed Gemini credential must be rotated by its account owner.
