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
  must pass through. It enforces `assertCompliantProvider` (AU region +
  zero-retention + no-training; a local in-process provider reaches no endpoint
  and is inherently compliant) and **writes an audit entry on every call**
  (Decision 3).
- **M1: operational via an `AiProvider` port.** Production =
  `src/adapters/bedrock/bedrockProvider.ts` (Bedrock, ap-southeast-2, guarded).
  Dev/tests = `LocalClassifierProvider` (no network egress). **Live Bedrock
  verification is deferred** (no AWS creds in this environment) — see
  docs/decisions.md ADR-0013. No student-data prompt can reach an offshore or
  training-enabled endpoint: the guard throws first.
- Classification (FR-CONT-002) is the only M1 consumer; concept generation is
  deterministic (not an LLM call).
- Tests: `foundation-ai-chokepoint.test.ts`, `m1-ai-servicelayer.test.ts`.

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

- **Built in M2.** `src/domain/skillGraph.ts` — prerequisite cycle detection
  (`findPrerequisiteCycle`) + `validateGraphSource` runs on import and every
  structural edit (`SkillGraphService.addPrerequisite` rejects cycle-creating
  edges). Difficulty is an item attribute on `ContentMapping`, and the node-type
  union / SQL `CHECK` make 'difficulty' impossible as a node.
- **Sign-off gate:** graph versions carry a `draft` → `signed_off` governance
  state; `MappingService` refuses to map against an unsigned graph. The program
  never self-signs — a human expert calls `signOff(expertId)` (audited).
- AI-drafted seed: `db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json`
  (ships `draft`/unsigned).
- Tests: `m2-skillgraph-import`, `m2-signoff-gate`, `m2-skg-001/002/004`.

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
- **M3 extends the gate to assessments:** AI-generated assessments stay `draft`
  until a teacher publishes; publish requires a review acknowledgement; access to
  an unpublished assessment is denied at the permission layer (`getForStudent`)
  and logged — nothing AI-generated reaches a student without explicit teacher
  action.
- Tests: `foundation-governance.test.ts`, `foundation-inference-approvable.test.ts`,
  `m3-asm-004-publish.test.ts`.
