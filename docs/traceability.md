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

# Milestone 5b traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 5b section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-PEER-001 — cohort benchmarking  (`m5b-peer-001-benchmark.test.ts`)
| Row | Test |
|---|---|
| Happy — full cohort comparison (percentile bands) for every student | "happy path — full cohort comparison (percentile bands) for every student" |
| Edge — published to students → softened, non-ranked signal only | "edge — published to students: only a softened, non-ranked signal…" |
| Edge — cannot edit results (publish/withhold don't change figures) | "edge — cannot edit results: publish/withhold don't change the computed figures…" |
| Edge — small cohort suppressed/flagged | "edge — small cohort: suppressed/flagged as statistically unreliable…" |
| Edge — withheld by default, never auto-released | "edge — withheld by default: benchmarking is teacher-only and never auto-released" |

### FR-PEER-002 — anonymised peer review  (`m5b-peer-002-review.test.ts`)
| Row | Test |
|---|---|
| Happy — hidden until the teacher approves | "happy path — reviews are hidden until the teacher approves them" |
| Edge — inappropriate comment rejected/hidden, never rewritten | "edge — inappropriate comment: rejected/hidden but never rewritten…" |
| Edge — anonymity breach risk flagged in a small cohort | "edge — anonymity breach risk: flagged in a small cohort, not in a large one" |
| Edge — zero reviews → neutral 'no peer feedback this round' | "edge — zero reviews: a neutral 'no peer feedback this round'…" |

### FR-PEER-003 — peer test builder  (`m5b-peer-003-builder.test.ts`)
| Row | Test |
|---|---|
| Happy — draft peer test created matching the configuration | "happy path — a draft peer test is created matching the configuration" |
| Edge — accommodation vs anonymity tension warned, not silent | "edge — accommodation vs anonymity tension: the teacher is warned…" |
| Edge — insufficient content → told what's missing, not a thin test | "edge — insufficient content for scope: the teacher is told what's missing…" |

### FR-PEER-004 — peer test delivery  (`m5b-peer-004-delivery.test.ts`)
| Row | Test |
|---|---|
| Happy — launched test appears on each student's dashboard/calendar | "happy path — a launched test appears on each selected student's dashboard/calendar" |
| Edge — cohort locks at launch (added-before included, added-after blocked) | "edge — cohort change after scheduling: included only if added before launch…" |
| Edge — cancelled before launch → removed cleanly, no artifacts | "edge — cancelled before launch: removed cleanly with no partial artifacts" |

### FR-PEER-005 — peer test results  (`m5b-peer-005-results.test.ts`)
| Row | Test |
|---|---|
| Happy — full completion + benchmark, explicit publish decision required | "happy path — full completion + benchmark, with an explicit publish decision required" |
| Edge — partial completion rate shown clearly | "edge — partial completion: the completion rate is shown clearly" |
| Edge — edit attempted → separate, logged correction path only | "edge — edit attempted: no direct edit; a genuine correction goes through a separate, logged path" |
| Edge — never published → teacher-only, no auto-release after time passes | "edge — never published: results stay teacher-only with no auto-release…" |

# Milestone 6 traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 6 section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-TAG-001 / FR-TAG-002 — planning  (`m6-tag-001-planning.test.ts`)
| Row | Test |
|---|---|
| Happy — unit sequence grounded in approved curriculum content | "happy path — a unit sequence is drafted, grounded in the school's approved curriculum content" |
| Edge — no grounding content → declines honestly (no invented plan) | "edge — no grounding content: the agent declines honestly instead of inventing an ungrounded plan" |
| Edge — no capability data → general plan, noted as not personalised | "edge — no capability data yet: a general differentiation plan, noted as not yet personalised" |

### FR-TAG-003 — drafts  (`m6-tag-003-drafts.test.ts`)
| Row | Test |
|---|---|
| Happy — parent summary is an editable draft (not sent) | "happy path — a parent progress summary is a draft the teacher can edit before sending" |
| Edge — sensitive content separated from academic + flagged | "edge — sensitive content: behavioural observations are separated from academic content and flagged" |
| Edge — draft never sent → persists, never auto-sent | "edge — draft never sent: it persists and remains accessible later, never auto-sent" |

### FR-TAG-004 — grounding sources  (`m6-tag-004-grounding.test.ts`)
| Row | Test |
|---|---|
| Happy — suggestion shows exactly which approved content grounded it | "happy path — a suggestion shows exactly which approved content it was grounded in" |
| Edge — multiple sources → all listed, not just one | "edge — multiple sources: all of them are listed, not just one" |
| Edge — source later archived → reference retained (flagged archived) | "edge — source later archived: the suggestion retains a reference (now flagged archived), not a broken link" |

# Milestone 7 traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 7 section maps to automated tests,
run against both the in-memory and the Postgres backend. Ask for Help also carries
a safety-filter test, a safeguarding-gate test, and an adversarial suite.

### FR-STU-001 / FR-STU-003 — student dashboard  (`m7-stu-001-dashboard.test.ts`)
| Row | Test |
|---|---|
| Happy — week's homework + assessment appear; completed distinct | "happy path — this week's homework and assessment appear with due dates; completed is distinct" |
| Edge — no tasks → friendly 'nothing assigned yet' | "edge — no tasks assigned: a friendly 'nothing assigned yet' state, not a broken screen" |
| Edge — overdue marked without shaming; teacher notified | "edge — overdue task: marked overdue without shaming language, and the teacher is notified" |

### FR-STU-004 — student calendar  (`m7-stu-004-calendar.test.ts`)
| Row | Test |
|---|---|
| Happy — assessment + co-curricular both appear, correctly dated | "happy path — an assessment and a co-curricular fixture both appear, correctly dated" |
| Edge — restricted (wrong year group) event invisible | "edge — restricted event for a different year group does not appear at all" |
| Edge — rescheduled event updates + flagged changed | "edge — rescheduled assessment updates the student's calendar and is flagged as changed" |

### FR-STU-002 / FR-SAG-001 / FR-SAG-002 — Ask for Help  (`m7-sag-help.test.ts`)
| Row | Test |
|---|---|
| Happy — scoped hint, never the direct answer | "happy path — a hint scoped to the task's content, never the direct answer" |
| Edge — assessment in progress → disabled at task-state layer | "edge — assessment in progress: disabled at the task-state layer, with a clear explanation" |
| (state) — an assessment-type task never enables it | "edge — an assessment-type task never enables Ask for Help" |
| Edge — off-topic → decline + redirect | "edge — off-topic question: declines and redirects to the current task" |
| Edge — direct-answer extraction → declines, offers hint | "edge — direct-answer extraction: still declines, offers a hint instead" |
| Edge — transcript visible to assigning teacher, never Principal | "transcripts — visible to the assigning teacher, never to a Principal, and not to other teachers" |
| Safety — unsafe/diagnostic blocked + logged | "safety — unsafe / diagnostic requests are blocked with a clear message and logged" |
| Safeguarding — disclosure escalates to contact + logged | "safeguarding — a disclosure escalates to the configured contact and is logged (FR-SAF-002)" |
| Gate — no safeguarding config → Ask for Help disabled | "gate — Ask for Help will not enable for a school with no safeguarding config" |

### Adversarial verification  (`m7-sag-adversarial.test.ts`)
| Property | Test |
|---|---|
| >100 extraction attempts, ≥95% refused, 0% leak | "direct-answer extraction: >100 varied attempts, ≥95% refused, 0% leak the answer" |
| Off-topic redirection across varied unrelated questions | "off-topic redirection: varied unrelated questions are redirected, not answered" |

# Milestone 8 traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 8 section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-PAR-001 / FR-PAR-005 — parent dashboard  (`m8-par-001-dashboard.test.ts`)
| Row | Test |
|---|---|
| Happy — plain-language strengths / focus / recent activity | "happy path — a plain-language summary of strengths, focus areas and recent activity" |
| Edge — no recent activity stated plainly (no stale data) | "edge — no recent activity: states this plainly rather than showing stale data" |
| Edge — technical jargon translated to plain language | "edge — technical jargon is translated to plain language, not raw internal labels" |

### FR-PAR-003 — access control & non-diagnostic language  (`m8-par-003-access.test.ts`)
| Row | Test |
|---|---|
| Happy — one verified child; another student denied | "happy path — a parent verified for one child sees only that child; another student is denied" |
| Edge — two children kept separate, never merged | "edge — two verified children are kept clearly separate, never merged" |
| Edge — learning-difficulty pattern described non-diagnostically | "edge — a learning-difficulty pattern is described observationally, never with diagnostic language" |
| Edge — unverified relationship shows no data | "edge — an unverified relationship shows no student data until verification completes" |

### FR-PAR-006 — parent calendar  (`m8-par-006-calendar.test.ts`)
| Row | Test |
|---|---|
| Happy — parent-teacher meeting + assessment both appear | "happy path — a parent-teacher meeting and an upcoming assessment both appear" |
| Edge — children in different year groups get separate calendars | "edge — two children in different year groups get separate, correctly-scoped calendars" |

### FR-PAR-004 — notification cadence  (`m8-par-004-cadence.test.ts`)
| Row | Test |
|---|---|
| Happy — one consolidated weekly notification, not one per item | "happy path — a week with new activity yields ONE consolidated notification, not one per item" |
| Edge — nothing to report → no notification | "edge — a week with nothing to report sends no notification" |
| Resolved (v1.3) — safeguarding escalates immediately, off-cadence | "resolved (v1.3) — safeguarding escalates immediately, independent of the digest cadence" |

# Milestone 9 traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 9 section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-PDB-001 — teacher metrics  (`m9-pdb-001-teachers.test.ts`)
| Row | Test |
|---|---|
| Happy — per-teacher + school-wide metrics | "happy path — per-teacher and school-wide coverage/approval metrics are shown" |
| Edge — low-activity outlier flagged distinctly | "edge — a low-activity established teacher is flagged distinctly, not blended into the average" |
| Edge — new teacher shown in a shorter window | "edge — a new teacher is shown in a shorter window, not unfairly flagged as low-engagement" |

### FR-PDB-002 — school-wide mastery  (`m9-pdb-002-mastery.test.ts`)
| Row | Test |
|---|---|
| Happy — school-wide patterns visible | "happy path — school-wide mastery patterns are visible, not just class-by-class" |
| Edge — outlier class highlighted | "edge — an outlier class is highlighted rather than hidden inside a smoothed average" |

### FR-PDB-003 — drill-down  (`m9-pdb-003-drill.test.ts`)
| Row | Test |
|---|---|
| Happy — drill school -> class -> student | "happy path — drill from school to a class to an individual student" |
| Edge — cross-campus comparison not offered | "edge — cross-campus comparison is out of MVP scope and not offered" |
| Edge — Ask-for-Help excluded at deepest drill | "edge — Ask-for-Help transcripts remain excluded at the deepest drill level" |

### FR-PDB-004 — alerts  (`m9-pdb-004-alerts.test.ts`)
| Row | Test |
|---|---|
| Happy — sharp weekly drop raises an alert | "happy path — a sharp weekly mastery drop raises an alert" |
| Edge — expected seasonal dip not flagged | "edge — an expected seasonal dip during a break window is not flagged" |
| Edge — minor fluctuations don't alert (no fatigue) | "edge — minor fluctuations below the threshold do not raise alerts (no fatigue)" |

### FR-PDB-005 — tutor transcripts never reach a Principal  (`m9-pdb-005-privacy.test.ts`)
| Row | Test |
|---|---|
| Happy + export bypass — back-door hunt across all surfaces | "back-door hunt — SECRET never appears in any Principal surface, including exports" |
| Dual-role — transcript only via Teacher capacity | "dual-role Principal-Teacher — sees own-class transcripts via Teacher capacity, never via a Principal surface" |

### FR-PDB-006 — policy-gated comparison  (`m9-pdb-006-policy.test.ts`)
| Row | Test |
|---|---|
| Happy — disabled comparison view does not appear | "happy path — with teacher-to-teacher comparison disabled, that view does not appear at all" |
| Edge — enabling mid-term makes it available going forward | "edge — enabling the comparison mid-term makes it available going forward" |

# Milestone 10 traceability — every Given/When/Then → test

Each acceptance row from the plan's Milestone 10 section maps to exactly one
automated test. All run against both the in-memory and the Postgres backend.

### FR-REP-001 — teacher growth report  (`m10-rep-001-teacher.test.ts`)
| Row | Test |
|---|---|
| Happy — full-term report reflects mastery changes | "happy path — a full-term growth report reflects that term's mastery changes" |
| Edge — partial-term data stated as limited/early | "edge — partial-term data is clearly stated as limited/early" |

### FR-REP-002 — school report + prorated cost  (`m10-rep-002-principal.test.ts`)
| Row | Test |
|---|---|
| Happy — aggregates all classes in this single school | "happy path — a whole-school report aggregates all classes within this single school" |
| Edge — mid-month licence prorated, not flat | "edge — a licence added mid-month is prorated, not charged a flat full-month cost" |

### FR-REP-004 — parent report  (`m10-rep-004-parent.test.ts`)
| Row | Test |
|---|---|
| Happy — strengths / focus / teacher comments in plain language | "happy path — strengths, focus areas and teacher comments in plain language" |
| Edge — no teacher comments → section omitted gracefully | "edge — no teacher comments: that section is omitted gracefully (empty, not broken)" |

### FR-CAP-002 — co-curricular capability  (`m10-cap-002-cocurricular.test.ts`)
| Row | Test |
|---|---|
| Happy — recorded skill in capability data, separate from academic | "happy path — a recorded instrument skill appears in capability data, separate from academic mastery" |
| Edge — no co-curricular data → section omitted | "edge — no co-curricular data: the report section is omitted, not a misleading 'no progress'" |
| Edge — no curriculum mapping → free-text, not skill-graph shape | "edge — no formal curriculum mapping: uses a free-text skill, not the academic skill-graph shape" |

### FR-BSS-001/002 — behavioural observations  (`m10-bss-observations.test.ts`)
| Row | Test |
|---|---|
| Happy — teacher-authored, stored separately from academic mastery | "happy path — a teacher-authored observation is stored separately from academic mastery" |
| Edge — AI inference blocked; only four categories accepted | "edge — AI inference is blocked by design; only the four categories are accepted" |
| Edge — per-persona visibility (Teacher notes / Principal aggregate / Parent hidden) | "edge — visibility differs per persona (author Teacher notes; Principal aggregate; Parent hidden)" |
| Edge — collection disabled without configured consent | "edge — collection does not go live for a school without its consent mechanism configured" |

# Milestone 11 traceability — governance verification + red-team

M11 is a hardening/verification pass (no new features). Tests run against both the
in-memory and the Postgres backend.

### Red-team (the two failure modes)  (`m11-redteam.test.ts`)
| Failure mode | Test |
|---|---|
| AI content -> student without teacher action (all paths) | "no unreviewed AI artifact is student-reachable: assessment, agent draft, focus material, inference" |
| Revoked approval stops delivery | "revoked approval stops delivery: unpublish makes an assessment student-inaccessible again" |
| Principal surfaces expose transcripts (back-door hunt) | "back-door hunt across every Principal surface and export" |

### FR-GOV-001..007 + cost  (`m11-gov.test.ts`)
| Requirement | Test |
|---|---|
| FR-GOV-002 — logging failure blocks the action | "an audit-logging failure BLOCKS the AI action (never silently unlogged)" |
| FR-GOV-002 — AI call logged with provenance + timestamp | "a generation logs an ai.call with provenance + timestamp" |
| FR-GOV-002/003 — retention logs its own deletions | "retention deletes aged data and logs its OWN deletion" |
| FR-GOV-006 — erasure preserves the hash chain | "erasure removes PII, keeps audited facts, and PRESERVES the hash chain" |
| FR-GOV-006 — active records require confirm | "active records require an explicit confirm (PII-only erasure is the default)" |
| FR-GOV-006 — export is complete + human-readable | "export produces a complete, human-readable record of the student's data" |
| FR-GOV-004/007 — guard blocks training-enabled/offshore | "the AI guard blocks training-enabled and offshore endpoints" |
| FR-GOV-007 — provider drift fails safe (pause) | "provider drift fails safe: the choke point pauses and blocks calls" |
| NFR-COST-001 — fair-use cap declines, not unbounded | "a fair-use cap declines further AI calls rather than billing unbounded" |
| FR-GOV-005 — review metadata + bulk-approval prompt | "publish records review metadata and a fast bulk approval is flagged (non-blocking)" |

### NFRs + FR-SAF-002  (`m11-nfr.test.ts`)
| Requirement | Test |
|---|---|
| NFR-SEC-001 — Principal/Teacher permissions distinct | "Principal and Teacher permissions are provably distinct" |
| NFR-SEC-002 — no transcript in any Principal view | "no Ask-for-Help transcript content appears in any Principal view" |
| NFR-AUD-001 — provenance survives archival | "provenance survives archival: a grounding reference is retained, not broken" |
| NFR-PRV-002 — content not cross-school | "one school's content is never visible in another school's approved pool" |
| NFR-SAF-001 — safety trip is clear + logged | "a safety-filter trip returns a clear message, not a silent failure, and is logged" |
| FR-SAF-002 — safeguarding event restricted visibility | "a safeguarding event is restricted: never on a Teacher dashboard or Principal surface" |

**Documented (not unit-tested):** NFR-A11Y-001 (WCAG 2.2 AA) — a build-time UI
conformance requirement; production persona screens are deferred (ADR-0012), and the
fixed governance/brand tokens carry the contrast obligation. NFR-PERF-001 full
latency/load targets are runtime SLOs; the testable invariant (ingestion always
terminal) is covered by the M1 NFR-PERF-001 test.

## Appendix Milestone A — FR-ADM-003 CSV import (+ SSO domain mismatch)
`services/api/test/appendix-adm-003-csv.test.ts`

| Row | Test |
|---|---|
| Happy path — correct CSV of 200 students → 200 accounts, right role + class | "happy path: a correct CSV of 200 students creates 200 accounts with the right role + class" |
| Malformed rows — 5 rows missing required fields rejected per-row, valid rows import | "malformed rows: 5 rows missing required fields are each rejected with a specific error, valid rows still import" |
| Duplicate emails — flagged + skipped, no conflicting account | "duplicate emails (existing + in-file): flagged as duplicate and skipped, never creating a conflicting account" |
| Formula injection (NEW v1.4) — inert text, row flagged, never evaluated on export | "spreadsheet formula injection (NEW v1.4): the cell is sanitised to inert text, the row imports flagged for review, and no export ever emits an evaluable cell" |
| SSO domain mismatch — access denied with a clear message | "SSO domain mismatch: a sign-in from outside the configured domain is denied with a clear message" |

## Appendix Milestone A — FR-INT-001 SSO sign-in
`services/api/test/appendix-int-001-sso.test.ts`

| Row | Test |
|---|---|
| Happy path — Teacher signs in with Google, authenticated, no password created | "happy path: a Teacher signs in with Google and is authenticated with no password created" |
| Edge — IdP outage → clear service-unavailable, not a generic login failure | "IdP outage: a clear service-unavailable error is surfaced, not a generic login failure" |
| Edge — access revoked upstream → denied AND no stale cached session honoured | "access revoked upstream: sign-in is denied AND any stale cached session stops working" |

## Appendix Milestone B — FR-WL-001 configure brand colour + logo
`services/api/test/m-b-wl-001-config.test.ts`

| Row | Test |
|---|---|
| Happy path — contrast-passing colour + logo saved and applied immediately | "happy path: a contrast-passing colour and a logo are saved and applied immediately" |
| Edge — colour fails contrast → warn + auto-adjusted alternative | "colour fails contrast: warns and offers an auto-adjusted alternative rather than silently accepting" |
| Edge — no branding configured → default Pathfinder branding | "no branding configured: default Pathfinder branding is shown, not a broken/empty state" |
| Edge (NEW v1.4) — active content in logo file → sanitised/rejected | "active content in a logo file (NEW v1.4): an SVG with scripts/handlers is rejected; only safe content is stored" |
| (Supporting) malware-flagged raster logo rejected | "a malware-flagged raster logo is rejected by the security scan" |

## Appendix Milestone B — FR-WL-002 full white-label mode
`services/api/test/m-b-wl-002-whitelabel.test.ts`

| Row | Test |
|---|---|
| Happy path — school name throughout, no attribution on user surfaces | "happy path: with full white-label on, the school's name appears and no Pathfinder attribution shows on user surfaces" |
| Edge — internal support tooling keeps real Pathfinder identity | "internal support tooling still shows the real Pathfinder identity (override is presentation-layer only)" |
| Edge — reverting to co-branded, no retroactive change to issued reports | "reverting to co-branded: attribution + Pathfinder name reappear going forward, with no retroactive change to reports already issued" |

## Appendix Milestone B — FR-WL-003 consistent branding across app/reports/emails
`services/api/test/m-b-wl-003-consistency.test.ts`

| Row | Test |
|---|---|
| Happy path — same logo + colour in app, report and email | "happy path: the same brand colour + logo appear in-app, in an exported report, and in a notification email" |
| Edge — branding changed after report generated → not retroactively rebranded | "branding changed after a report was generated: reopening it is not retroactively rebranded" |
| Edge — logo fails to load → text fallback (school name) | "logo fails to load: a text fallback (school name) is shown rather than a broken image" |

## Appendix Milestone B — FR-WL-004 governance visual states remain fixed
`services/api/test/m-b-wl-004-governance-fixed.test.ts`

| Row | Test |
|---|---|
| Happy path — governance chips use fixed platform tokens, never the brand colour | "happy path: with a brand colour applied, governance chips still render with fixed platform tokens, never the brand colour" |
| Edge — school requests governance-status override → declined by design | "a school's request to recolour a governance status is declined by design" |
| Edge — accessibility floor (WCAG AA) enforced server-side | "accessibility floor: even a stored non-AA colour is clamped server-side, and governance stays fixed" |
| (Supporting) branding is isolated per school (multi-tenant) | "branding is stored per school (multi-tenant isolation)" |
