# Handoff — Production UI Slice 3: Teacher workflow thread (TCH-1/3/4/5/6)

**Date:** 2026-08-12
**Scope:** The Teacher persona's core loop in the production app — content → approve →
map → assessment → publish → dashboard — per `docs/Production_UI_Build_Plan.md` §12
step 3 (+ the curriculum sign-off gate it depends on). Additive; no domain service
changed. **Suite:** `npm test` → **279** (274 `services/api` + 5 `infra`); the same 274
pass **vs Postgres**; `npm run typecheck` clean (api + infra + app); `apps/app`
`vite build` clean; the whole thread was driven live in the browser (admin sign-off →
invite accept → upload → 5 governance steps → map → generate → review-ack → publish →
heatmap empty state).

## What was built
- **`services/api/src/http/teacherApi.ts`** — teacher-role-guarded (`TEACHER_ROLE_REQUIRED`),
  school-scoped `/api/v1` surface wrapping tested services only: content library/upload
  (server-side FNV content hash; per-item reject stays HTTP 200), per-step pipeline
  endpoints (ingest / classify / classification-approve / attest / approve — each an
  explicit teacher action, Decision 7), map-to-skills, skills node picker (honest
  `signedOff:false` state), assessments (list/generate/detail with grounding-source
  titles/ack/publish/unpublish), teacher classes + class mastery heatmap (synthetic
  students keep positional labels — no fabricated PII).
- **Admin skill-graph governance endpoints** (`adminApi.ts`): status / import-seed
  (draft, ADR-0015) / **sign-off by the signed-in admin** (the human action the program
  never self-certifies) + `configureCurriculum`. Surfaced as a "Curriculum skill graph"
  card on the Structure screen.
- **Invite list now returns `inviteToken`** for pending invites — the admin delivers
  the link out-of-band until real email transport exists (single-use; gone once accepted).
- **Branding READ opened to all school members** (config stays admin-only): white-label
  must theme teacher/student/parent surfaces too (found live — teachers got default
  branding; fixed + regression-tested).
- **`apps/app` Teacher UI:** role routing (teacher "Enter" → TeacherHome hub), Content
  Studio (upload + expandable pipeline rows, fixed governance chips, low-confidence
  classification warning, block reasons, skill mapping), Assessments (generate with
  shortfall/failed honesty, draft review with grounding sources, review-ack gate →
  publish → reversible unpublish), Class dashboard (student × skill heatmap: level as
  text + trend glyph + ●/★ flags — never colour-only; stale + no-data states).

## Files & wiring
- **New:** `http/teacherApi.ts`, `test/http-teacher-api.test.ts` (7 tests);
  `apps/app/src/screens/{TeacherHome,TeacherContent,TeacherAssessments,TeacherDashboard}.tsx`.
- **Changed:** `http/app.ts` (registerTeacherApi), `http/adminApi.ts` (graph endpoints,
  inviteToken, branding read guard), `apps/app/src/{App.tsx,api.ts,components.tsx
  (PageShell roleTag/backLabel),styles.css (heatmap)}`, `screens/{RoleHome,Structure}.tsx`,
  `docs/Production_UI_Build_Plan.md` (status).

## How to run / verify
`npm run dev:api` + `npm run dev:app` → http://localhost:5174. Create a school, sign off
the graph under **School structure → Curriculum skill graph**, invite a teacher (grab the
invite link token from `GET /api/v1/schools/:id/invites`), open `/?token=…`, and walk the
thread. Tests: `npm test` · `npm run test:pg-suite --workspace services/api` · `npm run
typecheck`.

## Deferred
TCH-2 (content detail/versioning), full TCH-3 (mapping overrides/bulk remap), TCH-7..18
(focus areas, cohorts, adaptive, peer, agent, reports, behavioural), student/parent/
principal personas, S-NOTIF, the a11y pass — each has a paste-ready prompt in the build
plan. Real teacher-class assignment UI (heatmap currently lists all school classes).

---

# Handoff — Production web app: School-Admin onboarding slice (FR-ADM / FR-ONB)

**Date:** 2026-08-11
**Scope:** First slice of the deferred production persona UIs (ADR-0012) — a fresh
production app (`apps/app`) rendering the School-Admin onboarding journey end-to-end.
Additive; no earlier milestone changed. Built at owner direction to test-drive a pilot.
**Suite:** `npm test` → **271** (266 `services/api` + 5 `infra`); the same 266 also pass
**vs Postgres**; `npm run typecheck` clean (api + infra + app); `apps/app` production
`vite build` clean; the flow was driven live over HTTP.

**Update (same slice, extended):** added **sign-in** for an existing admin
(`POST /api/v1/auth/login`, resolves school + campus) with a sign-in/create toggle on the
entry screen; and **account management** — a **People** screen that assigns roles
(`PATCH .../memberships/:id/role`, FR-ADM-002; Principal per campus, FR-ADM-007) and edits
names (`PATCH .../users/:id/name` -> new `AccountService.updateName`). The only-admin
demotion guard surfaces as a 409. Covered by 2 more `http-admin-api.test.ts` cases (5 total).

## What was built
- **Production HTTP surface** `services/api/src/http/adminApi.ts` under `/api/v1`
  (session-guarded, admin-scoped, same-school checked), wired into `buildApp`. Endpoints:
  onboarding/start, onboarding state, complete-step, enter-workspace, classes, invites,
  safeguarding, branding (get/set), summary. Only HTTP plumbing over tested services.
- **Admin self-registration** `AuthService.setInitialPassword` (validated + hashed +
  audited) so `POST /api/v1/onboarding/start` = createSchool + createAccount + password +
  login -> session.
- **Fresh production app `apps/app`** (React 19 + Vite, :5174, proxies /api -> :3000):
  design tokens (`theme.css`) split themeable BRAND (`--pf-brand*`) from fixed GOVERNANCE
  (`--gov-*`, never derived from brand — FR-WL-004 in the UI); screens Start (create
  school + admin), Onboarding (the 7-step "waypoint trail" with a panel per step:
  configure classes, invite teachers/students/parents, operations+branding, go-live with
  zero-teacher confirm), Workspace (live summary). Live white-label theming + AA-floor
  guardrail surfaced from the API.

## Files & wiring
- **New:** `http/adminApi.ts`, `test/http-admin-api.test.ts` (3 tests); `apps/app/*`
  (package.json, tsconfig, vite.config, index.html, src/{main,App,api,brand,components,
  theme.css,styles.css}, src/screens/{Start,Onboarding,Workspace}).
- **Changed:** `authService.ts` (+setInitialPassword, +NotFoundError import), `http/app.ts`
  (registerAdminApi), root `package.json` (+apps/app workspace, +dev:app), README, ADR-0031.

## How to run / verify
Two terminals: `npm run dev:api` then `npm run dev:app`, open http://localhost:5174.
Tests: `npm test` (269) · `npm run test:pg-suite --workspace services/api` (264) ·
`npm run typecheck`. Note: the dev API is in-memory, so data resets on restart. If :3000
is held by a stale server, free it before `dev:api`.

