# Pathfinder

An AI teaching-and-learning platform for schools. This repository is built
strictly against the **MVP Build Plan v1.4** (a planning artifact kept outside
the codebase). Features are added milestone by milestone; nothing is built ahead
of the current milestone.

> **Status: Milestone 11 complete — Governance / audit hardening pass. The MVP
> build (Milestones 0–11) is complete.** A deliberate red-team found no path where
> AI content reaches a student without teacher action, and none where a Principal
> surface (incl. exports) exposes Ask-for-Help transcripts. Every FR-GOV / NFR is
> verified or hardened: a logging failure blocks the AI action; retention logs its
> own deletions; data-subject erasure removes PII while preserving the hash chain;
> provider drift fails safe; per-user fair-use caps; anti-rubber-stamping review
> metadata. The **Section 5 validation checkpoint** (pilot-teacher evidence) remains
> the real-world gate before scaling.

## See it running — the preview console

A **preview / validation console** renders the already‑tested Milestones 0–5a as
clickable browser screens (a deliberately rough validation aid — *not* the
production design system; see ADR‑0021). It boots a seeded demo school so every
screen shows real service output.

Run the API and the web app in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Then open **http://localhost:5173**. The web app proxies `/api` to the API on
`:3000`, which lazily bootstraps the demo world on first load. Start at
**Overview**, then open the **Teacher Dashboard** for the M5a intelligence layer
(mastery heatmap with trends, class focus areas, suggested cohorts, and the
adaptive engine — escalations, conflicting‑signal reasoning, and deferred
spaced‑revision reminders).

## Foundational decisions (locked — never re-litigate)

These are fixed constraints from the plan. See
[docs/foundational-decisions.md](docs/foundational-decisions.md) for how each is
encoded in code.

1. **AU data residency** — AWS Sydney `ap-southeast-2`; IaC pins the region.
2. **AI data path** — one internal AI service layer to in-AU, zero-retention,
   no-training endpoints (Bedrock `ap-southeast-2`). Operational by Milestone 1.
3. **Persistence & audit** — PostgreSQL; append-only, hash-chained audit table
   (app role INSERT + SELECT only).
4. **Skill graph** — versioned trusted infrastructure (Milestone 2+).
5. **Design tokens** — fixed governance tokens vs. themeable brand tokens.
6. **Data minimisation & erasability** — PII isolated and per-student erasable.
7. **Governance gate** — nothing AI-generated reaches a student without teacher
   action; AI claims carry an approvable state field.

## Repository layout

```
services/api     Fastify + TypeScript backend (domain → ports → adapters)
  src/domain       entities, errors, inference helpers
  src/platform     audit log, notifications, governance, AI choke point, tokens, clock
  src/ports        DataStore port
  src/adapters     memory (dev/test) + postgres (schema of record) adapters
  src/services     M0: School/Account/Principal/Invite/Auth/Onboarding
                   M1: Content/Classification/Ingestion/Knowledge
  src/ports        DataStore, ContentStore, Storage, Scanner, TextExtractor, AiProvider
  src/adapters     memory (dev/test), postgres (schema of record), bedrock (AI)
  src/http         minimal Fastify app (create school, invite, accept, login)
  test             one test per acceptance row + one per foundation
infra            AWS CDK (TypeScript) — region-pinned skeleton (no resources yet)
apps/web         React 19 + Vite shell (screens deferred)
db/migrations    SQL schema of record + audit-log grants/trigger + content tables
docs             foundational-decisions, decisions (ADRs), traceability
```

## Prerequisites

- Node.js ≥ 20 (developed on Node 24 LTS). No external database is required — the
  fast suite runs on an in-memory store, and the DB suite boots an **embedded**
  PostgreSQL (real engine, no install/Docker) on demand.

## Install

```bash
npm install
```

## Verify (run the full regression suite)

```bash
npm test
```

