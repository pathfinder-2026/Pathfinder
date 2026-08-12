# Pathfinder — Production UI Build Plan v1.0

Companion to the **MVP Build Plan v1.4** (the backend/functional source of truth).
That plan defines *what the system does*; this document defines *every production
screen that surfaces it*, per persona, with a ready-to-paste build prompt for each.

The backend (Milestones 0–11 + Appendix A/B) is **complete and tested** (271 tests,
same set vs Postgres). The production UI is being built **persona by persona as thin
vertical slices** on top of those already-tested services. Nothing here adds new
product behaviour — it exposes existing, governed functionality.

---

## Build status (live)

**✅ Built & pushed** (`feature/appendix-a-csv-sso`):
- Foundation: S-AUTH-1 (sign in / create), S-AUTH-2 (accept invite), S-ONB-ROLE
  (role onboarding + honest role home), S-SHELL (role-aware routing + admin hub nav;
  teachers now route into a real Teacher home).
- Admin: ADM-1 (onboarding trail), ADM-2 (school structure **+ curriculum skill-graph
  import & human sign-off card**), ADM-3 (people: roles+names), ADM-4 (Principal
  multi-campus assign), ADM-5 (CSV import), ADM-6 (SSO), ADM-7 (branding).
- **Teacher persona: COMPLETE (TCH-1..18).** TCH-1 (Content Studio pipeline with
  fixed governance chips + block reasons), TCH-2 (versions, sharing, orphaned
  questions), TCH-3 full (mapping + per-mapping override with the remap-historical
  prompt + single-confirm bulk override; unsigned graph honestly blocked), TCH-4/5
  (grounded Assessment Builder, shortfall + clean-failed states, review-ack →
  publish, reversible before start), TCH-6 (mastery heatmap), TCH-7/8/9 (Class
  insights: focus areas / editable cohorts / adaptive escalations + next actions),
  TCH-10..12 (peer suite: warnings surfaced, cohort locks at launch, locked-computed
  benchmarks publish-or-withhold, logged corrections, approve/reject-only review
  moderation), TCH-13 (Teacher Agent: grounded-or-declined drafts, never auto-sent,
  sensitive sections separated), TCH-14 (assigning-teacher-only transcripts,
  Principal back-door tested), TCH-15 (growth report with limited/early flag),
  TCH-16 (behavioural: 4 fixed categories, no score, consent-gated + co-curricular
  as its own structure), TCH-17 (parent-comms drafts via the Agent), TCH-18
  (calendar with reschedule-flags-change).
- Server: `services/api/src/http/teacherApi.ts` (teacher-role-guarded, school-scoped
  `/api/v1` surface) + admin skill-graph endpoints + behavioural-consent endpoint;
  invite list returns the single-use `inviteToken` (out-of-band delivery until real
  email exists — a real SES adapter exists behind the notification port, env-gated,
  ADR-0032); branding READ opened to all school members.

- **Student (STU-1..5): BUILT.** `http/studentApi.ts` (student-role-guarded;
  published-only assessments at the permission layer; model answers/rubrics never
  serialised) + `StudentHome.tsx` (calm workspace, no-shame overdue, Ask-for-Help
  panel with domain-decided lockouts/escalation, year-group-invisible calendar,
  attempt with autosave + offline banner + reconnect restore; peer-test deliveries,
  softened non-ranked signal only-when-published, moderated anonymised review).
  Teacher gained POST /tasks + peer grade-entry; admin memberships PATCH passes classId.
- **Parent (PAR-1..5): BUILT.** `http/parentApi.ts` + `ParentHome.tsx` —
  verification-before-data absolute (admin links + verifies on the People screen),
  plain-language non-diagnostic dashboard, per-child calendar, weekly digest
  (none-when-nothing; admin trigger stands in for the scheduler), term report.
- **Principal (PRB-1..5): BUILT.** `http/principalApi.ts` + `PrincipalHome.tsx` —
  teacher metrics (new-teacher window, low-activity flags), mastery with outlier
  highlight, drill with `askForHelpExcluded`, alerts, transcript-free export
  (marker back-door test), comparison policy-gated via `/principal-policy`.

**All five personas (Admin, Teacher, Student, Parent, Principal) are built.**

**⬜ Next (via the prompts below):** ADM-8/9/10/11; S-NOTIF; the a11y pass.
See §12 for order; each screen's **Build prompt** is paste-ready (prepend §13).

---

## 0. How to use this document

- Screens are grouped by persona (§4–§9) and cross-cutting concerns (§10).
- Each screen has a stable **ID**, the **FRs** it satisfies, a **status**, a spec, and a
  **Build prompt** you can paste into a fresh Claude Code session to build that slice.