## Deferred
Remaining personas (Teacher/Student/Parent/Principal) + their feature screens; real logo
image upload UI; a formal WCAG 2.2 AA audit (NFR-A11Y-001) with automated a11y tests;
wiring the app to cloud (live Bedrock / RDS / S3). The HTTP `/api/v1` surface grows with
each new persona slice.

---

# Handoff — Appendix Milestone B — White-label / multi-tenant branding (FR-WL-001..004)

**Date:** 2026-08-11
**Scope:** The plan's Appendix Milestone B — configurable per-school branding, built on
the Decision-5 token split. Additive; no earlier milestone changed behaviour.
**Suite:** `npm test` → **266** (261 `services/api` + 5 `infra`); the same 261 acceptance
tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run test:db` → 8;
`npm run typecheck` clean.

## What was built
- **FR-WL-001 configure colour/logo** — `domain/branding.ts` (pure: WCAG-AA contrast
  maths + `autoAdjust`, SVG active-content scan, white-label resolution) + `services/
  brandingService.ts`. Brand colour validated against the AA floor; a failing colour is
  NOT saved — `configureBranding` throws `BrandContrastError` carrying an accessible
  `suggestion`. Logos: SVG with scripts/handlers/active content rejected
  (`LOGO_ACTIVE_CONTENT`); raster malware-scanned via the shared `ScannerPort`
  (`LOGO_INFECTED`); png/jpg/jpeg/svg only, <=25 MB. No config → default Pathfinder branding.
- **FR-WL-002 full white-label** — product-name override + attribution removal on `user`
  surfaces; `internal` surface ALWAYS resolves to the real Pathfinder identity
  (presentation-layer only); revert is going-forward, not retroactive.
- **FR-WL-003 consistency + point-in-time** — one `resolveBranding` drives app / report /
  email; `issueReport` snapshots branding into a persisted `BrandedReport` (`getReport`
  returns the original → never retroactively rebranded); logo-unavailable → text fallback
  (school name) via `brandingHeader`.
- **FR-WL-004 governance fixed** — `resolveBranding` always returns the frozen
  `GOVERNANCE_TOKENS`; no branding field/column can set a governance colour;
  `requestGovernanceOverride` is declined by design (`GOVERNANCE_TOKENS_FIXED`); AA floor
  re-clamped at resolve time (server-side regardless of stored value).

## Files & wiring
- **New:** `domain/branding.ts`, `ports/brandingStore.ts`,
  `adapters/memory/inMemoryBrandingStore.ts`, `adapters/postgres/pgBrandingStore.ts`,
  `services/brandingService.ts`, `db/migrations/0016_branding.sql`
  (`branding_configs` / `branding_logo_assets` / `branded_reports`), 4 test files
  (`m-b-wl-001..004`, 15 tests).
- **Changed:** `domain/errors.ts` (`BrandContrastError`); `context.ts` (wired
  `brandingStore` + `branding`); `test/helpers.ts` + `test-pg/pgSetupEach.ts` (pg store +
  truncate list); README, docs/decisions.md (**ADR-0030**), docs/traceability.md.

## Decisions / deferred
- ADR-0030. The **AA floor is white-on-primary** (the fixed on-primary text colour), not
  best-of-black/white — any solid colour clears AA against one of them (~4.58 min), so the
  meaningful floor is the pairing actually rendered. Enforced at BOTH configure and resolve.
- Real logo image **bytes + object store (S3, ap-southeast-2)** deferred; the sanitise +
  reference model is complete and test-covered. Governance override is structurally
  impossible, not just refused.

## How to verify
`npm test` (266) · `npm run test:pg-suite --workspace services/api` (261 vs Postgres) ·
`npm run test:db --workspace services/api` (8) · `npm run typecheck`. Migration 0016 is
ASCII-only and auto-discovered by the pg harness.

---

# Handoff — Appendix Milestone A — CSV import + SSO (FR-ADM-003 / FR-INT-001)

**Date:** 2026-08-11
**Scope:** The plan's Appendix Milestone A — resequenced out of M0. FR-ADM-003 (CSV
bulk import + SSO config) and FR-INT-001 (SSO sign-in). Additive; no earlier milestone
changed behaviour.
**Suite:** `npm test` → **251** (246 `services/api` + 5 `infra`); the same 246 acceptance
tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run test:db` → 8;
`npm run typecheck` clean.

## What was built
- **FR-ADM-003 CSV import** — `domain/csvImport.ts` (pure: RFC-4180-ish parser,
  per-row validation, `sanitiseCell`/`isFormulaInjection`, result types) + `services/
  csvImportService.ts` (`importUsers`, `exportUsersCsv`). Creates users/memberships/
  enrolments via the existing `AccountService` — **no new tables for import**. Malformed
  rows rejected with a specific error each; valid rows still import. Duplicate emails
  (system **or** in-file) flagged + skipped, no conflicting account. Formula-injection
  cells (`= + - @`, whitespace-stripped) neutralised with a leading `'` on import **and**
  export; the row imports **flagged for review**. Students are enrolled into the named
  class; class matched case-insensitively by name within the school.
- **FR-ADM-003 / FR-INT-001 SSO** — `domain/sso.ts` (`SsoProvider`, `SsoConfig`, domain
  helpers) + `ports/identityProviderPort.ts` (`IdentityProviderPort` + deterministic
  `LocalIdentityProvider` with `setOutage`/`suspend`) + `services/ssoService.ts`
  (`configure`, `signIn`). One provider + one domain per school (`sso_configs`, migration
  **0015**). Domain mismatch → `SSO_DOMAIN_MISMATCH` (clear message). IdP outage →
  `ServiceUnavailableError` code `SSO_IDP_UNAVAILABLE` (NOT an auth failure). Upstream
  revoked → deny `SSO_ACCESS_REVOKED` **and** `deleteSessionsByUser` so a stale session
  stops authorizing. Happy path issues a session, **no password created**.

## Files & wiring
- **New:** `domain/sso.ts`, `domain/csvImport.ts`, `ports/identityProviderPort.ts`,
  `services/csvImportService.ts`, `services/ssoService.ts`, `db/migrations/0015_appendix_sso.sql`,
  `test/appendix-adm-003-csv.test.ts` (5), `test/appendix-int-001-sso.test.ts` (4).
- **Changed:** `domain/errors.ts` (`AuthError` optional `code` default `"AUTH"`;
  new `ServiceUnavailableError`); `ports/dataStore.ts` + both adapters
  (`getSsoConfig`/`saveSsoConfig`, `deleteSessionsByUser`); `context.ts` (wired `idp`,
  `csvImport`, `sso`; hoisted `accountService`); `test-pg/pgSetupEach.ts` (added
  `sso_configs` to TRUNCATE); README, docs/decisions.md (**ADR-0029**), docs/traceability.md.

## Decisions / deferred
- ADR-0029. Real Google/Microsoft **OIDC verification + directory lookup is deferred**
  (like Bedrock, ADR-0013): the port, guards and edge-case tests exist; only the live
  network provider is unwired. The `LocalIdentityProvider` stays in-memory in **both**
  store backends (like the audit recorder).