Expected: **266 passing tests** — 261 in `services/api` (every acceptance row for
M0–M11 plus the resequenced Appendix A FR-ADM-003 / FR-INT-001 and Appendix B
FR-WL-001..004: FR-ADM/FR-ONB, FR-CONT/FR-ING, FR-SKG, FR-ASM, FR-TDB/FR-CAP/FR-COH/FR-ADP,
FR-PEER, FR-TAG, FR-STU/FR-SAG, FR-PAR, FR-PDB, FR-REP/FR-CAP/FR-BSS, and the M11
FR-GOV/NFR governance-verification + two-mode red-team; plus the M4 synthetic-seed +
quarantine tests, the Ask-for-Help adversarial suite, the Principal transcript
back-door hunt, and every governance gate — approved-pool / sign-off /
draft-until-publish / auto-assign-blocked / publish-or-withhold / grounded-or-declined
/ state-layer-lockout / verification-before-data / consent-gated / audit-blocks-on-
logging-failure / erasure-preserves-hash-chain / drift-fails-safe) and 5 in `infra`
(region pinning). The **same 261 tests also run against Postgres** (see below).
Type-check with:

```bash
npm run typecheck
```

## Verify the database layer (real Postgres)

The persistence ports are async, so the **same acceptance suite runs against a
real (embedded) PostgreSQL** in addition to the in-memory store — the Postgres
adapters (`src/adapters/postgres/pg*.ts`) are proven by the exact same tests:

```bash
npm run test:pg-suite --workspace services/api   # 261 acceptance tests vs Postgres
```

And the DB-enforced governance guarantees (Foundational Decision 3 — the
append-only audit grants + immutability + hash-chain triggers, which the
in-memory adapter only *simulates*) have their own suite:

```bash
npm run test:db --workspace services/api         # 8 governance/constraint tests
```

`test:db` expects **8 passing** — migrations apply cleanly; `pathfinder_app` has
`INSERT`+`SELECT` only; the immutability trigger blocks `UPDATE` even for a
superuser; `DELETE` is refused except for the retention role; the hash-chain
trigger rejects broken-link inserts; the `skill_nodes` type and `terms` date
`CHECK`s hold; core rows round-trip. Both use `embedded-postgres` (a real engine,
no install/Docker). See [docs/decisions.md](docs/decisions.md) ADR-0016/0017.

## Run the API (dev)

```bash
npm run dev:api      # Fastify on http://127.0.0.1:3000 (in-memory store)
```

Smoke-test the Milestone 0 core loop:

```bash
# create a school
curl -s localhost:3000/schools -H 'content-type: application/json' -d '{
  "name":"Springfield High","campusName":"Main",
  "academicYear":{"name":"2026","terms":[{"name":"T1","startDate":"2026-01-28","endDate":"2026-04-10"}]}
}'
```

## Milestone 1 — Content Studio + Knowledge Engine

Upload (with type/size validation, malware-scan reject+quarantine, third-party
copyright attestation, duplicate/near-duplicate flagging), versioning +
concurrent-edit history, class/department sharing, ingestion (text/structure →
concept chunks; scanned→OCR flag; corrupted→failed, always terminal per
NFR-PERF-001), AI-suggested classification through the **single AI service
layer** (every call audited), and lesson/question/outcome linking with
outdated-outcome and orphaned-question views. The **teacher-approval gate is
load-bearing**: `ContentService.approvedPool` is the only set downstream features
read, and pending / unattested / unreviewed / un-ingested / quarantined /
archived content never appears in it.

**AI data path (Foundational Decision 2):** the service layer is operational via
an `AiProvider`. The production `BedrockProvider` targets `ap-southeast-2`
(guarded by the residency/zero-retention/no-training check); a local
deterministic provider (no network egress) backs dev and the test suite. **Live
Bedrock verification is deferred** — see docs/decisions.md ADR-0013.

## Milestone 2 — Skill Graph

The skill graph is **versioned trusted infrastructure** (Foundational Decision 4).
An AI-drafted NSW Year 8 Maths graph ships as a committed seed
(`db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json`) and imports as a
**draft**. The prerequisite graph is validated **acyclic on import and on every
structural edit**; **difficulty is an item attribute, never a node**. A graph
version must be **curriculum-expert signed off** (an explicit, audited governance
action — the program never self-certifies) before any content is mapped against
it. Then approved content maps through subject → strand → outcome → topic →
concept → skill → subskill (multi-skill supported; missing prerequisites flagged,
not blocked), and a Teacher can override any mapping — reflected everywhere, with
the remap-historical-data prompt and single-confirmation bulk override.

