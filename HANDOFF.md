# Handoff — Milestone 1

**Date:** 2026-08-09
**Milestone:** 1 — Content Studio + Knowledge Engine — **COMPLETE**
**Suite:** `npm test` → **85 passing** (80 `services/api`, 5 `infra`). `npm run typecheck` clean.

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
