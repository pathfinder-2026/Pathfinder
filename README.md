# Pathfinder

An AI teaching-and-learning platform for schools. This repository is built
strictly against the **MVP Build Plan v1.4** (a planning artifact kept outside
the codebase). Features are added milestone by milestone; nothing is built ahead
of the current milestone.

> **Status: Milestone 2 complete** — Skill Graph (versioned trusted
> infrastructure: import → validate acyclic → expert sign-off → map approved
> content through the full chain, with teacher overrides), on top of Milestone 1
> (Content Studio + Knowledge Engine) and Milestone 0 (skeleton + foundations).

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

Expected: **101 passing tests** — 96 in `services/api` (every M0 FR-ADM/FR-ONB,
M1 FR-CONT/FR-ING, and M2 FR-SKG-001/002/004 acceptance row, plus the approved-pool
and skill-graph sign-off gates, acyclicity validation, the AI-service-layer audit
path, and the foundations) and 5 in `infra` (region pinning). Type-check with:

```bash
npm run typecheck
```

## Verify the database layer (real Postgres)

The SQL migrations and the DB-enforced governance guarantees (Foundational
Decision 3 — the append-only audit grants + immutability + hash-chain triggers,
the things the in-memory adapter only *simulates*) are validated against a real,
embedded PostgreSQL:

```bash
npm run test:db --workspace services/api
```

Expected: **8 passing** — migrations `0001–0004` apply cleanly; the `pathfinder_app`
role has `INSERT`+`SELECT` only (no `UPDATE`/`DELETE`); the immutability trigger
blocks `UPDATE` even for a superuser; `DELETE` is refused except for the retention
role; the hash-chain trigger rejects out-of-order/broken-link inserts; the
`skill_nodes` type and `terms` date `CHECK`s hold; and core rows (jsonb/timestamptz)
round-trip. See [docs/decisions.md](docs/decisions.md) ADR-0016.

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

## What is intentionally NOT here yet

Assessments (M3), synthetic data (M4), dashboards/cohorts (M5), parent/principal
dashboards, reporting, live Bedrock calls, CSV import and SSO (FR-ADM-003 /
FR-INT-001, plan-deferred), and the web UI screens. These belong to later
milestones.
