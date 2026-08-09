# Milestone 0 traceability — acceptance rows → tests

Every in-scope Given/When/Then row from the MVP Build Plan v1.4 maps to at least
one automated test. Run `npm test`.

## FR-ADM-001 — Create school; campuses, academic years, terms
`services/api/test/fr-adm-001.test.ts`

| Row | Test |
|---|---|
| Happy path — account created, can proceed to invite staff | "happy path: creates the school and lets the Admin proceed to invite staff" |
| Edge — duplicate school name → warn + confirm | "edge — duplicate school name: warns and requires confirmation…" |
| Edge — campus added later inherits settings, may have own year | "edge — campus added later: inherits global settings, may have its own year/terms" |
| Edge — incomplete term dates block saving | "edge — incomplete term dates: blocks saving with a validation error" |

## FR-ADM-002 — Manage accounts, roles, permissions
`services/api/test/fr-adm-002.test.ts`

| Row | Test |
|---|---|
| Happy — role/class change without re-login | "happy path: a class/role change takes effect immediately without re-login" |
| Edge — removing the only Admin blocked | "edge — removing the only Admin is blocked until another Admin is designated" |
| Edge — student transfer keeps Class A history for original Teacher | "edge — student transferred mid-term: active workspace is Class B, Class A history stays visible…" |

## FR-ADM-007 — Assign Principal to campuses
`services/api/test/fr-adm-007.test.ts`

| Row | Test |
|---|---|
| Happy — aggregated across both campuses in one school | "happy path: a Principal assigned to two campuses gets an aggregated scope…" |
| Edge — campus not configured → assignment allowed, flagged | "edge — campus not yet configured: assignment is allowed but flagged…" |
| Edge — reassignment revokes previous campus immediately | "edge — reassignment mid-term revokes access to the previous campus immediately" |

## FR-ONB-001 — Role-appropriate onboarding
`services/api/test/fr-onb-001.test.ts`

| Row | Test |
|---|---|
| Happy — Teacher sees Teacher flow, not Admin | "happy path: a newly invited Teacher sees a Teacher-specific flow…" |
| Edge — dual role, shared steps not duplicated | "edge — dual role: onboarding covers both roles without duplicating shared steps" |
| Edge — invite accepted early → waiting state, not error | "edge — invite accepted early: shows a 'waiting on school setup' state…" |

## FR-ONB-002 — Seven-step Admin onboarding
`services/api/test/fr-onb-002.test.ts`

| Row | Test |
|---|---|
| Happy — all steps in order → live workspace | "happy path: proceeding through all steps in order lands the Admin in the live workspace" |
| Edge — skip a step blocked, return to first incomplete | "edge — skipping a step: jumping to Enter Workspace is blocked…" |
| Edge — resume mid-flow at first incomplete step | "edge — resume later: resumes at the first incomplete step, not step one" |
| Edge — zero teachers → warn + confirm | "edge — zero teachers invited: warns and requires confirmation before finishing" |

## Foundations (from the M0 definition of done + this session's brief)

| Foundation | Test file |
|---|---|
| Append-only hash-chained audit + DB grants (Decision 3) | `foundation-audit.test.ts` |
| Notification/event service, invite as first consumer | `foundation-notifications.test.ts` |
| Governance state machine draft→approved→published (Decision 7 / FR-GOV-001) | `foundation-governance.test.ts` |
| AI service layer empty choke point + guard (Decision 2) | `foundation-ai-chokepoint.test.ts` |
| Fixed governance vs. themeable brand tokens (Decision 5) | `foundation-design-tokens.test.ts` |
| Minimised data model + per-student erasure (Decision 6) | `foundation-erasability.test.ts` |
| Inference approvable state field (Decision 7) | `foundation-inference-approvable.test.ts` |
| Region pinning (Decision 1) | `infra/test/region.test.ts` |
| DoD end-to-end: log in as invited Teacher | `auth-login.test.ts` |