- Chose to store SSO as one-provider/one-domain per school (the MVP shape). CSV import
  reuses `AccountService` rather than a bespoke path, so account-creation invariants
  (audit, PII isolation) are shared.

## How to verify
`npm test` (251) · `npm run test:pg-suite --workspace services/api` (246 vs Postgres) ·
`npm run test:db --workspace services/api` (8) · `npm run typecheck`. Migration 0015 is
ASCII-only and auto-discovered by the pg harness. If the pg-suite fails at cluster start,
kill a stray `postgres.exe` (holds port 5439).

---

# Handoff — Milestone 11 — Governance / audit hardening pass  (MVP COMPLETE)

**Date:** 2026-08-11
**Milestone:** 11 — Governance / audit hardening — **COMPLETE**. Milestones 0-11 done.
**Suite:** `npm test` → **242** (237 `services/api` + 5 `infra`); the same 237
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The red-team (two failure modes) — no path found

- **AI content -> student without teacher action** (`m11-redteam.test.ts`): every
  AI-content path is draft/blocked (assessment student-denied until published; agent
  drafts never auto-send; focus material AUTO_ASSIGN_BLOCKED; inference withheld until
  approved; unpublish revokes delivery).
- **Principal surfaces expose transcripts**: a back-door hunt seeds a real transcript
  with a unique marker and asserts it appears in none of teacherReport / masteryOverview
  / drillClass / drillStudent / exportReport / schoolReport.

## What was verified / hardened (every M11 requirement)

- **FR-GOV-002**: AI choke point audits BEFORE the provider runs -> a logging failure
  throws and blocks the action (verified: throwing recorder blocks; provider never
  runs). AI calls log grounding provenance (ids only).
- **FR-GOV-003**: `GovernanceService.runRetention` deletes aged Ask-for-Help data and
  logs its own `retention.deleted`.
- **FR-GOV-006**: `exportStudent` (human-readable) + `eraseStudent` (PII removed,
  audited facts kept, hash chain preserved via id-only audit rows; active records ->
  confirm).
- **FR-GOV-007**: per-call re-validation + `pauseForDrift` -> `AI_PAUSED`.
- **FR-GOV-005**: publish requires items reviewed; records review-duration + items-opened;
  `approvalQualityPrompt` non-blocking bulk spot-check.
- **NFR-COST-001**: per-actor fair-use cap -> `COST_CAP_REACHED`.
- **NFR-SEC-001/002, NFR-AUD-001, NFR-PRV-002, NFR-SAF-001, FR-SAF-002** verified by test.

## New this milestone (governance mechanisms only)

`GovernanceService` (retention + data-subject export/erasure), AI service-layer
hardening (audit-before-complete already blocked; added `pauseForDrift`/`resume`,
per-actor usage cap, provenance field), `AssessmentService.approvalQualityPrompt` +
publish review metadata, `WorkspaceStore.deleteHelpMessagesBefore`, `SchoolPolicy.retentionDays`,
migration `0014_governance.sql`.

## Deferred / documented (honest limitations)

- **NFR-A11Y-001 (WCAG 2.2 AA)** is a UI conformance requirement; the production
  persona screens are deferred (ADR-0012). It remains a build requirement for those
  screens; the fixed governance/brand design tokens carry the contrast floor.
- **NFR-PERF-001** full latency/load targets are runtime SLOs (load-tested at deploy);
  the testable "always resolves to a terminal status, never hangs" invariant is covered
  (M1 NFR-PERF-001 test).
- Live Bedrock verification (ADR-0013); actual AWS provisioning; the production
  design-system UI screens; FR-ADM-003 CSV/SSO + FR-INT-001 (plan-resequenced appendix).

## Next

**The MVP build (Milestones 0-11) is complete.** The Section 5 validation checkpoint
(evidence pilot teachers publish AI-drafted assessments with real edit rates and act
on suggestions) remains the real-world gate before scaling. Remaining plan items are
the Appendix (FR-ADM-003 CSV/SSO, FR-INT-001) and productionisation (live Bedrock, AWS
provisioning, the design-system UI). Do not build ahead without direction.

---

# Handoff — Milestone 10 — Reporting

**Date:** 2026-08-11
**Milestone:** 10 — Reporting (academic, co-curricular, behavioural/social) — **COMPLETE**
**Suite:** `npm test` → **223** (218 `services/api` + 5 `infra`); the same 218
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The gate (behavioural/social)

The plan flags behavioural/social as needing a pre-build policy sign-off; the v1.3
MVP default is implemented exactly (a school may tighten, not loosen). Behavioural
data is a **separate model** from academic mastery; the four categories only; **no
AI inference** (no auto-scoring code path; `autoScore()` throws
`BEHAVIOURAL_INFERENCE_BLOCKED`); **collection is consent-gated**
(`CONSENT_NOT_CONFIGURED` until `configureConsent`); per-persona visibility (author
Teacher + Admin notes, Principal aggregate, Parent hidden until enabled). The gates
live on `school_policies`.

## What was built (every acceptance row tested — 13 rows)

- **FR-REP-001** (`m10-rep-001-teacher.test.ts`) — growth report reflects mastery
  change; partial-term flagged limited/early.
- **FR-REP-002** (`m10-rep-002-principal.test.ts`) — school-level aggregate; prorated
  partial-month cost.
- **FR-REP-004** (`m10-rep-004-parent.test.ts`) — strengths/focus/comments; no-comments
  section omitted.
- **FR-CAP-002** (`m10-cap-002-cocurricular.test.ts`) — co-curricular in its own simpler
  structure, separate from academic; no-data omitted; free-text skill (no node id).
- **FR-BSS-001/002** (`m10-bss-observations.test.ts`) — teacher-authored + separate;
  inference blocked + four-categories-only; per-persona visibility; consent gate.

## New this milestone

