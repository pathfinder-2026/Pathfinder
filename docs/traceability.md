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

# Milestone 1 traceability — acceptance rows → tests

## FR-CONT-001 — Upload  (`m1-cont-001-upload.test.ts`)
| Row | Test |
|---|---|
| Happy — multiple files, correct type | "happy path: multiple files upload at once…" |
| Edge — unsupported type rejected | "edge — unsupported file type is rejected listing supported formats" |
| Edge — oversized stops early | "edge — oversized file stops early with a clear size-limit message" |
| Edge — duplicate flagged | "edge — duplicate upload completes but is flagged a likely duplicate" |
| Edge (NEW v1.4) — security scan reject/quarantine/log | "edge (NEW v1.4) — a file failing the security scan…" |
| Edge (NEW v1.4) — copyright attestation gate | "edge (NEW v1.4) — third-party copyright: unattested content is excluded…" |

## FR-CONT-002 — AI classification  (`m1-cont-002-classification.test.ts`)
| Row | Test |
|---|---|
| Happy — suggestions appear for review | "happy path: subject/year/topic/outcome/difficulty suggestions appear…" |
| Edge — low confidence flagged | "edge — low confidence is visibly flagged…" |
| Edge — teacher edit persists | "edge — teacher edits the classification and it persists…" |
| Edge — never reviewed excluded from pool | "edge — never reviewed: content is excluded from the approved-content pool" |

## FR-CONT-003 — Versioning / duplicates / archiving  (`m1-cont-003-versioning.test.ts`)
| Row | Test |
|---|---|
| Happy — revised version retains history | "happy path: a revised version retains the old one in history…" |
| Edge — near-duplicate flagged for review | "edge — near-duplicate content is flagged for teacher review…" |
| Edge — archive-in-use warns | "edge — archiving content in active use warns before confirming" |
| Edge (NEW v1.4) — concurrent edits both versioned | "edge (NEW v1.4) — concurrent edits both become versions…" |

## FR-CONT-004 — Share / restrict  (`m1-cont-004-sharing.test.ts`)
| Row | Test |
|---|---|
| Happy — class-restricted invisible to others | "happy path: a class-restricted item is invisible…" |
| Edge — student class change revokes access | "edge — a student who changes class loses access…" |
| Edge — dept leaver revoked, content remains | "edge — a departing department member loses access, but the content remains…" |

## FR-ING-001/002 — Extraction  (`m1-ing-extract.test.ts`)
| Row | Test |
|---|---|
| Happy — text PDF → chunks/concepts | "happy path: a text-based PDF yields headings/paragraphs…" |
| Edge — scanned → needs OCR | "edge — a scanned PDF with no selectable text is flagged for OCR…" |
| Edge — corrupted → failed (terminal) | "edge — a corrupted file resolves to a clear ingestion-failed status…" |

## FR-ING-003/004 — Linking  (`m1-ing-linking.test.ts`)
| Row | Test |
|---|---|
| Happy — links visible/navigable | "happy path: a lesson's linked questions and outcomes are all visible…" |
| Edge — retired outcome flagged outdated | "edge — a retired curriculum outcome is flagged 'outdated'…" |
| Edge — orphaned question in needs-linking | "edge — an orphaned question surfaces in the 'needs linking' view" |

## M1 cross-cutting
| Property | Test file |
|---|---|
| Approved-pool gate (pending never in pool) | `m1-approved-pool.test.ts` |
| AI call goes through service layer + audited; offshore refused | `m1-ai-servicelayer.test.ts` |
| NFR-PERF-001 ingestion always terminal, fast | `m1-perf-ingestion.test.ts` |

# Milestone 2 traceability — acceptance rows → tests

## FR-SKG-001 — Map through the hierarchy  (`m2-skg-001-mapping.test.ts`)
| Row | Test |
|---|---|
| Happy — full chain + difficulty attribute | "happy path: content links through the correct chain…" |
| Edge — multi-skill content maps to multiple nodes | "edge — content spanning multiple skills maps to multiple nodes" |
| Edge — missing prerequisite flagged, not blocked | "edge — a skill with no defined prerequisite is flagged…" |

## FR-SKG-002 — Curriculum support  (`m2-skg-002-curriculum.test.ts`)
| Row | Test |
|---|---|
| Happy — NSW codes used | "happy path: a NSW school maps to NSW curriculum codes…" |
| Edge — curriculum switch flags re-mapping | "edge — switching curriculum mid-year flags previously mapped content…" |
| Edge — undefined custom outcomes → pending | "edge — a custom curriculum with no defined outcomes makes outcome mapping pending" |

## FR-SKG-004 — Teacher overrides  (`m2-skg-004-overrides.test.ts`)
| Row | Test |
|---|---|
| Happy — override reflected everywhere | "happy path: an override is saved and reflected everywhere…" |
| Edge — mastery data → remap-historical prompt | "edge — overriding with existing mastery data prompts to remap history…" |
| Edge — bulk override, single confirmation | "edge — a bulk override applies with a single confirmation" |

## M2 cross-cutting (Foundational Decision 4)
| Property | Test file |
|---|---|
| Import validates acyclic; difficulty-as-node rejected; edit re-validates | `m2-skillgraph-import.test.ts` |
| Sign-off gate: no mapping against an unsigned graph; sign-off audited | `m2-signoff-gate.test.ts` |

# Milestone 3 traceability — acceptance rows → tests