- §11 lists the **`/api/v1` endpoints** each screen needs (existing service vs. to-add).
- §12 is the recommended **build sequence**.
- Every prompt assumes the **non-negotiable rules in §1** and the **design system in §3**.

**Status legend:** ✅ Built · 🟡 Partial · ⬜ Not started

---

## 1. Principles & non-negotiable constraints

These hold for **every** screen. A prompt that violates one is wrong.

1. **Reuse the tested services.** The UI calls `/api/v1` endpoints that wrap existing
   domain services. Never re-implement business logic in the client. If an endpoint is
   missing, add a thin one in `services/api/src/http/adminApi.ts` (or a new
   `*.Api.ts`), session-guarded, and add an `http-*.test.ts` case.
2. **Governance visual states are fixed (Decision 5 / FR-WL-004).** Draft / approved /
   published / locked-computed chips use the fixed `--gov-*` tokens and **never** the
   brand colour. Branding themes only `--pf-brand*`.
3. **Nothing AI-generated reaches a student without an explicit teacher action**
   (Decision 7). AI drafts render as drafts; student-facing surfaces only ever show
   published/approved artifacts.
4. **Ask-for-Help transcripts are teacher-only.** They must be unreachable from any
   Principal surface (FR-PDB-005). Do not add a route or export that exposes them.
5. **Safeguarding disclosures** are restricted to the nominated contact (FR-SAF-002);
   never render them on Teacher dashboards or Principal surfaces.
6. **WCAG 2.2 AA (NFR-A11Y-001)** is a build requirement: semantic HTML, labelled
   controls, visible focus, AA contrast (the server clamps brand colour; the UI must
   not undo it), keyboard operability, `aria-*` on custom widgets.
7. **AU residency / audit** are backend guarantees; the UI must not create side channels
   (e.g. never put PII in URLs; never call offshore endpoints).
8. **Every new endpoint keeps the suite green** (`npm test`, `npm run typecheck`, and the
   Postgres suite) and adds a test.

---

## 2. Architecture

- **App:** `apps/app` (React 19 + Vite, `:5174`), separate from the throwaway preview
  console `apps/web`. Proxies `/api` → API `:3000`.
- **Routing:** currently state-driven in `App.tsx`. As screens grow, introduce a small
  router (hash-based or `react-router`) with **role-guarded routes**; a dual-role user
  (e.g. Principal+Teacher) gets a **persona switcher** in the top bar.
- **Session:** `src/api.ts` stores `{token, schoolId, campusId}`; Bearer token on every
  call; `authorize` is live server-side so role/permission changes take effect with no
  re-login.
- **Theming / white-label:** `src/brand.ts::applyBrand` sets only `--pf-brand`(+tint)
  from `GET /api/v1/schools/:id/branding`; governance tokens are untouched.
- **Conventions:** every screen implements **loading**, **empty**, and **error** states
  (see §3). Data mutations refresh from the server (no optimistic drift on governed data).
- **API client:** extend `src/api.ts` with typed functions per endpoint; surface
  `ApiError.code` so screens can special-case governance codes (e.g.
  `BRAND_CONTRAST_FAILED`, `LAST_ADMIN`, `AUTO_ASSIGN_BLOCKED`).

---

## 3. Design system (reference)

- **Tokens:** `apps/app/src/theme.css` — themeable `--pf-brand*` vs. fixed `--gov-*`.
- **Components (`src/components.tsx`):** `TopBar`, `TrailMark`, `Card`, `Field`, `Button`
  (`primary`/`ghost`), `Chip` (`draft`/`approved`/`locked`/`pending`), `Banner`
  (`brand`/`warn`/`error`), `Trail` (waypoint stepper). **Add as needed:** `Table`/`DataList`,
  `Modal`, `Tabs`, `Toast`, `Dropzone`, `Heatmap`, `StatTile`, `EmptyState`,
  `SkeletonRow`, `Avatar`, `Toggle`, `SearchInput`, `Pagination`, `ChartFrame`.
- **Motif:** the "waypoint trail" is the brand signature — reuse it for multi-step flows.
- **A11y checklist per component:** label, role, keyboard, focus ring, contrast, reduced
  motion, live-region for async status.

---

## 4. Shared / foundation screens

### [S-AUTH-1] Sign in / Create school — ✅ Built
- **FRs:** FR-INT (password), FR-ONB-002 (create). **File:** `screens/Start.tsx`.
- Sign-in (default) + create-school toggle; admin-only gate with a clear message for
  other roles.

