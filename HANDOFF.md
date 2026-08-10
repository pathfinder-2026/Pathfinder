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