`domain/reporting.ts` (co-curricular / behavioural / comment / licence types + cost
proration), `ReportingStore` port (in-memory + Postgres), `BehaviouralService`,
`CoCurricularService`, `ReportingService`, migration `0013_reporting.sql`, and
`SchoolPolicy` extended (`behaviouralConsentConfigured`, `behaviouralParentVisible`;
both the M9 and M10 policy setters read-modify-write to preserve each other's gates).

## Deferred (M10)

- Reporting screens in the preview console (UI still deferred generally).
- "turnaround" and richer usage/cost analytics (usage is an assessment/agent-draft
  proxy; NFR-COST-001 AI usage guardrails are M11).

## Next

The plan's next code milestone is **Milestone 11 — Governance / audit hardening pass**
(FR-GOV-001..007, FR-SAF-002, NFR-PERF-001, NFR-COST-001). **This is the non-negotiable
gate before any real-student pilot**, regardless of the Section 5 checkpoint outcome.
Do not build ahead without direction.

---

# Handoff — Milestone 9 — Principal Dashboard (school-level)

**Date:** 2026-08-11
**Milestone:** 9 — Principal Dashboard — **COMPLETE**
**Suite:** `npm test` → **210** (205 `services/api` + 5 `infra`); the same 205
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The non-negotiable, and how it's guaranteed

Ask-for-Help transcripts are **unreachable from every Principal surface including
exports**. This is structural: `PrincipalDashboardService` never calls a
help-session/help-message method and no type it returns carries transcript content.
A **back-door test** seeds a real transcript with a unique marker and asserts it
appears in NONE of teacherReport / masteryOverview / drillClass / drillStudent /
exportReport.

## Refined M7 rule (per the M9 clarification)

M7 previously blanket-denied anyone with a principal role. Now the only allow path
for `AskForHelpService.transcript` is the assigning teacher (`viewerId ===
session.teacherId`). So a **dual-role Principal-Teacher reads transcripts for their
own classes via Teacher capacity**, a pure Principal is denied
(`NOT_ASSIGNING_TEACHER`), and Principal surfaces still never expose transcripts.
(M7 test updated.)

## What was built (every acceptance row tested — 15 rows)

- **FR-PDB-001** (`m9-pdb-001-teachers.test.ts`) — per-teacher + school-wide metrics;
  low-activity outlier flagged; new teacher shorter-window/not-unfairly-compared.
- **FR-PDB-002** (`m9-pdb-002-mastery.test.ts`) — school-wide mastery; outlier class
  highlighted.
- **FR-PDB-003** (`m9-pdb-003-drill.test.ts`) — drill school→class→student; cross-campus
  refused (`OUT_OF_MVP_SCOPE`); Ask-for-Help excluded at deepest drill.
- **FR-PDB-004** (`m9-pdb-004-alerts.test.ts`) — sharp-drop alert; seasonal break
  suppressed; sub-threshold no-fatigue.
- **FR-PDB-005** (`m9-pdb-005-privacy.test.ts`) — back-door hunt; dual-role via Teacher
  capacity only.
- **FR-PDB-006** (`m9-pdb-006-policy.test.ts`) — comparison view policy-gated; enable
  mid-term applies going forward.

## New this milestone

`domain/principal.ts` (metrics/overview/alert/policy types + `PRINCIPAL_THRESHOLDS`),
`PrincipalDashboardService` (deliberately NO help-store access), `school_policies` +
DataStore policy methods, an additive `edited` flag on `agent_suggestions`
(`editDraft` sets it; makes the AI edit-rate real), `WorkspaceStore.listTasksByTeacher`,
migration `0012_principal.sql`. The M0 `PrincipalService` (FR-ADM-007) is untouched;
the M9 service is `ctx.principalDashboard`.

## Deferred (M9)

- Principal screens in the preview console (UI still deferred generally).
- Turnaround-time metric is a workload proxy (no explicit turnaround timestamps yet).

## Next

The plan's next code milestone is **Milestone 10 — Reporting (academic, co-curricular,
behavioural/social)**. NOTE the behavioural/social piece has a **pre-build policy
sign-off requirement** and a defined MVP default (four observation categories only —
collaboration/communication/resilience/participation — teacher-authored notes, NO AI
inference; visibility defaults per persona; collection disabled until a school's
parental-consent mechanism is configured). The Section 5 checkpoint and M11 governance
verification still gate a real-student pilot. Do not build ahead without direction.

---

# Handoff — Milestone 8 — Parent Dashboard

**Date:** 2026-08-11
**Milestone:** 8 — Parent Dashboard — **COMPLETE**
**Suite:** `npm test` → **195** (190 `services/api` + 5 `infra`); the same 190
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The gate

FR-PAR-003's "no data until verified / never cross-student" had **no underlying
model** — only an `invite.parent` type and a `link-child` onboarding step name.
Built `ParentChildLink` + verification (`ParentStore`, migration 0011); a single
`requireVerified` guard covers both the unverified-relationship and cross-student
rows (unverified OR unlinked studentId → `AuthError`, no data).

## What was built (every acceptance row tested — 12 rows)

- **FR-PAR-001/005** (`m8-par-001-dashboard.test.ts`) — plain-language summary
  (strengths/focus/activity); no-recent-activity stated plainly; jargon translated
  (`plainTopic` → topic words, never node ids/codes).
- **FR-PAR-003** (`m8-par-003-access.test.ts`) — one verified child only; two
  children never merged; **never diagnostic** (guarded + tested specifically);
  unverified → no data.
- **FR-PAR-006** (`m8-par-006-calendar.test.ts`) — child-scoped calendar; different
  year groups → separate calendars.
- **FR-PAR-004** (`m8-par-004-cadence.test.ts`) — one weekly consolidated digest;
  nothing when nothing; safeguarding escalates immediately (M7 route), never via the
  parent digest, no separate urgent class.

## Safety / governance notes

Summaries go through the AI service layer (`parent.summary`, audited) from factual
mastery/activity; a `containsDiagnosticLanguage` guard replaces the text with an
observational fallback if any clinical term slips through. Synthetic students hold
no PII and have no parent link → never appear on a parent surface (M4 quarantine).
AI *claims* about a student still pass the approvable-state gate before reaching a
parent.

## New this milestone

`domain/parent.ts` (link + `containsDiagnosticLanguage` + `plainTopic`),
`ParentStore` port (in-memory + Postgres), `ParentService`, migration `0011_parent.sql`,
`parent.summary` provider purpose, `parent.digest` notification type, and
`parent_meeting` added to `CalendarEventType`.

## Deferred (M8)

- A real parent-verification workflow (M8 has the Admin create + verify the link).
- Parent screens in the preview console (UI still deferred generally).

## Next

The plan's next code milestone is **Milestone 9 — Principal Dashboard (school-level)**
(FR-REP-001/002/004 — teacher/school reports, cost/usage; school-level only, never
cross-school). The Section 5 checkpoint and M11 governance verification still gate a
real-student pilot. Do not build ahead without direction.

---

# Handoff — Milestone 7 — Student Workspace + Ask for Help (highest-risk)

**Date:** 2026-08-11
**Milestone:** 7 — Student Workspace + Ask for Help — **COMPLETE**
**Suite:** `npm test` → **183** (178 `services/api` + 5 `infra`); the same 178
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The gate (verified, not assumed)

The kickoff asserted "the safeguarding configuration step exists in Admin
onboarding." It did NOT: onboarding had a generic `configure-operations` step but
**no safeguarding data model**. Surfaced and built: `SafeguardingConfig` (contact,
role, SLA, after-hours policy) set at `configure-operations`; **Ask for Help
hard-refuses for any school without it**. Also added the missing `ClassRoom.yearGroup`
(FR-STU-004 restricted events). ADMIN_STEPS unchanged (no M0 breakage).

## What was built (every acceptance row tested — 11 rows + safety/gate/adversarial)

- **FR-STU-001/003** (`m7-stu-001-dashboard.test.ts`) — low-analytics dashboard;
  "nothing assigned yet"; overdue without shaming + teacher notified once.
- **FR-STU-004** (`m7-stu-004-calendar.test.ts`) — calendar; wrong-year-group events
  invisible; reschedule flagged changed.