## FR-ASM-001 — Grounded generation  (`m3-asm-001-generation.test.ts`)
| Row | Test |
|---|---|
| Edge — insufficient content → fewer + shortfall (tested FIRST) | "edge — insufficient approved content: generates fewer well-grounded questions…" |
| Happy — draft from approved content only | "happy path: a draft is generated using only the approved content" |
| Edge — unapproved content excluded + notified | "edge — unapproved content referenced: the generator excludes it and notifies why" |
| Edge (NEW v1.4) — mid-run failure, no partial, audited | "edge (NEW v1.4) — generation fails mid-run: clear failed state, no partial draft…" |

## FR-ASM-002 — Question types  (`m3-asm-002-types.test.ts`)
| Row | Test |
|---|---|
| Happy — exact requested mix | "happy path: the draft contains exactly the requested mix of types" |
| Edge — unsuitable type flagged, not forced | "edge — unsuitable question type is flagged, not forced" |

## FR-ASM-003 — Rubrics / model answers / versions  (`m3-asm-003-rubrics-versions.test.ts`)
| Row | Test |
|---|---|
| Happy — extended-response gets rubric + model answer | "happy path: an extended-response question gets a matching rubric and model answer" |
| Edge — multiple versions, same outcomes/difficulty, different wording | "edge — multiple versions test the same outcomes at matched difficulty…" |
| Edge — imbalanced difficulty flagged | "edge — imbalanced difficulty: generates what it can and flags it couldn't be met" |

## FR-ASM-004 — Draft-until-publish  (`m3-asm-004-publish.test.ts`)
| Row | Test |
|---|---|
| Happy — unpublished not accessible to students | "happy path: an unpublished assessment cannot be accessed by students" |
| Edge — accidental publish reversible before start | "edge — accidental publish is reversible before the scheduled start time" |
| Edge — publish requires review acknowledgement | "edge — publish without review is blocked until a review acknowledgement" |
| Edge (NEW v1.4) — direct-link denied at permission layer + logged | "edge (NEW v1.4) — direct-link access… denied at the permission layer and logged" |
| Edge (NEW v1.4) — connectivity loss preserves work, visible to Teacher | "edge (NEW v1.4) — connectivity loss mid-assessment preserves work…" |

# Milestone 4 traceability — DoD + quarantine → tests  (`m4-synthetic.test.ts`)

M4 has no FR IDs; its tests come from the definition of done and the quarantine
rules (requirements).

| Property | Test |
|---|---|
| ~25 synthetic students, schema-level flag, no PII | "seeds ~25 synthetic students, flagged synthetic at the schema level, holding no PII" |
| Varied mastery across mapped skills | "produces varied mastery across the mapped skills" |
| Exercises M5 edges (small-cohort / stale / persistent-misconception / insufficient-data) | "includes the M5 edge cases…" |
| Quarantine — excluded from real/export/parent surfaces | "quarantine — synthetic students are excluded from any real/export surface" |
| Quarantine — deletable before go-live; real untouched; audited | "quarantine — synthetic students are deletable before go-live…" |
| Quarantine — thresholds recorded for post-M7 re-validation | "quarantine — tuning thresholds are recorded for re-validation…" |
| Seeding refuses without a signed-off skill graph | "refuses to seed without a signed-off skill graph" |

# Milestone 5a traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 5a section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-TDB-001 / FR-CAP-001 — mastery heatmap  (`m5a-tdb-001-dashboard.test.ts`)
| Row | Test |
|---|---|
| Happy — per-student/per-skill heatmap with intervention/extension flags | "happy path — a per-student, per-skill heatmap with intervention/extension flags" |
| Edge — insufficient data → clear "not enough data yet" state | "edge — insufficient data: a brand-new class shows a clear 'not enough data yet' state" |
| Edge — inconsistent performance → trend, not only the latest point | "edge — inconsistent performance: the heatmap reflects the TREND, not only the latest point" |

### FR-TDB-002 — class focus areas  (`m5a-tdb-002-focus.test.ts`)
| Row | Test |
|---|---|
| Happy — weak skill surfaced with suggested approved material | "happy path — a weak skill is surfaced with suggested approved material to reteach it" |
| Edge — no suitable material → content-gap prompt | "edge — no suitable material: a focus area with no approved content is flagged as a content gap" |
| Edge — dismissed suggestion doesn't reappear identically, returns if data worsens | "edge — dismissed suggestion: doesn't reappear next session, but does if the data worsens again" |
| Edge — auto-assign attempted → blocked by design (explicit teacher click) | "edge — auto-assign attempted: blocked by design, requiring an explicit teacher action" |

### FR-COH-001 / FR-COH-002 — cohorts  (`m5a-coh-groups.test.ts`)
| Row | Test |
|---|---|
| Happy — shared-misconception group, editable before assigning | "happy path — students sharing a misconception are suggested as an editable group" |
| Edge — student fits multiple groups → shown in both, not forced | "edge — a student who fits multiple groups is shown in both, not forced into one" |
| Edge — teacher edits membership → only remaining students receive work | "edge — a student removed before assigning does not receive the work" |
| Edge — stale data → group labelled as based on older data | "edge — a group built from stale data is labelled as based on older data" |

### FR-ADP-001 / FR-ADP-002 — adaptive engine  (`m5a-adp-adaptive.test.ts`)
| Row | Test |
|---|---|
| Happy — strong mastery → progression/extension, not repetition | "happy path — strong mastery recommends progression/extension, not repeating content" |
| Edge — persistent misconception → escalate to Teacher, not loop remediation | "edge — a persistent misconception escalates to the Teacher instead of auto-remediating" |
| Edge — conflicting signals → weigh both, not only the latest score | "edge — conflicting signals: the recommendation weighs both, not only the latest score" |
| Edge — spaced revision during assessment → deferred, not interrupting | "edge — a spaced-revision reminder is deferred while an assessment is in progress" |
