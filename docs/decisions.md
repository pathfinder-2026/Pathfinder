# Architecture decisions (ADRs)

Choices made where the MVP Build Plan v1.4 was silent on a detail. The plan's
seven **foundational decisions** are not re-litigated here — see
[foundational-decisions.md](foundational-decisions.md).

## ADR-0001 — TypeScript / Node full-stack
Confirmed with the product owner. One language across API, IaC and (future) web;
strong AWS Bedrock SDK; matches the existing React tooling in the wider project.

## ADR-0002 — Fastify for the backend
Lightweight, first-class TypeScript, minimal magic. The hexagonal design
(domain → ports → adapters) keeps Fastify at the edge; swapping it would not
touch domain logic.

## ADR-0003 — Drizzle ORM + hand-written SQL for the audit log
Drizzle is SQL-first, so the append-only `GRANT INSERT, SELECT` role and the
hash-chain trigger (which an ORM's migration engine fights) are expressed in
plain SQL under `db/migrations`, while typed queries use Drizzle elsewhere.

## ADR-0004 — Vitest as the test runner
Fast, TS-native, `fastify.inject` integration tests need no running server.

## ADR-0005 — AWS CDK (TypeScript) for IaC
Same language as the app; the AU region pin (Decision 1) is code and unit-tested.
Milestone 0 provisions no real resources — the stack refuses to synthesize
outside an approved AU region and nothing more.

## ADR-0006 — npm workspaces monorepo
`services/api`, `infra`, `apps/web`. npm ships with Node, so there is no extra
package manager to install; clean seams for the deferred web app and IaC.

## ADR-0007 — In-memory store backs the Milestone 0 runtime and tests
No database is provisioned yet, and the regression suite must always be green.
Domain logic sits behind the `DataStore` port; the in-memory adapter backs dev
and the full suite. The **Postgres schema of record** (Drizzle schema +
`db/migrations`, including the audit grants/trigger) is authoritative for
production. **Deferred:** a full Postgres `DataStore` adapter is written when the
AU database is provisioned — the same services run against it unchanged. This is
the one deliberate deferral in M0's foundations and is called out in the handoff.

## ADR-0008 — Thin-slice defaults: Sydney timezone, NSW curriculum
Per the plan's "one subject, one curriculum" guidance (Year 8 Maths, NSW). Stored
as school settings; overridable per campus.

## ADR-0009 — Governance lifecycle is draft → approved → published
Per this session's brief. The `locked-computed` state is retained as a **design
token** (Decision 5) for later computed results (e.g. peer benchmarks); it is not
part of the content approval lifecycle.

## ADR-0010 — Per-persona onboarding step templates
The concrete step names (`profile`, `review-classes`, `select-campuses`, …) are
placeholders chosen to satisfy the acceptance rows (role-appropriate, shared
steps de-duplicated). They will be refined when the real onboarding UIs land.

## ADR-0011 — Auth: scrypt password hashing, live authorization
Passwords hashed with `node:crypto` scrypt (no native dependency). Session tokens
are opaque random strings; **authorization is computed live from memberships on
every request**, so a role/class change takes effect without re-login
(FR-ADM-002).

## ADR-0012 — Web UI screens deferred
Milestone 0/1 acceptance criteria are all backend/service logic and the plan says
"nothing needs to be pretty yet". `apps/web` is a working React/Vite shell so the
tooling and token split have a home; screens are built when a UI is needed.

## ADR-0013 — Live Bedrock verification deferred; local AI provider default (M1)
The Milestone 1 gate calls for the Bedrock ap-southeast-2 zero-retention path to
be verified live. This environment has **no AWS credentials, CLI, or Bedrock
access**, so that live verification cannot be performed and was **not faked**
(fabricating a safety check would violate Decision 2). Instead the AI service
layer is operational via an `AiProvider` port: the real, guarded
`BedrockProvider` (ap-southeast-2) is written and type-checked but not invoked,
and a **local deterministic provider** (no network egress — nothing leaves the
machine) backs dev and the whole test suite. Live Bedrock verification is the one
gated item, unblocked the moment credentials + an enabled in-region model exist.
The compliance guard (`assertCompliantProvider`) remains the hard blocking
mechanism, and every AI call still writes an audit entry.

## ADR-0014 — Content ports + deterministic defaults (M1)
Uploads, scanning, text extraction and AI all sit behind ports so the suite runs
without real binaries, S3 or a live model:
- **StoragePort** (prod: S3 ap-southeast-2) — in dev/test a stored object carries
  simulation flags (`text` / `scanned` / `corrupt` / `malware`) to drive branches.
- **ScannerPort** (prod: an in-AU malware scanner) — default flags EICAR / a
  `malware` marker.
- **TextExtractorPort** (prod: a real parser / Amazon Textract) — default derives
  headings/paragraphs from text; `scanned`→needs-OCR, `corrupt`→failed.
- **Concept generation is deterministic** (distinct section headings), not an LLM
  call — only classification uses the AI layer in M1. Recorded so it's a
  conscious choice, revisitable if richer concept extraction is wanted later.
- **File-type/size policy** (defaults, `src/domain/content.ts`): supported =
  documents/slides/pdf/txt/md/csv, video (mp4/mov/webm ≤500 MB), audio (≤200 MB),
  images (≤25 MB), links; documents ≤50 MB. `.zip`/unknown → unsupported.
- **Near-duplicate** = token-set Jaccard ≥ 0.8; exact = identical content hash.

## ADR-0032 — Email delivery adapter behind the notification port (SES seam)
No email transport existed: invites only ever reached the in-memory notification
channel, so nothing was actually delivered (the admin UI's copyable invite links
are the working delivery path). The real adapter now exists —
`adapters/email/emailChannel.ts` — following the **BedrockProvider posture
(ADR-0013)**: real, compiled, fully tested against a fake transport, but **not
wired by default**, because live sending is gated on AWS SES credentials + a
verified sender identity, neither of which exists in this environment.

- **Two-layer seam.** `EmailChannel` (a `NotificationChannel`) does message →
  email composition; the low-level `EmailTransport` interface does "send one
  email". `SesTransport` (SESv2 SDK) is the first transport, **pinned to AU
  regions** exactly like the AI layer (offshore region refused at construction —
  Foundational Decision 1). An SMTP transport (e.g. nodemailer against a school
  relay) can implement the same seam later; hand-rolled SMTP is explicitly out.
- **Invite links are composed at the edge.** The domain layer keeps only the
  ids-only token in the message context; the channel builds
  `{appBaseUrl}/?token=…` at delivery time. No URL/PII enters the audit log.
- **Best-effort delivery.** A transport outage must never break the domain
  action that emitted the notification — the channel records a **PII-free**
  failure `{notificationId, type, reason, at}` (never the address, subject or
  body) instead of throwing. The invite still exists; the copyable link and the
  in-app record still work. Alerting on safeguarding-type delivery failures is
  part of productionisation.
- **Wiring.** `BuildContextOptions.extraChannels` appends channels after the
  default in-memory one (which always stays — it is the in-app record).
  `src/index.ts` opts in via env: `PF_EMAIL_FROM` (enables), `PF_APP_BASE_URL`,
  `PF_EMAIL_REGION` (AU-validated, default ap-southeast-2).

## ADR-0031 — Production web app foundation + Admin onboarding slice
The production persona UIs (deferred since ADR-0012) begin here, built persona by
persona as thin vertical slices. First slice: School-Admin onboarding.

- **A fresh app (`apps/app`), not the preview console.** The preview console
  (`apps/web`, ADR-0021) is an explicitly-throwaway validation aid that satisfies no
  FR; the production UI is a clean React 19 + Vite app on the real design system. Both
  coexist (preview on :5173, production on :5174) until the production UI supersedes it.
- **Design tokens mirror Decision 5 in CSS.** `apps/app/src/theme.css` splits BRAND
  tokens (`--pf-brand*`, themeable — the white-label layer sets `--pf-brand` at runtime)
  from GOVERNANCE tokens (`--gov-*`, fixed, deliberately NOT derived from `--pf-brand`).
  Governance status chips read only `--gov-*`, so a brand change can never recolour a
  draft/approved/locked signal — FR-WL-004 realised in the UI, matching the backend
  guarantee. `applyBrand` sets only `--pf-brand` (+ a derived tint); the server has
  already clamped the colour to the AA floor, so white-on-brand text stays legible.
- **New production HTTP surface under `/api/v1`** (`http/adminApi.ts`), mounted
  alongside the M0 core-loop routes and the preview API without collision. Every route
  is session-guarded (Bearer token -> `auth.authorize`), admin-scoped, and same-school
  checked; it only does HTTP plumbing over the already-tested services. Errors flow
  through `buildApp`'s shared handler.
- **Admin self-registration primitive.** Onboarding needs a founding Admin who can log
  back in, but that Admin isn't invited by anyone. Added `AuthService.setInitialPassword`
  (validates + hashes + stores a credential, audited) — distinct from `acceptInvite`,
  which also flips an invite. `POST /api/v1/onboarding/start` composes createSchool +
  createAccount + setInitialPassword + login and returns a session.
- The 7-step onboarding is rendered as the "waypoint trail" from the look-and-feel doc
  (the pathfinder motif); completed/current waypoints are navigable, future ones locked,
  mirroring the server-side step-order guard. HTTP surface covered by
  `test/http-admin-api.test.ts` (full flow + zero-teacher confirm + auth/cross-school
  guard); the app itself is typecheck- + production-build-verified and driven live.
  Real logo bytes, the remaining personas (Teacher/Student/Parent/Principal), and
  WCAG 2.2 AA audit tooling (NFR-A11Y-001) come in later slices.
- **Sign-in + account management (added to the slice).** An existing admin signs back
  in via `POST /api/v1/auth/login` (resolves school + first campus so the app has full
  context). A **People** screen assigns roles (`PATCH .../memberships/:id/role` ->
  `changeMembership`, FR-ADM-002; Principal per campus via the campus scope, FR-ADM-007)
  and edits names (`PATCH .../users/:id/name` -> new `AccountService.updateName`, audited).
  The server's last-admin guard (can't demote the only admin) surfaces as a 409 in the UI.