### [S-AUTH-2] Invite acceptance + set password — ⬜
- **FRs:** FR-ADM-002, FR-ONB-001.
- **Purpose:** an invited Teacher/Student/Parent/Principal opens their link, sees who
  invited them + their role/school, sets a password, and lands in role onboarding.
- **Key UI:** token from `?token=…`; read-only "You've been invited to *School* as a
  *Role*"; password + confirm; accept.
- **States:** invalid/expired token; already-accepted; weak password.
- **API:** add `GET /api/v1/invites/:token` (role, school name, invitee name) and
  `POST /api/v1/invites/accept` (→ session). Wraps `AuthService.acceptInvite`.
- **Build prompt:**
  > In `apps/app`, build the invite-acceptance screen reached when the URL has `?token=…`.
  > Add `GET /api/v1/invites/:token` (returns role, school name, first name — no PII beyond
  > the invitee's own) and `POST /api/v1/invites/accept {token,password}` (wraps
  > `auth.acceptInvite`, returns a session) in `adminApi.ts`, with `http-admin-api.test.ts`
  > cases (happy, invalid token, already-accepted, short password). Screen: show
  > "You've been invited to **{school}** as a **{role}**", a password + confirm field
  > (min 8), and Accept. On success store the session and route into role onboarding
  > (S-ONB-ROLE). Reuse tokens/components; handle invalid/expired/accepted states with a
  > `Banner`. Keep the suite green.

### [S-ONB-ROLE] Role-appropriate first-run onboarding — ⬜
- **FRs:** FR-ONB-001 (incl. dual-role union, "waiting on school setup").
- **Purpose:** each role's own short onboarding (not the Admin's 7 steps), driven by
  `OnboardingService.getUserOnboarding` (already returns per-role steps / waiting state).
- **Key UI:** a compact trail of the role's steps; dual-role shows the union with no
  duplicate "profile" step; "waiting on school setup" is a friendly hold screen.
- **API:** add `GET /api/v1/onboarding/me` (wraps `getUserOnboarding`).
- **Build prompt:**
  > Build the role onboarding screen. Add `GET /api/v1/onboarding/me` wrapping
  > `onboarding.getUserOnboarding(userId)`. Render `state==="waiting_on_school_setup"` as
  > a calm hold screen ("Your school is still being set up — check back soon"), and
  > `state==="ready"` as a `Trail` of that role's steps (dual-role = the returned union,
  > de-duplicated). Each step is a lightweight panel (profile, tour). Reuse the design
  > system; add an `http` test for both states and the dual-role union. Suite stays green.

### [S-SHELL] App shell, navigation & persona switch — 🟡 Partial
- **FRs:** FR-ONB-001 (dual role). Currently minimal state routing.
- **Build prompt:**
  > Introduce role-guarded routing in `apps/app` (hash router or `react-router`, keep the
  > bundle lean) with a persistent `TopBar` nav. For a user with multiple roles, add a
  > persona switcher; each persona routes to its own home. Preserve the current
  > sign-in/onboarding/workspace flows. No backend change. Typecheck + build stay green.

### [S-NOTIF] In-app notification centre — ⬜
- **FRs:** notification/event service (M0+), FR-PAR-004, FR-SAF-002 routing.
- **Build prompt:**
  > Add a notification centre (bell in `TopBar` + panel). Add `GET /api/v1/notifications`
  > (wraps the notification service's per-user messages; **never** include safeguarding
  > content for non-authorised roles). Show unread count, list with type-specific icons,
  > mark-as-read. Weekly parent digests appear here for parents. A11y: `aria-live` for new
  > items. Add a test for the endpoint's role filtering. Suite green.

---

## 5. Admin persona

### [ADM-1] Onboarding trail (7 steps) — ✅ Built  (`screens/Onboarding.tsx`) — FR-ONB-002
### [ADM-3] People: assign roles & edit names — ✅ Built  (`screens/People.tsx`) — FR-ADM-002
### [ADM-4] Principal assignment — 🟡 (via role dropdown) — FR-ADM-007
- **Build prompt:**
  > Extend the People screen with a dedicated "Assign as Principal" action that supports
  > **multiple campuses** (FR-ADM-007) via `principals.assignPrincipal(userId, campusIds)`.
  > Add `POST /api/v1/schools/:id/principals {userId, campusIds}` and
  > `POST .../principals/reassign`. Surface "campus setup incomplete" from the scope.
  > Show revoke-on-reassign. Test the multi-campus + reassign paths. Suite green.

