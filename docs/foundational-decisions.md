# Foundational decisions — how each is encoded (Milestone 0)

The seven locked decisions from the MVP Build Plan v1.4, mapped to where they
live in the code and how they are tested.

## 1. Hosting & data residency (AU)

- `infra/src/region.ts` — `PRIMARY_REGION = "ap-southeast-2"`, `assertAuRegion`
  refuses any non-AU region; `infra/bin/app.ts` pins the CDK stack `env.region`.
- `infra/src/pathfinderStack.ts` refuses to construct outside an approved AU
  region.
- Tests: `infra/test/region.test.ts`.
- Real data-bearing resources (RDS/Aurora, S3, SES, CloudWatch) are added in the
  milestones that need them; M0 only pins the region.

## 2. AI / LLM data path (single choke point)

- `services/api/src/platform/ai/aiServiceLayer.ts` — the one place all LLM calls
  must pass through. In M0 it is **empty** (`run()` throws); the residency /
  zero-retention / no-training guard (`assertCompliantEndpoint`) already exists
  and cannot be bypassed. Becomes operational in Milestone 1.
- Tests: `services/api/test/foundation-ai-chokepoint.test.ts`.

## 3. Persistence & append-only audit log

- `services/api/src/platform/audit/auditLog.ts` — hash-chained recorder,
  append-only API (no update/delete), `verifyChain` detects tampering.
- `db/migrations/0002_audit_log_grants.sql` — app role granted **INSERT +
  SELECT only**; retention deletion is a separate privileged role; immutability
  + chain-linkage enforced by triggers.
- Every significant admin action in M0 is recorded (school/campus creation,
  account/role changes, principal assignment, invites, login, erasure).
- Tests: `services/api/test/foundation-audit.test.ts`.

## 4. Skill graph (versioned trusted infrastructure)

- Not built in M0 (Milestone 2). No schema shortcuts were taken that would block
  representing prerequisites as a validated acyclic graph with difficulty as an
  item attribute.

## 5. Design-system token separation

- `services/api/src/platform/designSystem/tokens.ts` — `GOVERNANCE_TOKENS`
  (draft/approved/published/locked-computed) are deep-frozen and
  non-overridable; `themeTokens()` merges **brand** overrides only.
- Tests: `services/api/test/foundation-design-tokens.test.ts`.

## 6. Data minimisation & per-student erasability

- PII lives ONLY in `personal_data` (`src/domain/types.ts`,
  `src/adapters/postgres/schema.ts`, `db/migrations/0001_init.sql`). Structural
  entities (`users`, `memberships`, `enrolments`) carry no PII.
- `AccountService.erasePersonalData` removes the PII, tombstones the user
  (`status = "erased"`) and retains the audited facts.
- Tests: `services/api/test/foundation-erasability.test.ts`.

### PII inventory (every personal field justified)

| Field | Where | Justification |
|---|---|---|
| `email` | `personal_data.email` | Account identity, login, and invite delivery. Erasable. |
| `first_name`, `last_name` | `personal_data` | Human-readable identification for teachers/admins. Erasable. |

No other personal fields are stored in Milestone 0. Student behavioural/social
data, guardian contacts, etc. are out of scope until the milestones that
introduce them (each field to be justified when added).

## 7. Governance gate + approvable inference state

- Governance state machine `src/platform/governance/governanceState.ts`
  (draft → approved → published); approval requires an explicit approver
  (never automatic).
- `inference_records.approval_state` exists from the first schema (default
  `unreviewed`); `src/domain/inference.ts` gates surfacing with
  `canSurfaceToStakeholder`. No records are produced in M0 — the gate can be
  switched on later without a schema migration.
- Tests: `foundation-governance.test.ts`, `foundation-inference-approvable.test.ts`.
