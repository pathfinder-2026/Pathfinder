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

## ADR-0012 — Web UI screens deferred to Milestone 1
Milestone 0's acceptance criteria are all backend/service logic and the plan says
"nothing needs to be pretty yet". `apps/web` is a working React/Vite shell so the
tooling and token split have a home; screens are built when Content Studio needs
them.