### [ADM-2] School & structure management — 🟡 (classes only, in onboarding) — FR-ADM-001
- **Purpose:** post-setup management of campuses, academic years, terms, classes.
- **States:** duplicate-school-name confirm; incomplete term dates block; add-campus
  inherits settings.
- **API:** add `POST /api/v1/schools/:id/campuses`, year/term endpoints (wrap
  `SchoolService.addCampus` etc.); classes endpoints exist.
- **Build prompt:**
  > Build an Admin "School structure" screen: list campuses, academic years, terms and
  > classes; add a campus (inherits global settings, optional own year/terms — FR-ADM-001
  > edge), add/edit terms with the end-after-start validation surfaced inline, add classes
  > with year group. Add the missing `/api/v1` endpoints wrapping `SchoolService`
  > (+ tests). Reuse the trail/cards. Suite green.

### [ADM-5] CSV bulk import — ⬜ — FR-ADM-003
- **Purpose:** upload a CSV of users; see per-row results.
- **Key UI:** dropzone; a **results table**: imported / rejected (per-row error) /
  duplicates (skipped) / **flagged-for-review** (formula-injection sanitised); download
  a safe export.
- **Governance:** show that formula cells were neutralised; never render a raw cell as a
  formula.
- **API:** add `POST /api/v1/schools/:id/import/users` (wraps `CsvImportService.importUsers`)
  and `GET .../export/users`.
- **Build prompt:**
  > Build the Admin CSV import screen. Add `POST /api/v1/schools/:id/import/users` (body:
  > CSV text; wraps `csvImport.importUsers`) and `GET .../export/users` (wraps
  > `exportUsersCsv`). UI: a dropzone/textarea, then a results summary with four sections —
  > **Imported** (n, with role+class), **Rejected** (per-row specific error), **Duplicates**
  > (skipped), **Flagged for review** (formula-injection, sanitised). Make clear the file is
  > processed safely (inert cells). Add http tests. Reuse the design system; AA table
  > semantics. Suite green.