## ADR-0030 — White-label / multi-tenant branding (Appendix Milestone B)
FR-WL-001..004 build the configurable branding layer on top of the fixed-vs-themeable
token split established in Milestone 0 (Foundational Decision 5). Branding is confined
to the brand layer by construction.

- **Governance stays unreachable.** `resolveBranding` always returns the frozen
  `GOVERNANCE_TOKENS`; there is no field on any branding input (or column in
  `branding_configs`) that could set a governance colour; and an explicit
  `requestGovernanceOverride` is **declined by design** (`GOVERNANCE_TOKENS_FIXED`,
  audited). FR-WL-004 is thus a structural property, not a runtime check that could
  be bypassed.
- **The WCAG-AA floor is evaluated as white-on-primary**, not "best of black/white
  text". Any solid colour clears AA (4.5:1) against black *or* white — the maximum of
  the two bottoms out at ~4.58 near luminance 0.179 — so a best-of-both floor would
  never reject anything. The platform renders **white** text/icons on the brand
  primary (buttons, chips, header bars, links), so that is the pairing the floor must
  hold for. `autoAdjust` darkens toward black (monotonically raising white-contrast;
  black is the terminal 21:1 case). The floor is enforced **twice**: `configureBranding`
  refuses a failing colour and returns a `BrandContrastError.suggestion`; and
  `resolveBranding` **re-clamps** at read time, so even a colour written straight to
  the store (bypassing configure) is served accessibly (FR-WL-004 "server-side
  regardless").
- **Logo sanitisation (NEW v1.4).** SVG is accepted only after an active-content scan
  (`<script>`, `on*=` handlers, `<foreignObject>/<iframe>/<embed>/<object>`,
  `javascript:`/`data:text/html`, inline DTD / `<!ENTITY>`, SMIL `<set>/<animate>`) —
  any hit is rejected (`LOGO_ACTIVE_CONTENT`). Raster logos (png/jpg/jpeg) are
  malware-scanned through the **same `ScannerPort`** the content pipeline uses
  (`LOGO_INFECTED`). Only safe image content is ever stored. Real logo image bytes +
  object store (S3, ap-southeast-2) are deferred; the sanitise + reference model is
  complete.
- **Point-in-time reports.** `issueReport` snapshots the resolved branding into a
  persisted `BrandedReport`; `getReport` returns that original snapshot, so a later
  branding change (or a white-label revert) never rebrands an already-issued report
  (FR-WL-002 revert / FR-WL-003 point-in-time). Logo availability is resolved against
  the stored `LogoAsset`, so a missing asset degrades to a **text fallback** (school
  name), never a broken image.
- **White-label is presentation-only.** The `internal` surface always resolves to the
  real Pathfinder identity regardless of a school's white-label toggle (FR-WL-002
  support-tooling edge). A `user` surface shows the school product name + hides
  attribution only under full white-label; otherwise it stays co-branded.