- **FR-STU-002/SAG-001/002** (`m7-sag-help.test.ts`) — grounded hints never the
  answer; **assessment lockout at the task-state layer**; off-topic redirect;
  direct-answer refusal; **transcripts teacher-only, Principal hard-denied**; safety
  filter (unsafe/diagnostic) blocked+logged; safeguarding disclosure escalates to the
  configured contact; no-config gate.
- **Adversarial** (`m7-sag-adversarial.test.ts`) — >100 extraction attempts, ≥95%
  refused, 0% leak; off-topic redirection ≥95%.

## Safety design (why it's safe to ship)

The student message is **never** sent to the model; the tutor only ever receives the
task's grounding chunk + topic and is asked for a hint — so it structurally cannot
leak an answer. The assessment lockout and the safeguarding-config gate are decided
in application state before any AI call. Off-topic/direct-answer/unsafe/safeguarding
are deterministic, priority-ordered classifiers (`domain/askForHelp.ts`).

## Independent verification (DoD)

An independent reviewer (separate agent, did not build it) adversarially reviewed the
Ask-for-Help path: all six non-negotiables PASS. It surfaced one real safety-cost gap
— the safeguarding lexicon missed paraphrases ("abuses me", "beats me", "neglected")
— now fixed and covered by a new test.

## New this milestone

`domain/safeguarding.ts`, `domain/studentWorkspace.ts`, `domain/askForHelp.ts`;
`WorkspaceStore` port (in-memory + Postgres); `SafeguardingService`,
`StudentWorkspaceService`, `AskForHelpService`; DataStore safeguarding-config
methods; `ClassRoom.yearGroup` + `createClass` param; `help.hint` provider purpose;
`alert.overdue` / `alert.safeguarding` notification types; migration
`0010_student_workspace.sql`.

## Deferred (M7)

- Full FR-SAF-002 disclosure workflow (Milestone 11); M7 logs + escalates to the contact.
- Student/peer/agent screens in the preview console (UI still deferred generally).
- Minor review notes (accepted): session `teacherId` snapshot at creation; off-topic
  overlap keys off the task title only (biases toward safe over-refusal).

## Next

The plan's next code milestone is **Milestone 8 — Parent Dashboard** (parent cadence
/ digest via the notification service; safeguarding items escalate immediately via
FR-SAF-002, everything else in the digest). The Section 5 checkpoint and M11
governance verification still gate a real-student pilot. Do not build ahead without
direction.

---

# Handoff — Milestone 6 — Teacher Agent

**Date:** 2026-08-11
**Milestone:** 6 — Teacher Agent — **COMPLETE**
**Suite:** `npm test` → **165** (160 `services/api` + 5 `infra`); the same 160
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## Checkpoint note (read first)

Milestone 5 completed the validation MVP, and the plan puts a **formal validation
checkpoint (Section 5)** before M6–M11. M6 was built **at the product owner's
explicit direction**, proceeding past that checkpoint. The checkpoint is a
pilot/business gate (evidence pilot teachers publish AI-drafted assessments with
real edit rates and act on suggestions), not a code milestone — and M11's
governance verification stays non-negotiable before any real-student pilot.

## What was built (every acceptance row tested — 9 rows)

The Teacher Agent (`AgentService`) drafts through the single AI service layer
(every call audited); the deterministic local provider gained an `agent.generate`
purpose (live Bedrock still deferred, ADR-0013).
- **FR-TAG-001/002** (`m6-tag-001-planning.test.ts`) — unit sequence / lesson plan
  grounded in approved content; **no grounding content → declined honestly**;
  no capability data → **generic differentiation, labelled not-yet-personalised**.
- **FR-TAG-003** (`m6-tag-003-drafts.test.ts`) — parent summary / feedback are
  **editable drafts, never auto-sent**, persist unsent (a year later still there);
  **behavioural/social observations separated + flagged**, never inlined into the
  academic body.
- **FR-TAG-004** (`m6-tag-004-grounding.test.ts`) — every suggestion **shows its
  grounding** (no exceptions); **all** sources listed; a source **archived after
  the fact keeps a (now-archived) reference**, not a broken link.

## New this milestone

`domain/agent.ts` (AgentSuggestion / GroundingRef / SensitiveSection / AgentResult),
`AgentStore` port (in-memory + Postgres), `AgentService`, migration `0009_agent.sql`
(`agent_suggestions`, grounding + sensitive sections as jsonb), and an
`agent.generate` branch in `LocalClassifierProvider`.

## Deferred (M6)

- Agent screens in the preview console (UI still deferred generally).
- Actually sending parent comms (M8); M6 drafts persist unsent only.
- Behavioural taxonomy + consent gate (later); M6 takes structured observations
  with a category and separates/flags them.
- A persisted student link on suggestions (arrives with M8 parent comms).

## Next

Return to the **Section 5 checkpoint** (real-world validation) unless the owner
directs otherwise. The plan's next code milestone is **Milestone 7 — Student
Workspace + Ask for Help** (note: FR-SAF-002 safeguarding workflow requires legal
review before M7 builds against it; Ask-for-Help guarantees are state-layer
enforcement + an adversarial test suite). Do not build ahead without direction.

---

# Handoff — Milestone 5b  (Milestone 5 complete — CHECKPOINT NEXT)

**Date:** 2026-08-11
**Milestone:** 5b — Peer Benchmarking, Peer Review & Peer Testing — **COMPLETE**
**Suite:** `npm test` → **156** (151 `services/api` + 5 `infra`); the same 151
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The gate

No false external precondition — 5b's precondition ("5a passes") is genuinely met.
Modeling decisions were surfaced and recorded (ADR-0022): peer-test submissions
carry the graded score (auto-grading is out of 5b scope); "calendar" is
represented by per-student dashboard **placements** (full calendar = M7); the
`locked-computed` design token becomes load-bearing; provisional
`PEER_THRESHOLDS.minCohort` = 5 (re-validate after M7).

## What was built (every acceptance row tested — 19 rows)

The plan's hard constraint held throughout: **a genuinely separate
publish-or-withhold code path**, never edit-then-approve, no reuse of the
"AI draft, editable" component.
- **FR-PEER-001** (`m5b-peer-001-benchmark.test.ts`) — teacher-facing percentile
  bands; softened non-ranked student signal (no rank/figure/named peer);
  small-cohort suppression; withheld by default.
- **FR-PEER-002** (`m5b-peer-002-review.test.ts`) — anonymised peer review;
  approve/reject before release; reject-not-rewrite (moderate has no text param);
  anonymity-risk flag; zero-reviews neutral state.
- **FR-PEER-003** (`m5b-peer-003-builder.test.ts`) — builder; accommodation-vs-
  anonymity tension warning; insufficient-content shortfall (not a silent thin test).
- **FR-PEER-004** (`m5b-peer-004-delivery.test.ts`) — launch → dashboard/calendar
  placements; cohort locked at launch; clean cancellation.
- **FR-PEER-005** (`m5b-peer-005-results.test.ts`) — completion + benchmark +
  explicit publish decision; partial-completion rate; **edit blocked → logged
  correction path only** (original submission untouched, correction audited);
  never-published → no auto-release even after a year.

## New this milestone

