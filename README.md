# Pathfinder

An AI teaching-and-learning platform for schools. This repository is built
strictly against the **MVP Build Plan v1.4** (a planning artifact kept outside
the codebase). Features are added milestone by milestone; nothing is built ahead
of the current milestone.

> **Status: Milestone 0 complete** — project skeleton + minimal School-Admin
> onboarding, plus the platform foundations every later milestone depends on.

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
  src/services     SchoolService, AccountService, PrincipalService, InviteService,
                   AuthService, OnboardingService
  src/http         minimal Fastify app (create school, invite, accept, login)
  test             one test per acceptance row + one per foundation
infra            AWS CDK (TypeScript) — region-pinned skeleton (no resources yet)
apps/web         React 19 + Vite shell (screens deferred to Milestone 1)
db/migrations    SQL schema of record + audit-log grants/trigger
docs             foundational-decisions, decisions (ADRs), traceability
```

## Prerequisites

- Node.js ≥ 20 (developed on Node 24 LTS). No database is required to run the
  test suite — Milestone 0 runs on an in-memory store (see
  [docs/decisions.md](docs/decisions.md), ADR-0007).

## Install

```bash
npm install
```

## Verify (run the full regression suite)

```bash
npm test
```

Expected: **55 passing tests** — 50 in `services/api` (every FR-ADM-001/002/007
and FR-ONB-001/002 acceptance row, plus the foundations) and 5 in `infra`
(region pinning). Type-check everything with:

```bash
npm run typecheck
```

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

## What is intentionally NOT here yet

Content upload/ingestion, the skill graph, assessments, dashboards, synthetic
data, parent/principal dashboards, reporting, real Bedrock calls, CSV import and
SSO (FR-ADM-003 / FR-INT-001, explicitly deferred by the plan), and the web UI
screens. These belong to later milestones.