- New `BrandingStore` port (in-memory + Postgres), `BrandingService`, `domain/branding.ts`
  (pure contrast maths + SVG scan + resolution), migration 0016. `BrandContrastError`
  carries the accessible suggestion (same pattern as `ConfirmationRequiredError`).

## ADR-0029 — CSV import + SSO (Appendix Milestone A)
The plan **resequenced** FR-ADM-003 (CSV import + Google/Microsoft SSO) and FR-INT-001
(SSO sign-in) out of Milestone 0: manual account creation unblocked the core loop, so
these were "built later in sequence", their acceptance rows preserved in the plan's
Appendix. This ADR records how they were built after the core MVP.

- **CSV import is store-only** — it creates ordinary users/memberships/enrolments through
  the existing `AccountService`, so no new tables. Parsing, per-row validation and
  formula-injection sanitisation live in a pure domain module (`domain/csvImport.ts`) so
  every edge is directly unit-testable; `CsvImportService` drives account creation. Each
  row is independent: a malformed row is rejected with a **specific** error while valid
  rows still import; a duplicate email (already in the system **or** earlier in the file)
  is flagged and skipped, never creating a conflicting account.
- **Formula-injection (NEW v1.4)** is neutralised on the way IN (a cell starting with
  `= + - @`, after leading-whitespace stripping, is prefixed with `'` so a spreadsheet
  treats it as literal text) **and** re-sanitised on the way OUT (`exportUsersCsv`), so no
  downstream export/spreadsheet view can evaluate it. The row still imports but is
  **flagged for review**. `sanitiseCell` is idempotent, so double-application is safe.
- **SSO is one provider + one domain per school** (the MVP shape), stored in a small
  `sso_configs` table (migration 0015). A sign-in for an email **outside** the configured
  domain is denied with a **clear, specific** `SSO_DOMAIN_MISMATCH` message (this is the
  FR-ADM-003 mismatch row).
- **The IdP is a port** (`IdentityProviderPort`), like `AiProvider`. The default
  `LocalIdentityProvider` is deterministic and network-free (stays in-memory in both store
  backends, like the audit recorder) so the two FR-INT-001 edges are testable: an **outage**
  throws `ServiceUnavailableError` (code `SSO_IDP_UNAVAILABLE`) — distinct from an auth
  failure, so the UI shows "try again", not "invalid credentials"; an **upstream-revoked**
  account is denied AND its cached sessions are purged (`deleteSessionsByUser`), so a stale
  session cannot keep working. **Deferred (like Bedrock, ADR-0013):** the real Google/
  Microsoft OIDC token verification + directory lookup — the port + guards + tests exist;
  only the live network provider is unwired.
- `AuthError` gained an optional `code` (default `"AUTH"`, backward-compatible) so SSO
  denials carry intent-specific codes.

## ADR-0028 — Governance / audit hardening pass (M11)
Milestone 11 verifies the incrementally-built governance end-to-end (NO new product
features) and closes the gaps the verification surfaced. Two red-team failure modes
+ every FR-GOV / NFR.
- **Red-team A (AI -> student without teacher action):** a single test exercises
  every AI-content path — assessment is draft + student-denied until published;
  agent drafts never auto-send; focus material is `AUTO_ASSIGN_BLOCKED`; inference
  claims fail `canSurfaceToStakeholder` until approved; unpublish revokes delivery.
  No path found.
- **Red-team B (Principal surfaces expose transcripts):** a back-door hunt seeds a
  real transcript with a unique marker and asserts it appears in NONE of
  teacherReport / masteryOverview / drillClass / drillStudent / exportReport /
  schoolReport. Structural (PrincipalDashboardService never reads the help store).