`domain/peer.ts` (types + `PEER_THRESHOLDS` + `computeBenchmark`/`softenedSignalFor`/
`anonymityRisk`), `PeerStore` port (in-memory + Postgres), `PeerTestService`,
`PeerReviewService`, migration `0008_peer.sql` (peer_tests / submissions /
corrections / reviews / placements, with status + publish CHECK constraints).
A cross-backend bug was caught and fixed: two peer schools in one test collided on
the shared Postgres DB → `setupPeerClass` now uses a unique school name.

## Deferred (M5b)

- Peer screens in the preview console (UI still deferred generally).
- Auto-grading of peer-test answers (out of 5b scope — submissions carry scores).
- Full student calendar (M7); placements stand in for the dashboard/calendar entry.

## Next — the validation checkpoint (Section 5), NOT M6

Milestones 0–5 are the validation MVP. Before any M6–M11 work there is a **formal
checkpoint**: evidence that pilot teachers publish AI-drafted assessments with
meaningful edit rates (not rubber-stamps) and act on class-focus/cohort
suggestions. Do NOT build ahead of the checkpoint. Milestone 11's governance
verification remains non-negotiable before any real-student pilot regardless of
checkpoint outcome.

---

# Handoff — Milestone 5a

**Date:** 2026-08-10
**Milestone:** 5a — Teacher Dashboard, Class-Focus, Cohorts, Adaptive Engine — **COMPLETE**
**Suite:** `npm test` → **137** (132 `services/api` + 5 `infra`); the same 132
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## The gate (verify-don't-fabricate, again)

No false *external* precondition this time — but verifying the M4 seed against
every 5a Given/When/Then row surfaced a real **substrate gap**: as committed the
seed didn't exercise four scenarios — *trend* (one snapshot per pair, no series),
*conflicting signals* (no independent-vs-assisted dimension), the *class focus
area* happy path + *content gap* (random scores, no deterministic weak skill), and
the *5-student misconception group* (the seed made 4). Rather than fake a passing
test, the M4 substrate was **extended additively** (ADR-0020) and each 5a edge was
**planted deterministically** in the seed, the same way M4 plants its edges. M4's
quarantine schema/thresholds are untouched and **all M4 tests stay green** (still
25 students, same small-cohort/stale/insufficient edges).

## What was built (every acceptance row tested)

- **FR-TDB-001 / FR-CAP-001** (`m5a-tdb-001-dashboard.test.ts`) — per-student,
  per-skill heatmap + intervention/extension flags; brand-new class → explicit
  "not enough data yet"; fluctuating student → **down trend** (not just the latest
  point). `TeacherDashboardService.heatmap`.
- **FR-TDB-002** (`m5a-tdb-002-focus.test.ts`) — class focus area with suggested
  approved material; **content-gap** prompt when none mapped; dismissed suggestion
  hidden next session but **reappears when data worsens**; **auto-assign blocked**
  at the platform level (`AUTO_ASSIGN_BLOCKED`) — assignment needs a real Teacher
  actor + is audited.
- **FR-COH-001 / FR-COH-002** (`m5a-coh-groups.test.ts`) — 5-student shared-
  misconception group; a student in **both** extension + peer-learning; removing a
  student before assigning excludes them; **stale-data** group labelled.
- **FR-ADP-001 / FR-ADP-002** (`m5a-adp-adaptive.test.ts`) — strong mastery →
  extension; **persistent misconception → escalate** to the Teacher (dashboard +
  `alert.teacher` notification) instead of looping remediation; **conflicting
  signals** → reassessment weighing both, not the latest score; **spaced-revision
  deferred** while an assessment is in progress.

## New this milestone

Domain: `domain/insights.ts` (types + `DASHBOARD_THRESHOLDS`, provisional), two
additive nullable fields on `MasteryRecord` (`history`, `assistedScore`). Ports:
`DashboardStore` (in-memory + Postgres). Services: `TeacherDashboardService`,
`CohortService`, `AdaptiveEngine`. Migration `0007_dashboard.sql` (alters
`mastery_records`; adds `focus_dismissals`, `group_assignments`).
`AssessmentStore.listAttemptsByStudent` added. Seed (`SyntheticService.seedClass`)
extended with M5a landmarks in `SeedSummary`. `alert.teacher` notification type
(first Milestone 5 consumer of the single notification service).

## Deferred (M5a)

- **Milestone 5b** — peer benchmarking/review/testing (separate publish-or-withhold
  path); begins only now that 5a passes.
- Re-validating the provisional dashboard/tuning thresholds against real data
  (after Milestone 7).
- Audit/notifications persisted to Postgres (still in-memory in both modes).
- Web UI screens for these surfaces.

## Next — Milestone 5b, then the checkpoint

5b completes Milestone 5. After Milestone 5 there is a **formal validation
checkpoint** (evidence pilot teachers publish AI-drafted assessments with real
edit rates and act on class-focus/cohort suggestions) before the M6–M11 expansion.
Do not build ahead. Pattern to keep: read the plan section, verify any asserted
gate is real, one test per Given/When/Then row, keep both backends green, then
docs + commit + push.

---

# Handoff — Milestone 4

**Date:** 2026-08-09
**Milestone:** 4 — Seed synthetic student activity — **COMPLETE**
**Suite:** `npm test` → **122** (117 `services/api` + 5 `infra`); the same 117
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## What was built (engineering task — no FR IDs)

`SyntheticService.seedClass` seeds ~25 synthetic students in a class with varied
mastery/misconception patterns across the mapped skills (deterministic PRNG),
deliberately including the M5 edges: small-cohort (a rare skill touched by ≤3
students), stale-data (first 5 students), persistent-misconception (students 5–8),
insufficient-data (a few mastery pairs below the min). New `ActivityStore` port +
in-memory + Postgres adapter (`mastery_records` / `misconception_signals`),
migration `0006_synthetic_activity.sql`, `users.synthetic` flag.

## Quarantine (enforced as requirements, tested)

- **Schema-level flag** `users.synthetic`; synthetic students hold **no PII**.
- **Excluded from real/export/parent surfaces** — `exportRealStudents`,
  `realMastery`.
- **Deletable before go-live** — `deleteSyntheticStudents` cascades (activity,
  enrolments, memberships, user) and audits; real accounts untouched.
- **Thresholds recorded** (`SYNTHETIC_THRESHOLDS`, `provisional: true`,
  `revalidateAfterMilestone: 7`) — not frozen.

## Deferred

- Actual dashboards/cohorts that consume this data — Milestone 5a.
- Re-validating the tuning thresholds against real data — after Milestone 7.

## Next — validation checkpoint

Milestones 0–5 are the validation MVP. **Milestone 5a** (Teacher Dashboard,
Cohorts, Class-Focus, Adaptive Engine) works against this seeded data; 5b begins
only after 5a passes. After Milestone 5 there is a formal checkpoint before the
post-validation expansion (M6–M11).

---

# Handoff — Milestone 3