> The shipped seed is a representative **draft, not signed off**. A curriculum
> expert reviews and signs it off (`SkillGraphService.signOff`) before live use.

## Milestone 3 — Assessment Builder

A Teacher generates a draft assessment from a plain-language request, grounded
**only** in the approved + mapped pool — never fabricated. When the content can't
support the requested count it generates fewer and reports the shortfall
(FR-ASM-001); five question types with unsuitable-type flagging (FR-ASM-002);
rubrics, model answers and multiple versions with a difficulty-balance flag
(FR-ASM-003). Every generation call runs through the **AI service layer** (audited;
deterministic local provider — live Bedrock deferred, ADR-0013). A mid-run AI
failure yields a clear failed state with **no partial draft saved** and an audit
entry. All output **stays draft until the Teacher publishes** — publish requires a
review acknowledgement, accidental publish is reversible before the scheduled
start, and access to an unpublished assessment is denied **at the permission
layer** (not merely hidden) and logged; connectivity loss mid-attempt preserves
work to the last save point (FR-ASM-004).

## Milestone 4 — Synthetic student activity (engineering task, no FR IDs)

Seeds ~25 synthetic students in a class with varied mastery/misconception
patterns across the mapped skills, deliberately including the M5 edge cases
(small-cohort, stale-data, persistent-misconception, insufficient-data) so the
Teacher intelligence layer has real data to work against. **Quarantine rules are
enforced as requirements:** synthetic accounts are flagged at the schema level
(`users.synthetic`), hold no PII, are **excluded from every real/export/parent
surface** (`SyntheticService.exportRealStudents` / `realMastery`), are **deletable
before pilot go-live** (`deleteSyntheticStudents`, audited), and the tuning
thresholds are **recorded** (`SYNTHETIC_THRESHOLDS`, `provisional: true`) for
re-validation against real data after Milestone 7.

## Milestone 5a — Teacher Dashboard, Class-Focus, Cohorts, Adaptive Engine

The Teacher-facing intelligence layer, reading the M4 seeded activity:

- **FR-TDB-001 / FR-CAP-001** — a per-student, per-skill mastery **heatmap** with
  intervention/extension flags; a clear **"not enough data yet"** state for a
  class with no completed work; and cells that show a **trend** (e.g. a downward
  signal) rather than only the latest point (`TeacherDashboardService.heatmap`).
- **FR-TDB-002** — class-level **focus areas** (skills most of the class is weak
  on) with **suggested approved material** to reteach, or a **content-gap** prompt
  when none is mapped; a dismissed suggestion stays hidden **until the data
  worsens again**; and **auto-assign is blocked by design** — assigning material
  always requires an explicit teacher action (`classFocusAreas`,
  `dismissFocusArea`, `assignFocusMaterial`).
- **FR-COH-001 / FR-COH-002** — suggested **groups** (support, misconception,
  extension, review, peer-learning), all **editable before assigning**; a student
  may appear in **multiple** groups (the Teacher chooses); groups from **stale**
  data are labelled; and work is assigned only to the final, teacher-edited
  membership (`CohortService`).
- **FR-ADP-001 / FR-ADP-002** — the **adaptive engine** recommends the next best
  action (progression/extension, revision, hints, remediation, reassessment) and
  **escalates a persistent misconception to the Teacher** instead of looping
  remediation; it weighs **independent vs assisted** signals rather than the
  latest score alone; and a **spaced-revision reminder is deferred** while a
  student has an assessment in progress (`AdaptiveEngine`).

Everything here is a **draft requiring explicit teacher action** (Foundational
Decision 7). The M4 substrate was extended **additively** to carry a mastery
`history` (trend) and an `assisted_score` (conflicting signals) — see ADR-0020;
all M4 tests remain green.

## Milestone 5b — Peer Benchmarking, Peer Review & Peer Testing