- **FR-GOV-002 hardening:** the AI choke point now (a) writes the audit entry BEFORE
  the provider runs, so a logging failure THROWS and blocks the action (verified: a
  throwing recorder blocks the call and the provider never runs); (b) logs grounding
  provenance (ids only — no PII in the immutable log).
- **FR-GOV-003 retention:** `GovernanceService.runRetention` deletes aged Ask-for-Help
  data past the configured `retentionDays` and LOGS its own deletion
  (`retention.deleted`) to the append-only audit.
- **FR-GOV-006 export/erasure:** `exportStudent` yields a complete human-readable
  record; `eraseStudent` removes PII (personal_data) while audited facts (mastery)
  and the id-only, hash-chained audit rows persist — `verifyChain()` stays true, so
  the chain is preserved WITHOUT retaining PII. Active records require an explicit
  confirm (PII-only erasure is the default, never destructive record deletion).
- **FR-GOV-007 fail-safe:** the choke point re-validates the provider on every call
  (drift to a non-compliant endpoint is blocked architecturally) and can be PAUSED
  (`pauseForDrift`) so calls fail `AI_PAUSED` when config can't be verified.
- **FR-GOV-005 anti-rubber-stamping:** publish requires each generated item reviewed,
  records review-duration + items-opened on the audit entry, and
  `approvalQualityPrompt` returns a non-blocking spot-check prompt for fast bulk
  approval (aggregate only, never a per-teacher league table).
- **NFR-COST-001:** a per-actor fair-use cap on the choke point declines further
  calls (`COST_CAP_REACHED`) rather than billing unbounded.
- **NFR-SEC-001/002, NFR-AUD-001, NFR-PRV-002, NFR-SAF-001, FR-SAF-002 restricted
  visibility** all verified by test (provenance survives archival; content never
  cross-school; safety trips return a clear logged message; safeguarding events reach
  only the nominated contact, never a Teacher/Principal surface).
- **Documented, not unit-tested (honest limitation):** NFR-A11Y-001 (WCAG 2.2 AA) is
  a UI conformance requirement — the production persona UIs aren't built yet (deferred
  since ADR-0012), so this remains a build-time requirement for those screens (the
  fixed governance/brand design tokens carry the contrast obligation). NFR-PERF-001's
  full latency/load targets are runtime SLOs; the testable invariant (ingestion always
  resolves to a terminal status, never hangs) is covered by the M1 NFR-PERF-001 test.
- **No new tables of consequence:** migration 0014 adds only `retention_days` to
  `school_policies`; retention reuses a new `deleteHelpMessagesBefore`.

## ADR-0027 — Reporting + co-curricular + behavioural/social (M10)
Milestone 10 (FR-REP-001/002/004, FR-CAP-002, FR-BSS-001/002). Decisions:
- **Behavioural/social is a SEPARATE data model** (`behavioural_observations`, migration
  0013) from academic mastery, everywhere it appears (the DoD). It carries only
  {category, note, authorTeacherId} — deliberately **no score/inference field**.
- **The v1.3 MVP default is implemented exactly** (a school may tighten, not loosen):
  - **Four categories only** (collaboration/communication/resilience/participation) —
    a 5th is rejected.
  - **Zero AI inference, blocked by design** — there is no auto-scoring code path;
    `autoScore()` exists solely to make the guarantee explicit and throws
    `BEHAVIOURAL_INFERENCE_BLOCKED`.
  - **Collection is consent-gated** — `recordObservation` throws
    `CONSENT_NOT_CONFIGURED` until an Admin calls `configureConsent` (the parental-
    consent mechanism sign-off). Gates live on `school_policies`
    (`behavioural_consent_configured`, `behavioural_parent_visible`).
  - **Per-persona visibility**: authoring Teacher + Admin see notes; Principal sees an
    aggregate (counts) only; Parent is hidden until the school enables it.
  - The pre-build policy sign-off remains a per-school runtime action, not bypassed.
- **Co-curricular capability (FR-CAP-002)** uses its own SIMPLER structure
  (`cocurricular_records`: domain sport/arts/music + free-text skill + level) — NOT
  the academic skill graph (no node id) — and is kept separate from academic mastery.
- **Reports** (`ReportingService`): teacher growth reflects mastery change and is
  **flagged limited/early** when the data window is < 6 weeks; the school report is
  **school-level only**; the **cost report prorates** a partial month
  (`proratedCost`); the parent report includes strengths/focus/teacher-comments/
  co-curricular and **omits empty sections gracefully** (empty arrays, never a broken
  placeholder). Parent report is gated on a verified parent-child link (M8).