### [ADM-6] SSO configuration — ⬜ — FR-ADM-003 / FR-INT-001
- **Build prompt:**
  > Build the Admin SSO settings screen. Add `GET/POST /api/v1/schools/:id/sso` (wraps
  > `sso.configure` / `sso.getConfig`). UI: provider (Google Workspace / Microsoft Entra)
  > + permitted email domain; show the domain-mismatch and IdP-outage behaviours as
  > explanatory help text (they're enforced at sign-in). Add tests. Suite green.

### [ADM-7] Branding / white-label settings — 🟡 (in onboarding ops) — FR-WL-001..004
- **Purpose:** a standalone settings screen (not just onboarding).
- **Build prompt:**
  > Promote the onboarding branding controls into a standalone Admin "Branding" settings
  > screen using the existing `/api/v1/schools/:id/branding` endpoints and `/logo` (add
  > `POST .../branding/logo` wrapping `branding.uploadLogo`, with SVG-active-content
  > rejection surfaced). Include the brand-colour picker with the AA-suggestion flow, logo
  > upload with a text-fallback preview, white-label toggle + product name, and a live
  > **governance-signals-stay-fixed** legend. Add a logo-upload test. Suite green.

### [ADM-8] Safeguarding configuration — 🟡 (in onboarding ops) — FR-SAF-002
- **Build prompt:**
  > Standalone Admin "Safeguarding" settings screen over the existing
  > `/api/v1/schools/:id/safeguarding` endpoint: contact, role, SLA, after-hours policy;
  > show that Ask-for-Help is disabled until configured. Suite green.

### [ADM-9] School reports & billing — ⬜ — FR-REP-002
- **Build prompt:**
  > Build the Admin school-report screen. Add `GET /api/v1/schools/:id/report` (wraps
  > `reporting.schoolReport`) returning performance, coverage, usage and the **prorated**
  > cost report. UI: stat tiles + a cost table (prorated lines flagged). School-level only
  > (no per-teacher comparison here). Add a test incl. the mid-month proration line. Suite green.

### [ADM-10] Audit / governance log viewer — ⬜ — NFR-AUD-001, FR-GOV
- **Build prompt:**
  > Build a read-only audit viewer for admins. Add `GET /api/v1/schools/:id/audit`
  > (paged, ids-only, never PII or transcript content) wrapping the audit reader. UI: a
  > filterable table (action, actor, subject, time) with a "chain verified" badge. Enforce
  > that no message body/PII is exposed. Add a test asserting no PII leaks. Suite green.

### [ADM-11] Data-subject export / erase — ⬜ — FR-GOV-006
- **Build prompt:**
  > Build the Admin data-subject request screen. Add endpoints wrapping
  > `GovernanceService.exportStudent` / `eraseStudent` (export returns human-readable
  > data; erase requires an explicit confirm and returns the retained-audit summary). UI:
  > lookup a student, **Export** (download) and **Erase** (double-confirm modal explaining
  > PII is removed but audited facts + hash chain are retained). Add tests. Suite green.

---

## 6. Teacher persona

### [TCH-1] Content Studio (library + upload) — ⬜ — FR-CONT-001..004, FR-ING-001..004
- **Key UI:** library grid (file-type icon, **governance status chip**, dup/near-dup flag);
  multi-file dropzone with **client + server** type/size validation; malware-scan reject →
  quarantine message; third-party **copyright attestation** gate; ingestion status
  (processing → chunked / OCR-flag / **failed**, always terminal).
- **Governance:** only the teacher-approved pool flows downstream; pending/unattested/
  quarantined never look approved.
- **API:** add endpoints wrapping `ContentService`/`IngestionService`/`ClassificationService`
  (upload, list, get, ingest status, classify, approve-classification, attest, approve).
- **Build prompt:**
  > Build the Teacher Content Studio in `apps/app`. Add `/api/v1` endpoints wrapping the
  > content pipeline (uploadOne, list library, get item + version + ingestion status,
  > classify + approveClassification, attestRights, approveContent), session-guarded to the
  > teacher's school. UI: a library with file-type icons and **fixed governance status
  > chips** (pending/approved), a multi-file dropzone enforcing the supported types + size
  > limits client-side (mirror the server policy) with a clear rejection message,
  > malware-reject → quarantine banner, a copyright-attestation checkbox gate before
  > approval, and per-item ingestion status that always resolves to a terminal state.
  > Duplicate/near-duplicate items are flagged. Add http tests for the endpoints. Enforce
  > that only fully-approved items show an "Approved" chip. Suite green.

### [TCH-2] Content detail: versioning, classification, sharing — ⬜ — FR-CONT-002/003/004
- **Build prompt:**
  > Build the content-item detail screen: version history (concurrent-edit entries),
  > AI-suggested classification with **review/approve** (draft chip until approved),
  > class/department sharing controls, and outdated-outcome / orphaned-question views. Wrap
  > `KnowledgeService`/`ContentService`. Tests for share scope + classification approve.
  > Governance chips fixed. Suite green.

### [TCH-3] Skill-graph mapping & overrides — ⬜ — FR-SKG-001/002/004
- **Build prompt:**
  > Build the mapping screen: map approved content through subject→…→subskill; show
  > missing-prerequisite flags (not blocked); allow a teacher **per-mapping override** with
  > the remap-historical prompt and single-confirm bulk override (FR-SKG-004). Block mapping
  > against an **unsigned** graph with a clear message (sign-off is a governance gate). Wrap
  > `MappingService`/`SkillGraphService`. Tests. Suite green.

### [TCH-4] Assessment Builder — ⬜ — FR-ASM-001/002/003
- **Key UI:** plain-language request → **draft** assessment grounded only in approved+mapped
  pool; 5 question types with unsuitable-type flag; rubrics/model answers/versions;
  **shortfall** message when content can't support the count; mid-run failure → clear
  failed state, **no partial draft saved**.
- **Build prompt:**
  > Build the Assessment Builder. Add endpoints wrapping `AssessmentService` (generate,
  > get draft, list versions). UI: a prompt box + parameters; render the generated
  > **draft** (draft chip) with questions/rubrics/model answers and a difficulty-balance
  > flag; surface the grounding sources; show the **shortfall** state when fewer questions
  > were generated; show a clean **failed** state (no partial draft) on mid-run failure.
  > Everything stays draft until published (TCH-5). Tests incl. shortfall + failure. Suite green.

### [TCH-5] Assessment review & publish — ⬜ — FR-ASM-004
- **Build prompt:**
  > Build the assessment review/publish flow: a review-acknowledgement gate before
  > **Publish**, publish is **reversible before the scheduled start**, and access to an
  > unpublished assessment is denied at the permission layer (never merely hidden). Show
  > the draft→published governance transition with fixed chips. Wrap `AssessmentService`.
  > Tests for the review-ack + reversible-before-start. Suite green.

### [TCH-6] Teacher Dashboard — mastery heatmap — ⬜ — FR-TDB-001 / FR-CAP-001
- **Build prompt:**
  > Build the Teacher Dashboard heatmap (student × skill) with intervention/extension
  > flags and a **trend** indicator per cell (not just latest), plus a clear
  > "not enough data yet" empty state. Add a `Heatmap` component (AA-safe sequential
  > palette; never encode meaning by colour alone — include icons/labels). Wrap
  > `TeacherDashboardService.heatmap`. Tests. Suite green.

### [TCH-7] Class focus areas — ⬜ — FR-TDB-002
- **Build prompt:**
  > Build the class focus-areas panel: weakest skills with **suggested approved material**
  > to reteach, or a **content-gap** prompt when none is mapped; a dismissed suggestion
  > stays hidden until data worsens; **assigning is always an explicit action**
  > (`AUTO_ASSIGN_BLOCKED` never auto-assigns). Wrap `classFocusAreas`/`dismissFocusArea`/
  > `assignFocusMaterial`. Tests. Suite green.

### [TCH-8] Cohorts / groups — ⬜ — FR-COH-001/002
- **Build prompt:**
  > Build the cohorts screen: suggested groups (support/misconception/extension/review/
  > peer), **editable before assigning**, a student may be in multiple groups, **stale**
  > groups labelled, and work assigned only to the final edited membership. Wrap
  > `CohortService`. Tests. Suite green.

### [TCH-9] Adaptive recommendations — ⬜ — FR-ADP-001/002
- **Build prompt:**
  > Build the adaptive panel: next-best-action recommendations weighing independent vs.
  > assisted signals, with **persistent-misconception escalation to the teacher** (not a
  > remediation loop) and deferred spaced-revision while an assessment is in progress. Wrap
  > `AdaptiveEngine`. Tests. Suite green.

### [TCH-10..12] Peer testing / review / benchmarks — ⬜ — FR-PEER-001..005
- **Build prompt:**
  > Build the peer suite for teachers: (a) **Peer Test Builder** (questions, rubric, cohort,
  > anonymity, accommodations) with the accommodation-vs-anonymity warning and
  > insufficient-content shortfall; (b) **delivery** (launch → each student's dashboard/
  > calendar, cohort locks at launch, clean cancel); (c) **results** with an explicit
  > **publish/withhold** decision and **no direct edit** of computed figures (corrections
  > via the logged `recordCorrection` path); (d) **peer review moderation** (reject/hide,
  > never rewrite; anonymity-risk flag; zero-reviews neutral state). Locked-computed cards
  > use the fixed `--gov-locked` styling. Wrap `PeerTestService`/`PeerReviewService`. Tests.
  > Suite green.

### [TCH-13] Teacher Agent — ⬜ — FR-TAG-001..004
- **Build prompt:**
  > Build the Teacher Agent screen: draft unit sequences / lesson plans / differentiated
  > activities **grounded in approved content** (a no-grounding request is **declined**, not
  > invented; generic-and-labelled when no capability data); every suggestion shows its
  > **grounding sources** (all of them; archived source → reference, not broken link);
  > parent-comms/feedback **drafts** are editable, never auto-sent, and behavioural
  > observations are separated + flagged. All via the AI service layer. Wrap `AgentService`.
  > Tests incl. the decline path. Suite green.

### [TCH-14] Ask-for-Help transcripts (teacher-only) — ⬜ — FR-SAG (FR-PDB-005 boundary)
- **Build prompt:**
  > Build the assigning-teacher view of a student's Ask-for-Help transcript. Add an endpoint
  > that returns a transcript **only to the assigning teacher** (reuse the M9 rule) and
  > **404/deny** for anyone else. Never add this to any Principal route or export. Add a
  > back-door test asserting a Principal cannot reach it. Suite green.

### [TCH-15] Growth reports — ⬜ — FR-REP-001
### [TCH-16] Behavioural/social + co-curricular — ⬜ — FR-BSS-001/002, FR-CAP-002
### [TCH-17] Parent-communication drafts — ⬜ — FR-TAG-003
### [TCH-18] Teacher calendar — ⬜
- **Build prompt (TCH-15/16/17/18):**
  > Build the teacher reporting + records screens: (15) term **growth report** with the
  > partial-term "limited/early" flag (wrap `reporting.teacherGrowth`); (16) **behavioural**
  > observations — the four fixed categories, teacher-authored, **no AI score** (blocked),
  > **consent-gated**, per-persona visibility — plus **co-curricular** free-text
  > skill+level, kept separate from academic mastery (wrap `BehaviouralService`/
  > `CoCurricularService`); (17) parent-comms **drafts** (never auto-sent); (18) a teacher
  > calendar. Add endpoints + tests. Suite green.

---

## 7. Student persona

> **Safety-critical.** Follow §1.3–§1.6 exactly. The tutor never gets the student's raw
> message-to-answer path; the assessment lockout is enforced at the task-state layer.

### [STU-1] Student workspace / dashboard — ⬜ — FR-STU-001/003
- **Build prompt:**
  > Build the student dashboard: today's / this-week's tasks and assessments, a friendly
  > "nothing assigned yet" empty state, and **overdue marked without shaming** (calm tag,
  > no red-alarm), with the assigning teacher notified server-side. Low-analytics, calm
  > layout. Wrap `StudentWorkspaceService`. Tests. AA + reduced-motion. Suite green.

### [STU-2] Task detail + Ask-for-Help tutor — ⬜ — FR-STU-002 / FR-SAG-001/002
- **Build prompt:**
  > Build the task detail + Ask-for-Help panel. The tutor gives **scoped hints grounded in
  > the task's approved content, never the answer**; off-topic / answer-extraction attempts
  > are refused; during an assessment the panel is **locked at the task-state layer** (show
  > the locked state, don't call the tutor); a safeguarding disclosure escalates to the
  > configured contact (never shown in the UI as an alert to the student beyond a supportive
  > message). Wrap `AskForHelpService`. Reuse the look-and-feel's ask panel. Add tests
  > incl. the lockout + refusal. Suite green.

### [STU-3] Student calendar — ⬜ — FR-STU-004
- **Build prompt:**
  > Build the student calendar of permitted events; events restricted to another year group
  > are **invisible**; a rescheduled event updates and is **flagged as changed**. Wrap the
  > workspace calendar. Tests. Suite green.

### [STU-4] Assessment attempt — ⬜ — FR-ASM-004
- **Build prompt:**
  > Build the assessment-taking screen with **connectivity-loss work preservation** to the
  > last save point, and no access to an unpublished assessment. Autosave; offline banner.
  > Wrap `AssessmentService` attempt APIs. Tests. Suite green.

### [STU-5] Peer test taking / peer review — ⬜ — FR-PEER
- **Build prompt:**
  > Build the student peer-test taking flow and anonymised peer-review submission; results
  > show only the **softened, non-ranked** signal when published; small cohorts suppressed.
  > Wrap `PeerTestService`/`PeerReviewService`. Tests. Suite green.

---

## 8. Parent persona

### [PAR-1] Link child + verification — ⬜ — FR-PAR-003
- **Build prompt:**
  > Build the parent link-child + verification flow. **Verification-before-data is
  > absolute**: nothing shows until verified; a parent only ever sees their own child;
  > children are never merged. Wrap `ParentService.linkChild`/`verifyLink`. Tests incl. the
  > cross-student denial. Suite green.

### [PAR-2] Parent dashboard — ⬜ — FR-PAR-001/005
- **Build prompt:**
  > Build the parent dashboard: **plain-language** strengths / focus areas / recent
  > activity; **no recent activity stated plainly**; jargon (node ids/codes) translated to
  > everyday topics; summaries **never diagnostic** (observational wording enforced). Wrap
  > `ParentService`. Tests asserting non-diagnostic wording. Suite green.

### [PAR-3] Child calendar — ⬜ — FR-PAR-006
### [PAR-4] Notifications / weekly digest — ⬜ — FR-PAR-004
### [PAR-5] Term reports — ⬜ — FR-REP-004
- **Build prompt (PAR-3/4/5):**
  > Build the parent calendar (per-child; different year groups → separate calendars), the
  > **single weekly consolidated** digest surface (none when nothing; safeguarding is the
  > only off-cadence path), and the parent **term report** (strengths/focus/comments/
  > co-curricular; empty sections omitted gracefully). Wrap `ParentService`/`ReportingService`.
  > Tests. Suite green.

---

## 9. Principal persona

> **Boundary:** Ask-for-Help transcripts are unreachable here (FR-PDB-005); no cross-campus
> comparison (FR-PDB-003). A dual-role Principal-Teacher sees transcripts only via the
> Teacher persona.

### [PRB-1] School dashboard (teacher metrics) — ⬜ — FR-PDB-001
- **Build prompt:**
  > Build the Principal school dashboard: per-teacher coverage / AI-approval / edit-rate /
  > engagement / workload + school-wide; low-activity teachers **flagged distinctly**; new
  > teachers shown in a **shorter window** (not compared unfairly). Wrap
  > `PrincipalDashboardService.teacherReport`. Tests. Suite green.

### [PRB-2] Mastery & risk — ⬜ — FR-PDB-002
### [PRB-3] Drill school→class→student — ⬜ — FR-PDB-003/005
### [PRB-4] Threshold alerts — ⬜ — FR-PDB-004
### [PRB-5] Comparison views (policy-gated) — ⬜ — FR-PDB-006
- **Build prompt (PRB-2..5):**
  > Build the Principal mastery/risk view (**outlier class highlighted**, not smoothed);
  > the **drill** school→class→student that carries **no Ask-for-Help content** at any level
  > and offers **no cross-campus** comparison; threshold **alerts** (seasonal-break
  > suppression, sub-threshold = no alert); and the **policy-gated** teacher-to-teacher
  > comparison (off by default, applies going forward). Wrap `PrincipalDashboardService`.
  > Add a back-door test asserting no transcript content appears on any Principal surface or
  > export. Suite green.

---

## 10. Cross-cutting

- **White-label admin** (ADM-7) + **live theming** (built) — brand tokens only.
- **Governance signal legend** — reusable component showing fixed chips; embed on
  branding + review screens.
- **Notification centre** (S-NOTIF) — one surface for all personas; safeguarding routing
  restricted.
- **Accessibility pass (NFR-A11Y-001)** — a dedicated slice: automated axe checks in CI,
  keyboard-only walkthrough per screen, contrast audit, reduced-motion, screen-reader
  labels. **Build prompt:**
  > Add an accessibility test setup to `apps/app` (e.g. `vitest` + `@axe-core/react` or
  > Playwright + axe) and a per-screen a11y checklist; fix violations to WCAG 2.2 AA. Add a
  > CI script. Do not weaken the server-side contrast clamp.

---

## 11. `/api/v1` endpoint inventory (existing service → endpoint)

**Built:** auth/login, onboarding start/state/complete/enter-workspace, classes (list/create),
invites (list/create), safeguarding, branding (get/set), summary, accounts (list),
memberships/:id/role, users/:id/name, campuses.

**To add (wrapping already-tested services):** invites/:token + invites/accept; onboarding/me;
notifications; content pipeline (upload/list/get/ingest/classify/attest/approve); mapping;
assessments (generate/versions/publish/attempt); teacher dashboard/focus/cohorts/adaptive;
peer tests/reviews/benchmarks; agent; ask-for-help (teacher-scoped); reporting
(teacher/school/parent); behavioural/co-curricular; parent link/verify/dashboard/calendar/
digest; principal dashboard/mastery/drill/alerts/policy; csv import/export; sso get/set;
branding/logo; audit reader; governance export/erase; principals assign/reassign; school
structure (campuses/years/terms).

Each new endpoint: session-guarded, school-scoped, `http-*.test.ts` coverage, suite green.

---

## 12. Recommended build sequence

Thin vertical slices, each shippable and testable. Suggested order:

1. **Admin management** (ADM-2/4/5/6/7/8) — completes the admin's own workspace. *(ADM-3, 1 built.)*
2. **Invitee onboarding** (S-AUTH-2, S-ONB-ROLE, S-SHELL) — so invited people can get in.
3. **Teacher content → assessment** (TCH-1/2/3/4/5) — the pilot's core loop.
4. **Teacher intelligence** (TCH-6/7/8/9) — dashboards/cohorts/adaptive.
5. **Student** (STU-1/2/3/4) — the safety-critical surfaces.
6. **Parent** (PAR-1/2/3/4/5) and **Principal** (PRB-1..5).
7. **Peer, Agent, Reporting, Behavioural** (TCH-10..17, ADM-9).
8. **Governance/admin ops** (ADM-10/11) + **Notifications** (S-NOTIF).
9. **Accessibility pass** (NFR-A11Y-001) — before any real pilot.

> Milestone 11 governance verification remains the non-negotiable gate before real student
> data flows, regardless of UI progress.

---

## 13. Prompt conventions (paste-ready)

Every build prompt above assumes this preamble; prepend it when starting a fresh session:

> You are extending the Pathfinder **production web app** (`apps/app`, React 19 + Vite)
> and its **`/api/v1`** surface (`services/api/src/http/adminApi.ts`), on top of the
> already-built, tested domain services. Follow the Production UI Build Plan §1
> (non-negotiables: reuse services; governance tokens fixed; nothing AI reaches students
> without teacher action; transcripts teacher-only; safeguarding restricted; WCAG 2.2 AA)
> and §3 (design system). Add session-guarded, school-scoped endpoints wrapping the named
> service, with `http-*.test.ts` coverage. Keep `npm test`, `npm run typecheck`, and the
> Postgres suite green. Then build the screen described, implementing loading/empty/error
> states and reusing the existing tokens/components. Do not build ahead of the named slice.