**Date:** 2026-08-09
**Milestone:** 3 — Assessment Builder — **COMPLETE**
**Suite:** `npm test` → **115** (110 `services/api` + 5 `infra`); the same 110
acceptance tests also pass **vs Postgres** (`npm run test:pg-suite`); `npm run
test:db` → 8. `npm run typecheck` clean.

## No new gate

M3 has no external precondition — generation runs through the AI service layer,
operational via the deterministic local provider since M1 (live Bedrock still
deferred, ADR-0013). Nothing was asserted-but-absent this time.

## What was built (every acceptance row tested)

- **FR-ASM-001** grounded generation — capacity = 1 question per approved+mapped
  grounding chunk; over-ask → fewer questions + `shortfall` (never fabricated,
  tested first); unapproved content excluded + flagged; **mid-run AI failure →
  failed state, no partial draft saved, audited** (`AssessmentService.generate`).
- **FR-ASM-002** five question types; unsuitable type (numerical on non-numeric
  content) flagged, not forced.
- **FR-ASM-003** rubrics + model answers for extended-response; multiple versions
  (same grounding/difficulty, seeded wording); difficulty-imbalance flag.
- **FR-ASM-004** draft-until-publish; review-acknowledgement required; accidental
  publish reversible before scheduled start; **unpublished access denied at the
  permission layer + logged**; connectivity-loss preserves work to last save,
  resume within window, interruption visible to the Teacher.

## New this milestone

`domain/assessment.ts`, `AssessmentStore` port + in-memory + **Postgres** adapter,
`AssessmentService`, `LocalClassifierProvider` extended for `assessment.generate`.
Migration `db/migrations/0005_assessments.sql` (assessments / versions / questions
/ attempts). The pg-suite truncate list + harness updated so all 110 tests run vs
Postgres.

## Deferred (M3)

- Live Bedrock for generation (ADR-0013).
- Full student assessment-taking UX (M7) — M3 models just enough of attempts for
  the connectivity-loss row.

## Next (Milestone 4 — do not start ahead of it)

Seed synthetic student activity: ~25 synthetic students with varied
mastery/misconception patterns across the mapped skills, enough to exercise every
Milestone 5 dashboard/cohort/benchmark edge case. **Synthetic-data quarantine
rules** apply (v1.3) — synthetic data must be clearly quarantined from real
student data.

---

# Interlude — Async ports + full Postgres adapters (post-M2, pre-M3)

The persistence ports were converted to **async**, cascaded through every service
and all 27 test files, and backed by full **Postgres adapters** (postgres-js).
The **same 96 acceptance tests now pass against a real embedded PostgreSQL**
(`npm run test:pg-suite`) as well as in-memory (`npm test`). Running against real
Postgres caught one latent bug in-memory had hidden — a `content_versions` →
`content_items` FK ordering error in `uploadOne` (insert item before version),
now fixed (ADR-0017).

Verify:
```
npm run test:pg-suite --workspace services/api   # 96 acceptance tests vs Postgres
npm run test:db       --workspace services/api   # 8 governance/constraint tests
npm test                                         # 96 in-memory + 5 infra
```

Audit/notifications stay in-memory in both modes; only the three data stores swap
to Postgres. AWS-provisioned RDS/Aurora is still a later step, but the adapters
are real and test-covered. See ADR-0017.

---

# Interlude — Database validation (post-M2, pre-M3)

Before starting M3, the DB layer was validated against a **real** embedded
PostgreSQL (no install/Docker; `embedded-postgres` dev dependency).
`npm run test:db --workspace services/api` → **8 passing**: migrations `0001–0004`
apply cleanly, and the DB-enforced governance guarantees the in-memory adapter
only simulates are proven — audit `INSERT+SELECT`-only grants, immutability
triggers (UPDATE blocked; DELETE only for the retention role), hash-chain
enforcement, `CHECK` constraints, and jsonb/timestamptz round-trip.

**Open finding (ADR-0016):** full Postgres *store adapters* require converting the
synchronous persistence ports to async (a cascade through every service/test) —
a milestone-sized refactor, **not** done pre-M3. Recommended before the M5
checkpoint. Migrations + governance are proven, lowering that refactor's risk.

---

# Handoff — Milestone 2

**Date:** 2026-08-09
**Milestone:** 2 — Skill Graph — **COMPLETE**
**Suite:** `npm test` → **101 passing** (96 `services/api`, 5 `infra`). `npm run typecheck` clean.

## Gate note (read first)

The M2 gate named a signed-off graph file that **wasn't on the machine**. Rather
than fake it, the reconciliation (owner-agreed): the **program AI-drafts** the
graph — the plan itself says v0.1 was "AI-drafted" — and ships it as a committed
seed, but **sign-off is modeled as a human governance act the program never
self-certifies**. The seed imports as `draft`; mapping against an unsigned graph
is **blocked in code**; a curriculum expert (the owner, after reviewing the
output) calls `signOff` to flip it to `signed_off`. **Action:** review
`db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json` and sign it off before
any live-classroom mapping. It is a representative subset, **not** the full
96-skill v0.1.

## What was built (every acceptance row tested)