- **Recorded defaults:** teacher comments are a small `teacher_comments` model; usage
  = counts of AI-generated assessments + agent drafts (proxy); licences drive cost.
  New `ReportingStore` (in-memory + Postgres); `SchoolPolicy` extended (both M9 and
  M10 setters read-modify-write to preserve each other's gates).

## ADR-0026 — Principal Dashboard: transcript-proof by construction (M9)
Milestone 9 (FR-PDB-001..006), a whole-school view scoped to one school. Decisions:
- **Ask-for-Help transcripts are unreachable from EVERY Principal surface, by
  construction (non-negotiable DoD).** `PrincipalDashboardService` never calls any
  help-session/help-message method, and no type it returns carries transcript
  content — dashboard, drill-down, alerts, and export alike. A back-door test seeds
  a real transcript with a unique marker and asserts it appears in none of those
  surfaces.
- **Refined the M7 transcript rule per the M9 clarification.** M7 previously
  blanket-denied anyone holding a principal role. That's now: the ONLY allow path is
  the assigning teacher (`viewerId === session.teacherId`). So a dual-role
  Principal-Teacher reads transcripts for their OWN classes via their Teacher
  capacity, a pure Principal is denied (`NOT_ASSIGNING_TEACHER`), and Principal
  SURFACES still never expose transcripts. (M7 test updated to the refined code.)
- **No cross-campus comparison** (FR-PDB-003 edge) — `compareCampuses` throws
  `OUT_OF_MVP_SCOPE`; the interface does not offer it.
- **Metrics computed from real data, made honest.** Coverage/approval/edit/engagement
  come from assessments, agent drafts (a new additive `edited` flag on
  `agent_suggestions`, migration 0012, set by `editDraft`) and tasks
  (`listTasksByTeacher`). A new teacher is contextualised by a shorter window and is
  never flagged as a low-engagement outlier (FR-PDB-001 edge). Outlier teachers/classes
  are flagged distinctly rather than smoothed into an average.
- **Alerts have thresholds.** Only week-over-week mastery drops >= a meaningful delta
  surface (no alert fatigue); a configured seasonal break window suppresses expected
  dips. Uses the existing mastery `history`.
- **Sensitive comparison views are policy-gated (FR-PDB-006).** `school_policies`
  (migration 0012) defaults teacher-to-teacher comparison OFF; the report's
  `comparison` is null unless the school enables it, and enabling records an
  `updatedAt` (applies going forward).
- **Synthetic students excluded** from all Principal surfaces (M4 quarantine).
- **Naming:** the M0 `PrincipalService` (FR-ADM-007 campus assignment) is untouched;
  the M9 service is `PrincipalDashboardService` (`ctx.principalDashboard`).

## ADR-0025 — Parent Dashboard: verified, plain-language, non-diagnostic (M8)
Milestone 8 (FR-PAR-001/003/004/005/006). Gate + decisions:
- **The parent-child relationship + verification model did not exist** (only an
  `invite.parent` type and a `link-child` onboarding step name). Built
  `ParentChildLink` (`ParentStore`, migration 0011) with an explicit `verified`
  flag. **`requireVerified` gates every data surface** — an unverified link OR a
  studentId the parent isn't linked to both throw `AuthError` (no data). This one
  guard covers FR-PAR-003's unverified-relationship AND cross-student rows.
- **Never merged across children.** `dashboardFor`/`calendarFor` are per-(parent,
  child); `verifiedChildren` lists them separately. A parent can only link to a
  real, non-synthetic student in the school (M4 quarantine preserved — synthetic
  students have no PII and no parent link, so they never appear on a parent surface).
- **Plain-language, never diagnostic (DoD, tested specifically).** Summaries are
  generated through the AI service layer (`parent.summary`, audited) from factual
  mastery/activity; `plainTopic()` translates node labels/codes to everyday topic
  words (never a node id/code); and a code-level guard replaces the text with a safe
  observational fallback if `containsDiagnosticLanguage()` ever detects a clinical
  term. AI *claims* about a student still pass the approvable-state gate
  (`canSurfaceToStakeholder`) before reaching a parent.
- **No stale data without context.** No recent activity → `hasRecentActivity:false`
  and a plain "no new activity this period" message, not a stale snapshot.
- **Single weekly consolidated cadence (FR-PAR-004).** `runWeeklyDigest` sends ONE
  `parent.digest` per parent-child with new activity since `last_digest_at`, and
  NOTHING when there's nothing to report. **Safeguarding is the only off-cadence
  path** — it escalates immediately via the M7 FR-SAF-002 route (`alert.safeguarding`
  to the DSL), never through the parent digest; there is no separate "urgent" class.
- **Recorded defaults:** the school Admin creates + verifies links (real
  verification workflow is later); `parent_meeting` added to `CalendarEventType`
  (no CHECK migration needed); the parent calendar reuses the M7 year-group-scoped
  events.

## ADR-0024 — Student Workspace + Ask for Help: state-layer safety (M7)
Milestone 7 (FR-STU-001–004, FR-SAG-001/002) is the plan's highest-risk milestone.
Gate + gaps surfaced and handled:
- **The asserted "safeguarding config step exists" was only half-true.** Onboarding
  had a generic `configure-operations` step but NO safeguarding data model. Added
  `SafeguardingConfig` (contact, role, SLA hours, after-hours policy) via
  `SafeguardingService.setConfig` (admin-only, set during `configure-operations`),
  stored on the DataStore. **Ask for Help hard-refuses** (`safeguarding_not_configured`)
  for any school without it. ADMIN_STEPS was left unchanged (no M0 test breakage).
- **No year-group data existed** for FR-STU-004's restricted-event edge → added
  `ClassRoom.yearGroup` (migration 0010 `ALTER classes`); a student's year group is
  their class's, and events restricted to another year group are invisible (not greyed).
- **Assessment-in-progress lockout is enforced at the TASK-STATE layer**, never a
  prompt: `ask()` returns `not_homework_or_practice` for an assessment task and
  `assessment_in_progress` when the student has any in-progress attempt — both
  decided from task/attempt state BEFORE any model call.
- **Structural answer-safety.** The tutor is only ever given the task's approved-content
  grounding chunk and asked for a HINT (local provider `help.hint`); it is never given
  the answer, so it cannot leak one. Off-topic / direct-answer / unsafe / safeguarding
  are DETERMINISTIC classifiers (domain/askForHelp), so they are testable and
  prompt-independent; every message is recorded in the transcript.
- **Adversarial suite** (>100 varied extraction attempts incl. persona/role-play/coercion):
  ≥95% explicitly refused, 100% no-answer-leak (structural), misses fall through to a
  safe hint and are surfaced in the transcript. Documented as risk reduction backed by
  monitoring, not an absolute guarantee (v1.3).
- **Transcript visibility**: assigning teacher only; a Principal is HARD-denied
  (`PRINCIPAL_FORBIDDEN`), other teachers denied (`NOT_ASSIGNING_TEACHER`).
- **Safeguarding classifier hits** log + escalate to the configured contact via the
  notification service (`alert.safeguarding`); the full FR-SAF-002 disclosure workflow
  is Milestone 11.
- **Independent verification** (DoD: "verified by someone other than whoever built it")
  performed via an independent review pass over the Ask-for-Help path.
- **Recorded defaults:** overdue notifies the assigning teacher once (`overdueNotified`
  flag); calendar placement/full calendar remains lightweight (co-curricular etc. as
  events). New `WorkspaceStore` port (in-memory + Postgres), migration 0010.

## ADR-0023 — Teacher Agent: grounded-or-declined, drafts-only (M6)
Milestone 6 (Teacher Agent — FR-TAG-001–004) is a curriculum/lesson-planning
assistant grounded in everything built so far. It was built at the product
owner's explicit direction, proceeding past the Section 5 validation checkpoint
(the checkpoint is a pilot/business gate, not a code milestone; M11's governance
verification remains non-negotiable before any real-student pilot). Decisions:
- **Grounding is mandatory, no exceptions (FR-TAG-004 / DoD).** Every suggestion
  is created with a non-empty `grounding` snapshot of the approved content it drew
  on. There is no code path that produces an ungrounded suggestion.
- **No grounding content → decline honestly.** `generateGrounded` returns
  `{status:"declined", reason:"no_grounding_content"}` and audits it, instead of
  inventing a plan. All generation goes through the single AI service layer
  (Decision 2), so every call is audited (Decision 3); the deterministic local
  provider gained an `agent.generate` purpose (live Bedrock still deferred, ADR-0013).
- **Grounding refs survive archiving.** A ref snapshots `{contentItemId, title}`
  at creation; on view the `archived` flag is re-resolved live from the content
  store, so a source archived after the fact still shows as a (now-archived)
  reference rather than a broken link. (`approvedPool` excludes archived, so new
  grounding is always from approved content; only prior refs can be archived.)
- **Drafts never auto-send.** Parent comms / feedback / plans persist with
  `sent:false`; there is deliberately no auto-send path (actually sending parent
  comms is M8). The teacher can `editDraft` before sending; a draft left untouched
  for a year is still retrievable and unsent.
- **Sensitive material is separated and flagged (Decision 7).** Behavioural/social
  observations are split into `sensitiveSections` (flagged for extra review) and
  are NEVER inlined into the academic body or sent to the AI draft prompt.
- **No capability data → generic + labelled.** Differentiation for a class with no
  mastery data yet returns `personalised:false` with a note, rather than faking
  personalisation.
- **Recorded defaults:** observations are supplied structured with a category (the
  behavioural taxonomy + consent gate is later, v1.3); suggestions don't persist a
  student link yet (that association arrives with M8 parent comms). New
  `AgentStore` port (in-memory + Postgres), migration 0009.

## ADR-0022 — Peer layer as a separate publish-or-withhold governance path (M5b)
Milestone 5b (Peer Benchmarking, Peer Review, Peer Testing — FR-PEER-001–005)
completes Milestone 5. Its governance pattern is deliberately DIFFERENT from the
rest of the platform, and the plan's key design decision warns not to let it leak
into the generic "AI draft, editable" component. How that was honoured:
- **Computed results are immutable BY CONSTRUCTION.** Benchmarks are computed on
  read from submissions (+ corrections); they are never stored, so there is
  nothing to hand-edit and no "edit result" method exists. The only decisions on
  results are `publish` / `withhold` (default **withheld**).
- **Never auto-released.** `studentSignal` gates purely on the publish state;
  there is no timer anywhere. A test advances the clock a year and the result
  stays withheld.
- **Corrections go through a separate, logged path.** `recordCorrection` writes an
  audited `PeerCorrection` and requires a reason; it never overwrites the original
  submission (which stays auditable) — the benchmark reflects the correction via
  that logged path. This is the ONLY way a figure changes.
- **Student-facing signal is softened + non-ranked** — "above/at/below the cohort
  average", never a rank, raw figure, or named-peer comparison (asserted: the
  message contains no digits and no "rank").