The peer-comparison layer, on its own **publish-or-withhold** governance path
(never edit-then-approve). Computed results are immutable by construction:

- **FR-PEER-001** — teacher-facing cohort benchmarks (percentile bands); when
  published, students see only a **softened, non-ranked** signal ("above/at/below
  the cohort average"); small cohorts are **suppressed**; benchmarks are
  **withheld by default** and never auto-released (`PeerTestService`).
- **FR-PEER-002** — anonymised **peer review** with teacher moderation before
  release; a teacher can reject/hide but **never rewrite** wording; anonymity-risk
  flagging in small cohorts; a neutral "no peer feedback this round" for zero
  reviews (`PeerReviewService`).
- **FR-PEER-003** — the **Peer Test Builder** (questions, rubric, cohort,
  anonymity, accommodations); the **accommodation-vs-anonymity** tension is warned,
  and an over-scoped test tells the teacher what content is missing.
- **FR-PEER-004** — **delivery**: launch places the test on each student's
  dashboard/calendar; cohort membership **locks at launch**; cancel removes it
  cleanly.
- **FR-PEER-005** — **results**: completion status + benchmark with an explicit
  publish/withhold decision; **no direct editing** of computed figures — a genuine
  correction goes through a separate, **logged** path (`recordCorrection`).

## Milestone 6 — Teacher Agent

A curriculum/lesson-planning assistant grounded in everything built so far
(`AgentService`), through the single AI service layer (audited):

- **FR-TAG-001 / FR-TAG-002** — draft **unit sequences, lesson plans, and
  differentiated activities** grounded in approved content; a request with **no
  grounding content is declined honestly** (never an invented plan); differentiation
  for a class with no capability data is **generic and labelled** as not yet
  personalised.
- **FR-TAG-003** — draft **parent communications and feedback** (drafts only):
  editable before sending, **never auto-sent**, persist unsent; **behavioural/social
  observations are separated** from academic content and **flagged for extra review**.
- **FR-TAG-004** — **every suggestion shows its approved-content grounding** (no
  exceptions); **all** sources are listed when several are used; a source archived
  after the fact keeps a (now-archived) **reference rather than a broken link**.

## Milestone 7 — Student Workspace + Ask for Help (highest-risk)

Real students (not synthetic) see and complete teacher-assigned tasks, with the
task-gated tutor:

- **FR-STU-001 / FR-STU-003** — a **low-analytics dashboard** of today's/this-week's
  tasks and assessments; a friendly "nothing assigned yet" state; **overdue marked
  without shaming** and the assigning teacher notified (`StudentWorkspaceService`).
- **FR-STU-004** — a **calendar** of permitted events; events **restricted to another
  year group are invisible**; a rescheduled event updates and is **flagged as changed**.
- **FR-STU-002 / FR-SAG-001 / FR-SAG-002** — **Ask for Help** (`AskForHelpService`):
  scoped hints grounded in the task's approved content, **never the answer**; the
  **assessment-in-progress lockout is enforced at the task-state layer** (not a
  prompt); off-topic and direct-answer-extraction attempts are **refused**
  (deterministic classifiers, verified by a >100-attempt adversarial suite at ≥95%
  refusal, 0% leak); **transcripts are visible to the assigning teacher, never to a
  Principal**; a **safeguarding disclosure escalates** to the configured contact; and
  the tutor **won't enable without a configured safeguarding contact + SLA**.

## Milestone 8 — Parent Dashboard

Plain-language progress visibility for a **verified** parent (`ParentService`):

- **FR-PAR-001 / FR-PAR-005** — a plain-language summary of strengths, focus areas
  and recent activity; **no recent activity is stated plainly** (not stale data);
  internal jargon (node ids/codes) is **translated to everyday topic words**.
- **FR-PAR-003** — **verification-before-data is absolute**: nothing shows until
  the parent-child link is verified, a parent only ever sees their **own** child
  (another student is denied), children are **never merged**, and summaries are
  **never diagnostic** — a code-level guard enforces observational wording (the DoD
  calls this out specifically).
- **FR-PAR-006** — a child-scoped **calendar** (parent-teacher meetings,
  assessments, etc.); children in different year groups get **separate** calendars.
- **FR-PAR-004** — a **single weekly consolidated** notification when there's new
  activity, **none** when there's nothing; **safeguarding is the only off-cadence
  path** (immediate, via FR-SAF-002) — no separate "urgent" class.

## Milestone 9 — Principal Dashboard (school-level)

A whole-school view scoped to one school (`PrincipalDashboardService`):

- **FR-PDB-001** — per-teacher **coverage / AI-approval / edit-rate / engagement /
  workload** + school-wide; low-activity teachers **flagged distinctly**; new
  teachers shown in a **shorter window**, not compared unfairly.
- **FR-PDB-002** — **school-wide mastery & risk**; an **outlier class is
  highlighted**, not smoothed into the average.
- **FR-PDB-003** — **drill school → class → student**; **no cross-campus
  comparison** (out of MVP scope); Ask-for-Help excluded even at the deepest level.
- **FR-PDB-004** — **threshold-based anomaly alerts** (sharp mastery drops); a
  configured **seasonal break** suppresses expected dips; minor fluctuations don't
  alert (no fatigue).
- **FR-PDB-005** — **the non-negotiable**: Ask-for-Help tutor transcripts are
  **unreachable from every Principal surface including exports**, enforced
  structurally (the service never reads the help store) and verified by a
  back-door hunt. A dual-role Principal-Teacher sees transcripts only via their
  Teacher capacity, for their own classes.
- **FR-PDB-006** — sensitive teacher-to-teacher **comparison views are policy-gated**
  (off by default; enabling applies going forward).

## Milestone 11 — Governance / audit hardening pass

A verification pass (no new features) that the incrementally-built governance holds
end-to-end, plus a deliberate red-team against the two failure modes the whole model
rests on:

- **Red-team A** — no path where AI content reaches a student without teacher action
  (assessment draft + student-denied until published; agent drafts never auto-send;
  focus material `AUTO_ASSIGN_BLOCKED`; inference claims withheld until approved).
- **Red-team B** — no Principal surface (incl. exports) exposes Ask-for-Help
  transcripts (back-door hunt across every surface).
- **FR-GOV-002** — a logging failure **blocks** the AI action; AI calls log grounding
  provenance + timestamp.
- **FR-GOV-003** — retention deletes aged data and **logs its own deletions**.
- **FR-GOV-006** — data-subject **export** + **erasure** that removes PII while
  **preserving the hash chain** (audited facts retained, chain still verifiable);
  active records require an explicit confirm.
- **FR-GOV-007** — provider **drift fails safe** (the choke point pauses); unapproved
  / offshore / training-enabled endpoints are blocked architecturally.
- **FR-GOV-005** — anti-rubber-stamping: review-duration + items-opened on the audit
  entry, a non-blocking bulk-approval spot-check prompt (aggregate only).
- **NFR-COST-001** — per-user fair-use caps decline rather than bill unbounded.
- **NFR-SEC/AUD/PRV/SAF + FR-SAF-002** verified by test (roles distinct; provenance
  survives archival; content never cross-school; safety trips clear+logged;
  safeguarding events restricted to the nominated contact).

> Not unit-tested (documented as build requirements): **NFR-A11Y-001** (WCAG 2.2 AA)
> applies to the production persona UIs, which are deferred (ADR-0012); **NFR-PERF-001**
> full latency/load targets are runtime SLOs (the "always resolves to a terminal
> status" invariant is covered).

## Milestone 10 — Reporting (academic, co-curricular, behavioural/social)

- **FR-REP-001** — teacher **growth reports** reflecting the term's mastery change;
  partial-term data is **flagged as limited/early**.
- **FR-REP-002** — whole-school reports (**school-level only**): performance,
  coverage, usage, and a **prorated cost report** for partial-month billing.
- **FR-REP-004** — parent term reports (strengths / focus / teacher comments /
  co-curricular); **empty sections omit gracefully**.
- **FR-CAP-002** — **co-curricular** capability (sport/arts/music) in its own
  **simpler structure** (free-text skill + level, not the academic skill graph),
  kept separate from academic mastery.
- **FR-BSS-001/002** — behavioural/social observations in a **separate data model**:
  the four v1.3 categories only, teacher-authored, **no AI inference (blocked by
  design)**, **collection consent-gated**, and **per-persona visibility** (author
  Teacher + Admin notes; Principal aggregate; Parent hidden until enabled).

## Appendix Milestone A — CSV import + SSO (FR-ADM-003 / FR-INT-001)

Resequenced out of Milestone 0 by the plan (manual account creation unblocked the
core loop), now built with their Appendix acceptance rows intact:

- **FR-ADM-003 — CSV import** (`CsvImportService`): bulk-create users from a CSV.
  Each row is independent — a **malformed** row (missing field / bad role / bad
  email / unknown class) is rejected with a **specific per-row error** while valid
  rows still import; a **duplicate** email (already in the system or earlier in the
  file) is flagged and skipped, never creating a conflicting account. A cell that
  begins with `= + - @` (spreadsheet **formula injection**, NEW v1.4) is neutralised
  to inert text on import **and** on export, and its row is **flagged for review**.
- **FR-ADM-003 / FR-INT-001 — SSO** (`SsoService`, via an `IdentityProviderPort`):
  a school federates with one provider (Google Workspace / Microsoft Entra ID) for
  one email domain. A sign-in **outside** that domain is **denied with a clear
  message**; an **IdP outage** surfaces a distinct service-unavailable error (not a
  generic login failure); an account **revoked upstream** is denied **and** its
  cached sessions are purged so no stale session survives. The happy path issues a
  session with **no password created**. Real Google/Microsoft OIDC verification is
  deferred like live Bedrock (ADR-0013/0029); the port, guards and tests are in place.

## Appendix Milestone B — White-label / multi-tenant branding (FR-WL-001..004)

Each school can brand its own instance, touching **only** the themeable brand layer
(Foundational Decision 5) — the fixed governance tokens are never reachable
(`BrandingService`, `domain/branding.ts`):

- **FR-WL-001** — configure brand **colour** (validated against the WCAG-AA floor;
  a failing colour is not saved silently — it returns an **auto-adjusted
  alternative**), **logo** and favicon. Uploaded logos are **sanitised**: an SVG
  carrying scripts/handlers/active content is **rejected** (NEW v1.4), and raster
  logos are malware-scanned — only safe image content is ever stored. With no
  branding set, **default Pathfinder branding** is shown, never a broken state.
- **FR-WL-002** — full **white-label**: the school's product name replaces
  "Pathfinder" and attribution is hidden on **user** surfaces; **internal support
  tooling always shows the real Pathfinder identity** (the override is
  presentation-layer only); reverting is **not retroactive** to reports already issued.
- **FR-WL-003** — one resolver drives **app, PDF report and email** so they match;
  reports are **point-in-time artifacts** that snapshot their branding at issue and
  are never retroactively rebranded; a logo that fails to load falls back to the
  **school name** (text), never a broken image.
- **FR-WL-004** — governance-critical visual states (draft / approved /
  locked-computed) render with **fixed platform tokens regardless of branding**; a
  request to recolour a governance status is **declined by design**; and the WCAG-AA
  contrast floor is **enforced server-side** at resolve time regardless of what was
  stored.

The **AA floor is evaluated as white-on-primary** (the platform's fixed on-primary
text colour), because any solid colour clears AA against black *or* white — the
meaningful floor is the pairing actually rendered (see ADR-0030).

## What is intentionally NOT here yet

The post-M5 **validation checkpoint** (Section 5 — the real-world pilot gate) as a
live pilot, live Bedrock calls, the live Google/Microsoft OIDC provider behind the
SSO port (ADR-0029), the real logo image bytes / object store behind the branding
layer (the sanitise + reference model is complete; S3 in `ap-southeast-2` is wired
when provisioned), and the production web UI screens (the preview console does not
yet include peer, agent, student, parent, principal, reporting, import/SSO, or
branding screens).