- **Skill graph as versioned trusted infra** — import + `validateGraphSource`
  (referential integrity, difficulty-can't-be-a-node, **acyclic**), re-validated
  on every structural edit (`SkillGraphService`).
- **Sign-off gate** — `draft` → `signed_off` governance state; audited; mapping
  refused against an unsigned graph.
- **FR-SKG-001** — map approved content through the full chain; multi-skill →
  multiple nodes; missing-prerequisite **flag** (not block). Difficulty is an
  item attribute on the mapping, never a node.
- **FR-SKG-002** — NSW fully implemented (NESA `MA4-` codes); VIC/AC/custom at
  schema+policy level: curriculum-switch flags re-mapping; undefined custom
  outcomes → outcome mapping pending.
- **FR-SKG-004** — per-mapping teacher override reflected everywhere;
  remap-historical-data prompt when mastery data exists; bulk override with a
  single confirmation (`MappingService`).
- Mapping reads **only** from the M1 approved pool.

## New this milestone

`src/domain/skillGraph.ts` (types + cycle detection), `SkillGraphStore` port +
in-memory adapter, `SkillGraphService`, `MappingService`. Postgres schema +
`db/migrations/0004_skill_graph.sql` (versions/nodes/prereqs/mappings/curricula,
with node-type + status CHECK constraints). Seed under `db/seeds/`.

## Deferred (M2)

- Real curriculum-expert sign-off of the seed (governance action awaiting the
  human — ADR-0015).
- Full 96-skill NSW graph + actual VIC/AC/custom graphs (schema is ready).
- Postgres adapters still deferred until a DB is provisioned (ADR-0007).

## Next (Milestone 3 — do not start ahead of it)

Assessment Builder: generate assessments from natural-language requests using
**approved content only**, through the AI service layer; multiple question types;
rubrics/model answers/versions; **everything stays draft until a teacher
publishes** (FR-ASM-004). Test the "insufficient approved content" edge first.

---

# Handoff — Milestone 1

**Date:** 2026-08-09
**Milestone:** 1 — Content Studio + Knowledge Engine — **COMPLETE**
**Suite (at M1):** 85 passing (80 `services/api`, 5 `infra`).

## Gate note (read first)

The M1 gate was "Bedrock ap-southeast-2 zero-retention verified live." This
machine has **no AWS credentials / CLI / Bedrock access**, so that live
verification **could not be performed and was not faked**. With the product
owner's agreement, M1 was built with the AI layer behind an `AiProvider` port: a
real, guarded `BedrockProvider` (ap-southeast-2) is written but not invoked, and
a **local deterministic provider (no network egress)** backs dev + the whole test
suite. **Live Bedrock verification is the one open item** — unblocked by
`aws configure` (or env creds) + an enabled in-region model. See ADR-0013.

## What was built (every acceptance row tested)

- **FR-CONT-001** upload — type/size validation, malware scan reject+quarantine
  (logged), third-party-copyright attestation gate, duplicate + near-duplicate
  flagging (`ContentService`).
- **FR-CONT-002** AI classification via the single AI service layer — suggestions,
  low-confidence flag, teacher edit persists as approved, unreviewed excluded
  from pool (`ClassificationService`).
- **FR-CONT-003** versioning — revised/concurrent edits become new versions
  (history retained), near-duplicate flag, archive-in-use warning.
- **FR-CONT-004** sharing — class/department scopes with **live** access
  resolution (student class change and dept-leave revoke immediately).
- **FR-ING-001/002** ingestion — text/structure → concept chunks; scanned→needs
  OCR; corrupted→failed; **always terminal** (NFR-PERF-001) (`IngestionService`).
- **FR-ING-003/004** linking — lessons/questions/outcomes navigable; outdated
  outcome + orphaned-question views (`KnowledgeService`).
- **Load-bearing approval gate** — `ContentService.approvedPool` is the only set
  downstream reads; pending/unattested/unreviewed/un-ingested/quarantined/
  archived never appear.
- **AI service layer** operational via provider; **every AI call writes an audit
  entry**; offshore/remote non-compliant providers refused at construction.

## New this milestone

Ports: `ContentStore`, `StoragePort`, `ScannerPort`, `TextExtractorPort`,
`AiProvider`. Adapters: `InMemoryContentStore`/`InMemoryStorage`, `BedrockProvider`,
in-memory scanner/extractor, `LocalClassifierProvider`. Postgres schema of record +
`db/migrations/0003_content.sql` (content tables + `memberships.department`).

## Deferred (M1)

- **Live Bedrock verification** (ADR-0013) — the gate item.
- Postgres `DataStore`/`ContentStore` adapters still deferred until a DB is
  provisioned (ADR-0007); schema + migrations are the record.
- Real S3 / malware scanner / OCR (Textract) — behind ports (ADR-0014).
- Web UI screens (ADR-0012).

## Next (Milestone 2 — do not start ahead of it)

Skill Graph: map approved content subject→…→prerequisite→difficulty; prerequisite
graph validated acyclic; difficulty an item attribute; teacher per-mapping
overrides (Decision 4). Reads only from `approvedPool`. **External gate:**
curriculum-expert sign-off of the skill-graph v0.1 draft before M2.

---

# Handoff — Milestone 0

**Date:** 2026-08-09
**Milestone:** 0 — Project skeleton + minimal School-Admin onboarding — **COMPLETE**
**Suite (at M0):** 55 passing (50 `services/api`, 5 `infra`).

## Starting context (read this if the premises look off)

This was a **greenfield start**. The working directory `C:\Projects` was empty
and not a git repo; there was no prior MVP-app repository, no handoff notes, and
no test suite despite the kickoff brief implying an existing repo. The Pathfinder
folders elsewhere on the machine are documents and a **product-studio marketing
portal** (its README says it "is **not** the future school application itself"),
not this app. The authoritative source is `PathfinderMVPBuildPlan_v1.4.docx`
(in `Downloads` and `Desktop/Pathfinder MVP`). Product owner confirmed: fresh
start in `C:\Projects`, TypeScript/Node stack.

## What was built

**In-scope requirements (every acceptance row tested):**
- FR-ADM-001 create school; campuses, academic years, terms — `SchoolService`
- FR-ADM-002 accounts, roles, permissions — `AccountService`
- FR-ADM-007 assign Principal to campuses — `PrincipalService`
- FR-ONB-001 role-appropriate onboarding — `OnboardingService`
- FR-ONB-002 seven-step Admin onboarding — `OnboardingService`
- DoD end-to-end: create school → invite Teacher (via notification service) →
  accept → **log in as that Teacher**, at the service level and over HTTP
  (`AuthService`, `http/app.ts`, `auth-login.test.ts`).

**Foundations (all tested):**
- Append-only, hash-chained **audit log** with DB-level grants (`INSERT+SELECT`
  only) + immutability/chain triggers.
- **AI service layer** as an *empty* choke point with the AU-region /
  zero-retention / no-training guard (no LLM calls).
- Single **notification/event service**; the Teacher invite is its first consumer.
- **Governance state machine** draft → approved → published (approval never
  automatic).
- **Fixed governance vs. themeable brand** design tokens.
- **Minimised, per-student-erasable** data model (PII isolated in
  `personal_data`; `erasePersonalData` removes PII, retains audited facts).
- **Approvable state field** on inference records (default `unreviewed`).
- **Region pin** to `ap-southeast-2` in the CDK skeleton.

## Key decisions

See [docs/decisions.md](docs/decisions.md). Highlights: Fastify + Drizzle +
Vitest + AWS CDK; npm-workspaces monorepo; scrypt auth with **live**
authorization (role change without re-login); governance lifecycle is
draft→approved→published with `locked-computed` kept as a design token.

## Deferred (intentionally, not forgotten)

- **Postgres `DataStore` adapter** — M0 runs on the in-memory store because no DB
  is provisioned. The Drizzle schema + `db/migrations` (incl. audit
  grants/trigger) are the production schema of record; the adapter is written
  when the AU database exists (ADR-0007). **This is the one foundation item
  present as schema + migration rather than a live runtime binding.**
- **Web UI screens** — `apps/web` is a React/Vite shell only (ADR-0012).
- **Plan-deferred**: FR-ADM-003 (CSV import + SSO), FR-INT-001 (SSO) — resequenced
  by the plan itself.
- Real Bedrock wiring — Milestone 1 (where student content first reaches an LLM).

## How to verify

```bash
npm install
npm test          # 55 passing
npm run typecheck # clean
npm run dev:api   # Fastify on :3000 (in-memory store) for manual smoke tests
```

Traceability of each acceptance row → test: [docs/traceability.md](docs/traceability.md).

## Suggested next steps (Milestone 1 — do not start ahead of it)

1. Provision the AU database and write the Postgres `DataStore` adapter (ADR-0007);
   run `db/migrations` against it; re-point `buildContext` via config.
2. Wire the AI service layer to Bedrock `ap-southeast-2` (make it *operational*),
   keeping the guard as the blocking mechanism — M1's definition of done requires
   the verified in-AU, zero-retention path before student content reaches an LLM.
3. Build Content Studio + Knowledge Engine per Milestone 1, reusing the existing
   governance gate and notification service.