- **Small cohorts are suppressed** (below `PEER_THRESHOLDS.minCohort` = 5,
  provisional, re-validate after M7): no per-student figures, since small groups
  weaken both anonymity and reliability. The same threshold drives the anonymity
  risk flag on peer review and the accommodation-vs-anonymity tension warning.
- **Peer review is peer-authored.** `moderate(approve|reject)` has NO text
  parameter — a teacher can reject/hide but never rewrite wording; only approved
  reviews reach the reviewed student; zero reviews → a neutral "no peer feedback
  this round" state (not an empty screen).
- **Cohort locks at launch.** `addToCohort` is refused once launched; launch
  creates per-student dashboard/calendar **placements**; cancel (pre-launch)
  removes them cleanly with no partial artifacts. (The full calendar is M7; a
  placement represents the dashboard/calendar entry.)
- **Recorded defaults:** peer-test submissions carry the graded score (auto-grading
  itself is out of 5b scope — the milestone is about the benchmark/publish
  governance); FR-PEER-001's "common assessment" is the peer test's submissions,
  one coherent model. New `PeerStore` port (in-memory + Postgres), migration 0008.
- **This completes the validation MVP.** A formal checkpoint (Section 5) precedes
  M6–M11: evidence that pilot teachers publish AI-drafted assessments with real
  edit rates and act on class-focus/cohort suggestions. Do not build ahead.

