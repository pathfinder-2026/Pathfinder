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
