# Handoff — Milestone 0

**Date:** 2026-08-09
**Milestone:** 0 — Project skeleton + minimal School-Admin onboarding — **COMPLETE**
**Suite:** `npm test` → **55 passing** (50 `services/api`, 5 `infra`). `npm run typecheck` clean.

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