## ADR-0021 — Preview / validation console (post-M5a UI)
The plan defers production web screens (ADR-0012), but the post-M5 checkpoint is
defined as *pilot teachers using the product* — impossible against a headless
service layer. So, at the product owner's explicit direction, a **preview /
validation console** was built to render the already-tested M0–M5a services in a
browser. Boundaries, recorded so this doesn't drift into "the UI is done":
- **It renders validated milestones — it is not a new feature and satisfies no
  FR.** Clearly labelled "preview / validation build, not the production design
  system" in the UI itself.
- **Thin, additive HTTP surface** (`services/api/src/http/preview.ts`,
  `registerPreview`): read endpoints + the signature governance actions (approve
  is pre-done in the demo; publish, dismiss-focus are wired). Routes register on
  the existing Fastify app; a demo world **bootstraps lazily on first `/api`
  call**, so the 132-test suite is untouched (verified green).
- **One seeded in-memory demo school** (signed graph, approved+mapped content, a
  published assessment, the M4 synthetic class) so every screen has real data.
  Synthetic students hold no PII → the UI shows positional labels ("Student 03"),
  never personal data (Decision 6 preserved).
- **React SPA** (`apps/web`) over a Vite dev proxy to the API. Governance states
  reuse the fixed design tokens' semantics (draft/approved/published/computed);
  brand colour comes from the brand tokens (Decision 5 preserved — the UI layer
  maps fixed roles to colours, it does not let brand override governance).
- **Run:** `npm run dev:api` (:3000) + `npm run dev:web` (:5173). The production,
  design-system-faithful UI is still built later, milestone by milestone.

## ADR-0020 — Teacher intelligence layer + additive substrate extension (M5a)
Milestone 5a (Teacher Dashboard, Class-Focus, Cohorts, Adaptive Engine) reads the
M4 synthetic substrate. Verifying that substrate against every 5a Given/When/Then
row before building surfaced a genuine **data gap** (the recurring "gate"): the M4
seed as committed did not exercise four scenarios — the *trend* row (one snapshot
per pair, no series), the *conflicting-signals* row (no independent-vs-assisted
dimension), the *class focus area* happy path + *content gap* (random scores,
never a deterministic class-weak skill), and the *misconception group of 5* (the
seed made **4**). Resolution, recorded:
- **Extend the substrate additively, never fabricate a passing test.** Two
  nullable columns on `mastery_records` (migration 0007): `history` (prior scores,
  for a real trend) and `assisted_score` (for the conflicting-signals row). M4's
  quarantine schema and provisional thresholds are untouched; **all M4 tests stay
  green** (still exactly 25 students, same small-cohort/stale/insufficient edges).
- **The seed plants each 5a edge deterministically**, the same way M4 plants its
  edges: two class-weak "focus" skills (one gets material mapped in tests → a real
  focus area; its sibling gets none → the content-gap edge), a fluctuating student
  (downward `history`), a conflicting-signals student, **5** students sharing a
  misconception, and a student who fits two groups. Landmarks are returned in
  `SeedSummary` so tests target them without guessing.
- **Every suggestion is a draft; auto-assign is blocked at the platform level.**
  `assignFocusMaterial` requires a real Teacher actor (membership check); a call
  with no Teacher (a future/automated feature) is refused with
  `AUTO_ASSIGN_BLOCKED` (Foundational Decision 7). Group work is assigned only
  from the final, teacher-edited membership.
- **New analysis thresholds are provisional** (`DASHBOARD_THRESHOLDS`,
  `provisional: true`, `revalidateAfterMilestone: 7`) and inherit the M4 staleness
  / insufficient-data cut-offs — one source of truth.
- **New persistence** behind a `DashboardStore` port (in-memory + Postgres):
  `focus_dismissals` (records the below-mastery fraction at dismissal, so a
  suggestion stays hidden next session yet reappears if the data worsens) and
  `group_assignments` (student ids as jsonb, not a FK, so synthetic-student
  deletion never breaks assignment history). Escalations reuse the single
  notification service (`alert.teacher` — its first Milestone 5 consumer).
- **5b is NOT started** — peer benchmarking/review/testing (a separate
  publish-or-withhold governance path) begins only after 5a passes.

## ADR-0019 — Synthetic student activity + quarantine (M4)
M4 is an engineering task (no FR IDs), so its tests derive from the DoD and the
quarantine rules (treated as requirements). Sensible defaults, recorded:
- **Schema-level flag** `users.synthetic` (migration 0006) — the quarantine
  boundary lives in the data, not just in code paths.
- **Mastery/misconception substrate** (`ActivityStore`, `mastery_records` /
  `misconception_signals`) is what the M5 intelligence layer will read.
- **Deterministic seeding** — a `mulberry32` PRNG (not `Math.random`) makes the
  ~25-student seed reproducible; patterns are constructed (not purely random) to
  guarantee the M5 edges exist: a small cohort (rare skill touched by ≤3), stale
  activity (first 5 students), persistent misconceptions (students 5–8), and
  insufficient-data mastery (a few pairs with `dataPoints < min`).
- **Quarantine enforcement primitives now, ahead of M8/M10**: `exportRealStudents`
  / `realMastery` exclude synthetic; `deleteSyntheticStudents` cascades + audits;
  synthetic students hold **no PII** (minimisation, Decision 6).
- **Thresholds recorded, not frozen** (`SYNTHETIC_THRESHOLDS`, `provisional: true`,
  `revalidateAfterMilestone: 7`) per the v1.3 rule.
- Synthetic students seed against the school's signed-off graph skill nodes (the
  "mapped skills"); seeding refuses without a signed graph.

## ADR-0018 — Assessment generation: grounded, deterministic, never fabricated (M3)
Generation is **grounded only in the approved + mapped pool**: capacity is one
question per grounding chunk, so an over-ask generates fewer questions and reports
a `shortfall` rather than inventing ungrounded ones (the plan's first-tested edge).
Every question is drafted through the **single AI service layer** (audited,
Decision 2) via the deterministic `LocalClassifierProvider` (`assessment.generate`
purpose) — live Bedrock stays deferred (ADR-0013), same as classification.
Sensible defaults, recorded: unsuitable type = `numerical` requested against
grounding with no digits → flagged, not forced; difficulty imbalance = `hard`
requested with no hard-mapped grounding → flagged; multiple versions reuse the
same grounding/difficulty with version-seeded wording. Mid-run AI failure is
caught **before any persistence**, so no partial draft is saved, and the failure
is audit-logged (FR-GOV-002). Student access is enforced in `getForStudent`
(the permission layer), not the UI, and denials are logged. Attempts carry a
resume window + interruption flag for the connectivity-loss row; full
student-workspace assessment-taking is M7 — M3 models just enough to satisfy
FR-ASM-004. New assessment tables have a Postgres adapter, so the pg-suite runs
all 110 acceptance tests (migration 0005).

## ADR-0017 — Async persistence ports + full Postgres adapters
The synchronous persistence ports (see ADR-0007/0016) were converted to
**async** (Promise-returning) across `DataStore`/`ContentStore`/`SkillGraphStore`,
cascading `async`/`await` through every service, the HTTP layer, the test helpers
and all 27 test files. Full **Postgres adapters** (`src/adapters/postgres/pg*.ts`,
postgres-js) now implement the ports, and the **same 96 acceptance tests run
against a real embedded PostgreSQL** (`npm run test:pg-suite`) as well as the
in-memory store — a backend switch in the test harness (`PATHFINDER_TEST_BACKEND`)
with a truncate-before-each for isolation. This resolves the ADR-0007/0016
deferral: the DB path is exercised by the whole suite, not just DDL + governance
checks.

Running against real Postgres immediately caught a latent bug the in-memory
adapter had masked: `content_versions` has a foreign key to `content_items`, but
`uploadOne` inserted the version *before* the item — an ordering error with no
consequence in memory but an FK violation in Postgres. Fixed by inserting the
item first. (This is exactly the value of the pg run.)

Audit and notifications remain the in-memory `AuditRecorder` / channel in both
modes; only the three data stores swap to Postgres. The AWS-provisioned RDS/
Aurora deployment is still a later step (ADR-0007 timing), but the adapter code
is now real, type-checked and test-covered.

## ADR-0016 — Validate migrations + DB governance against embedded Postgres (pre-M3)
Before building M3, the SQL migrations (`0001–0004`) were run against a **real**
PostgreSQL — the `embedded-postgres` package (a real engine downloaded as a dev
dependency; no system install or Docker). `npm run test:db` boots an ephemeral
cluster, applies the migrations, and asserts the DB-enforced governance
guarantees that the in-memory adapter only *simulates*: the audit `INSERT+SELECT`
grant model, the immutability triggers (UPDATE blocked; DELETE only for the
retention role), the hash-chain enforcement trigger, and the `CHECK` constraints.
Rationale: the audit table is the one place in-memory is *pretending*, and
hand-written SQL compounds unverified across milestones — cheapest to prove now.

**Finding — full Postgres store adapters need an async-port refactor.** The
persistence ports (`DataStore`/`ContentStore`/`SkillGraphStore`) are
**synchronous** (an in-memory-first choice). Real DB I/O is async, so backing the
ports with Postgres means converting them to Promise-returning and cascading
`async` through every service and test — a milestone-sized refactor, deliberately
**not** done as a pre-M3 step. Recommended timing: schedule it before the M5
validation checkpoint (extends ADR-0007). The migrations + governance are already
proven, so that refactor is now lower-risk.

## ADR-0015 — Skill graph is AI-drafted but never self-signed-off (M2)
The M2 gate requires a signed-off skill graph as a build input, and it wasn't on
the machine. Rather than block, the **program generates the draft** (the plan
itself says v0.1 was "AI-drafted"): a representative NSW Stage 4 graph ships as
`db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json`. But **sign-off is a
human governance act** the program must not fake — so it's modeled as an explicit,
audited state (`draft` → `signed_off` via `SkillGraphService.signOff(expertId)`),
and **mapping against an unsigned graph is blocked in code**
(`SKILL_GRAPH_NOT_SIGNED_OFF`). Tests perform the sign-off action to exercise the
pipeline; the shipped seed stays `draft`, with a reviewer note, pending a real
curriculum expert. FR-SKG-002: NSW is fully implemented; VIC/AC/custom are
schema + policy level only (curriculum field, re-map-on-switch flag, outcome
policy) per the milestone's "schema, not implementation". The seed is a
representative subset, **not** the full 96-skill v0.1 — labeled as such.
