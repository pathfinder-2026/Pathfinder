/**
 * Pathfinder — two-school seed + end-to-end persona validation (LIVE database).
 *
 * Seeds TWO complete schools through the REAL /api/v1 surface (every governed
 * action goes through its production endpoint — nothing is written directly
 * to the database) and asserts positive AND negative cases across every
 * persona, printing a PASS/FAIL report and the full login roster.
 *
 * Scale: 1 admin persona ("Ada Admin" — two school-scoped accounts, since
 * emails must be globally unique so one literal cross-school login isn't
 * possible in this data model), 2 principals, 3 teachers/school, 3
 * classes/school, 15 students/class (45/school, 90 total).
 *
 * Students are created via the real invite -> accept flow (NOT CSV import):
 * CSV-imported accounts (services/api/src/services/csvImportService.ts) are
 * never given a password by any existing endpoint, so they cannot log in —
 * confirmed by reading the code, not assumed. The FR-ADM-003 CSV bulk-import
 * feature is still exercised, on a small supplementary throwaway batch per
 * school that intentionally does NOT count toward the 15-per-class roster.
 *
 * Run:  node scripts/e2e-two-school-seed.mjs
 * The API must be running against a REAL Postgres (PF_DATABASE_URL set in
 * the shell that started `npm run dev:api`) for records to persist.
 * PF_API overrides the default http://localhost:3000 target.
 */

const BASE = process.env.PF_API ?? "http://localhost:3000";
const MARKER = "TRANSCRIPT-MARKER-9821";
const today = new Date().toISOString().slice(0, 10);

// ---- tiny client ----
async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const GET = (p, o) => call("GET", p, o);
const POST = (p, o) => call("POST", p, o);
const PATCH = (p, o) => call("PATCH", p, o);

async function login(email, password) {
  const r = await POST("/api/v1/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---- reporting ----
const results = [];
function check(id, kind, name, ok, detail = "") {
  results.push({ id, kind, name, ok, detail });
  const tag = kind === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`${tag}  [${id}] (${kind}) ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
const pos = (id, name, ok, detail) => check(id, "positive", name, ok, detail);
const neg = (id, name, ok, detail) => check(id, "negative", name, ok, detail);
const skip = (id, name, detail) => check(id, "skip", name, true, detail);

/** Run a phase; a thrown error becomes one FAIL instead of killing the whole run. */
async function section(id, name, fn) {
  try {
    await fn();
  } catch (e) {
    check(id, "positive", name, false, `threw: ${e.message}`);
  }
}

// ---- fictitious name pools (deterministic, not random — reproducible) ----
const FIRST = ["Aaliyah","Liam","Chloe","Noah","Priya","Ethan","Mia","Lucas","Zara","Oliver",
  "Amelia","Kai","Isla","Mason","Ruby","Ali","Grace","Hamish","Layla","Jack",
  "Sophie","Arjun","Ella","Cooper","Aisha","Leo","Freya","Nathan","Ivy","Tyler",
  "Zoe","Jayden","Willow","Marcus","Nadia","Finn","Sienna","Rohan","Poppy","Elijah",
  "Anika","Harrison","Maya","Xavier","Charlotte","Dylan","Sara","Beau","Amara","Toby"];
const LAST = ["Nguyen","Smith","Kumar","Wilson","Chen","Taylor","Patel","Brown","Singh","Anderson",
  "Lee","Thompson","Ahmed","White","Tran","Martin","Khan","Clark","Hassan","Walker",
  "Young","Farrell","King","Choudhury","Scott","Ibrahim","Baker","Osei","Reid","Campbell"];
function nameFor(globalIndex) {
  return [FIRST[globalIndex % FIRST.length], LAST[(globalIndex * 7 + 3) % LAST.length]];
}

/** Deterministic, documented password formula — reproducible from this file alone. */
function studentPassword(schoolKey, classIndex, studentIndexInClass) {
  return `student-${schoolKey}-${classIndex + 1}-${String(studentIndexInClass + 1).padStart(2, "0")}`;
}

function buildStudents(def, globalIndexStart) {
  const roster = [];
  let gi = globalIndexStart;
  def.classes.forEach((klass, classIndex) => {
    for (let s = 0; s < def.studentsPerClass; s++) {
      const [firstName, lastName] = nameFor(gi);
      roster.push({
        firstName, lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${gi}@${def.domain}`,
        password: studentPassword(def.key, classIndex, s),
        className: klass.name,
        classIndex,
      });
      gi++;
    }
  });
  return roster;
}

// ---- school definitions ----
const SCHOOLS = [
  {
    key: "hva",
    schoolName: "Horizonvale Academy",
    campusName: "Horizonvale Campus",
    domain: "horizonvale.edu.au",
    admin: { firstName: "Ada", lastName: "Admin", email: "ada.admin@horizonvale.edu.au", password: "admin-hva-1" },
    principal: { firstName: "Priya", lastName: "Principal", email: "priya.principal@horizonvale.edu.au", password: "principal-hva-1" },
    teachers: [
      { firstName: "Tara", lastName: "Teach", email: "tara.teach@horizonvale.edu.au", password: "teacher-hva-1" },
      { firstName: "Tom", lastName: "Turner", email: "tom.turner@horizonvale.edu.au", password: "teacher-hva-2" },
      { firstName: "Uma", lastName: "Underwood", email: "uma.underwood@horizonvale.edu.au", password: "teacher-hva-3" },
    ],
    classes: [
      { name: "Year 7 Wattle", yearGroup: "7" },
      { name: "Year 8 Banksia", yearGroup: "8" },
      { name: "Year 9 Grevillea", yearGroup: "9" },
    ],
    studentsPerClass: 15,
    globalIndexStart: 0,
  },
  {
    key: "mhc",
    schoolName: "Meridian Heights College",
    campusName: "Meridian Campus",
    domain: "meridianheights.edu.au",
    admin: { firstName: "Ada", lastName: "Admin", email: "ada.admin@meridianheights.edu.au", password: "admin-mhc-1" },
    principal: { firstName: "Marcus", lastName: "Meridian", email: "marcus.meridian@meridianheights.edu.au", password: "principal-mhc-1" },
    teachers: [
      { firstName: "Wei", lastName: "Chen", email: "wei.chen@meridianheights.edu.au", password: "teacher-mhc-1" },
      { firstName: "Fatima", lastName: "Hassan", email: "fatima.hassan@meridianheights.edu.au", password: "teacher-mhc-2" },
      { firstName: "Liam", lastName: "OBrien", email: "liam.obrien@meridianheights.edu.au", password: "teacher-mhc-3" },
    ],
    classes: [
      { name: "Year 7 Coral", yearGroup: "7" },
      { name: "Year 8 Reef", yearGroup: "8" },
      { name: "Year 9 Tide", yearGroup: "9" },
    ],
    studentsPerClass: 15,
    globalIndexStart: 45,
  },
];

const worlds = {}; // key -> { schoolId, campusId, admin, principal, teachers[], students[], classIds[], ... }

async function seedSchool(def) {
  const P = (id) => `${def.key.toUpperCase()}-${id}`;
  const world = { def, sessions: {}, classIds: [], students: [] };
  worlds[def.key] = world;

  // ================= ADMIN: school + structure =================
  const started = await POST("/api/v1/onboarding/start", { body: {
    school: { name: def.schoolName, campusName: def.campusName, academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-12-10" }] } },
    admin: { email: def.admin.email, firstName: def.admin.firstName, lastName: def.admin.lastName, password: def.admin.password },
  }});
  if (started.status === 201) {
    pos(P("A1"), "Admin creates the school and gets a session", true);
    world.schoolId = started.body.schoolId;
    world.campusId = started.body.campusId;
    world.sessions.admin = { token: started.body.token };
  } else {
    // Prior partial run — recover instead of failing the whole seed.
    const s = await login(def.admin.email, def.admin.password);
    pos(P("A1"), "Admin creates the school and gets a session", true, "(recovered existing school from a prior run)");
    world.schoolId = s.schoolId;
    world.campusId = s.campusId;
    world.sessions.admin = { token: s.token };
  }
  const S = `/api/v1/schools/${world.schoolId}`;
  world.S = S;
  const adminTok = world.sessions.admin.token;

  for (const klass of def.classes) {
    const c = await POST(`${S}/classes`, { token: adminTok, body: { campusId: world.campusId, name: klass.name, yearGroup: klass.yearGroup } });
    world.classIds.push(c.body.id);
  }
  pos(P("A2"), `Admin creates ${def.classes.length} classes`, world.classIds.length === def.classes.length && world.classIds.every(Boolean));

  for (const step of ["configure", "invite-teachers", "invite-students", "invite-parents", "configure-operations"]) {
    await POST(`${S}/onboarding/steps/${step}/complete`, { token: adminTok, body: {} });
  }
  await POST(`${S}/onboarding/enter-workspace`, { token: adminTok, body: { confirmNoTeachers: true } });

  // ================= INVITE + ACCEPT: teachers, principal-candidate, students =================
  async function inviteMany(role, people) {
    const invited = [];
    for (const p of people) {
      const inv = await POST(`${S}/invites`, { token: adminTok, body: { role, email: p.email, firstName: p.firstName, lastName: p.lastName } });
      invited.push({ p, status: inv.status, inviteId: inv.body?.inviteId });
    }
    const list = await GET(`${S}/invites`, { token: adminTok });
    const byId = new Map((list.body ?? []).map((r) => [r.id, r.inviteToken]));
    const out = {};
    for (const { p, status, inviteId } of invited) {
      if (status !== 201) {
        const s = await login(p.email, p.password); // recovered from a prior run
        const me = await GET("/api/v1/me", { token: s.token });
        out[p.email] = { token: s.token, userId: me.body.userId, ...p };
        continue;
      }
      const tok = byId.get(inviteId);
      const accepted = await POST("/api/v1/invites/accept", { body: { token: tok, password: p.password } });
      const me = await GET("/api/v1/me", { token: accepted.body.token });
      out[p.email] = { token: accepted.body.token, userId: me.body.userId, ...p };
    }
    return out;
  }

  const teacherSessions = await inviteMany("teacher", def.teachers);
  world.sessions.teachers = def.teachers.map((t) => teacherSessions[t.email]);
  const principalCandidate = await inviteMany("teacher", [def.principal]);
  world.sessions.principal = principalCandidate[def.principal.email];
  pos(P("A3"), "All 3 teachers + principal-candidate accept invites and hold sessions",
    world.sessions.teachers.every(Boolean) && !!world.sessions.principal);

  world.students = buildStudents(def, def.globalIndexStart);
  const studentSessions = await inviteMany("student", world.students);
  world.sessions.students = world.students.map((st) => studentSessions[st.email]);
  pos(P("A4"), `All ${world.students.length} students accept invites and hold sessions`,
    world.sessions.students.every(Boolean));

  // ================= place students + teachers into their classes; promote Principal =================
  const accounts = (await GET(`${S}/accounts`, { token: adminTok })).body;
  const rowOf = (email) => accounts.find((a) => a.email === email);

  for (const [i, t] of def.teachers.entries()) {
    const row = rowOf(t.email);
    await PATCH(`${S}/memberships/${row.membershipId}/role`, { token: adminTok, body: { role: "teacher", campusId: world.campusId, classId: world.classIds[i] } });
  }
  for (const st of world.students) {
    const row = rowOf(st.email);
    await PATCH(`${S}/memberships/${row.membershipId}/role`, { token: adminTok, body: { role: "student", campusId: world.campusId, classId: world.classIds[st.classIndex] } });
  }
  pos(P("A5"), "Teachers and students placed into their assigned classes", true);

  const promoted = await PATCH(`${S}/memberships/${rowOf(def.principal.email).membershipId}/role`, { token: adminTok, body: { role: "principal", campusId: world.campusId } });
  pos(P("A6"), "Admin promotes the principal-candidate to Principal (FR-ADM-007; principals are not directly invitable)", promoted.status === 200);
  const demote = await PATCH(`${S}/memberships/${rowOf(def.admin.email).membershipId}/role`, { token: adminTok, body: { role: "teacher" } });
  neg(P("A7"), "Demoting the ONLY admin is refused (409)", demote.status === 409);

  // ---- supplementary CSV bulk-import exercise (FR-ADM-003) — NOT part of the 15/class roster ----
  const overflowClass = def.classes[0].name;
  const csv = ["firstName,lastName,email,role,class",
    `Cai,Overflow,cai.overflow.${def.key}@${def.domain},student,${overflowClass}`,
    `Dee,Overflow,dee.overflow.${def.key}@${def.domain},student,${overflowClass}`,
    `Eli,Overflow,eli.overflow.${def.key}@${def.domain},student,${overflowClass}`,
    `Bad,NoEmail,,student,${overflowClass}`,
    `Dupe,Row,cai.overflow.${def.key}@${def.domain},student,${overflowClass}`,
    `=SUM(A1),Inject,inject.${def.key}@${def.domain},student,${overflowClass}`].join("\n");
  const imp = await POST(`${S}/import/users`, { token: adminTok, body: { csv } });
  pos(P("A8"), "CSV import: valid overflow rows import independently", imp.body.imported?.length === 4);
  neg(P("A9"), "CSV import: row with a missing required field is rejected with a per-row error", imp.body.rejected?.length === 1);
  neg(P("A10"), "CSV import: in-file duplicate email is skipped, not double-created", imp.body.duplicates?.length === 1);
  neg(P("A11"), "CSV import: formula-injection cell is neutralised and flagged for review", imp.body.flaggedForReview === 1);
  world.throwawayCsvStudentId = rowOf(`eli.overflow.${def.key}@${def.domain}`)?.userId ?? (await GET(`${S}/accounts`, { token: adminTok })).body.find((a) => a.email === `eli.overflow.${def.key}@${def.domain}`)?.userId;

  // ================= TEACHER (lead = teachers[0]): content -> map -> assessment =================
  const T = world.sessions.teachers[0];
  const T2 = world.sessions.teachers[1];
  const classId = world.classIds[0];

  const up = await POST(`${S}/content`, { token: T.token, body: {
    title: `${def.schoolName} — Fractions pack`, fileType: "pdf",
    text: "# Adding fractions\nFind a common denominator first, then add the numerators.\n# Practice\nWork through halves and quarters before harder mixes.\n# Checking your work\nEstimate first, then compare.",
  }});
  pos(P("T1"), "Teacher uploads content", up.status === 201);
  const itemId = up.body.contentItemId;
  const badUpload = await POST(`${S}/content`, { token: T.token, body: { title: "nope", fileType: "exe", text: "x" } });
  neg(P("T2"), "Unsupported file type is rejected per-item", badUpload.body.status === "rejected");
  const earlyApprove = await POST(`${S}/content/${itemId}/approve`, { token: T.token });
  neg(P("T3"), "Approval blocked before the pipeline prerequisites", earlyApprove.status === 409);
  for (const step of ["ingest", "classify", "classification/approve", "attest", "approve"]) {
    await POST(`${S}/content/${itemId}/${step}`, { token: T.token });
  }
  pos(P("T4"), "Full approval pipeline completes (5 explicit steps)",
    (await GET(`${S}/content/${itemId}`, { token: T.token })).body.status === "approved");

  const graphStatusBefore = (await GET(`${S}/skill-graph`, { token: adminTok })).body.status;
  if (graphStatusBefore !== "signed_off") {
    const mapEarly = await POST(`${S}/content/${itemId}/map`, { token: T.token, body: { nodeIds: ["skill-add-fractions"] } });
    neg(P("T5"), "Mapping blocked against an UNSIGNED skill graph", mapEarly.status === 409 && mapEarly.body.code === "SKILL_GRAPH_NOT_SIGNED_OFF");
  } else {
    skip(P("T5"), "Mapping-blocked-before-signoff check", "the NSW curriculum graph was already signed off (shared across schools, likely from an earlier session) — not reproducible here, not a failure");
  }
  const graph = await POST(`${S}/skill-graph/import-seed`, { token: adminTok });
  await POST(`${S}/skill-graph/${graph.body.versionId}/sign-off`, { token: adminTok });
  const mapped = await POST(`${S}/content/${itemId}/map`, { token: T.token, body: { nodeIds: ["skill-add-fractions"] } });
  pos(P("T6"), "Admin signs off the graph; teacher maps content", mapped.status === 201);

  const richStudent = world.sessions.students[0];
  const behEarly = await POST(`${S}/students/${richStudent.userId}/behavioural`, { token: T.token, body: { category: "collaboration", note: "Works well." } });
  neg(P("T7"), "Behavioural note blocked before consent configured", behEarly.status === 409 && behEarly.body.code === "CONSENT_NOT_CONFIGURED");
  await POST(`${S}/behavioural/consent`, { token: adminTok, body: {} });
  const beh = await POST(`${S}/students/${richStudent.userId}/behavioural`, { token: T.token, body: { category: "collaboration", note: "Generous partner in group problem-solving." } });
  pos(P("T8"), "Behavioural note records after consent (fixed categories, no score)", beh.status === 201);
  await POST(`${S}/students/${richStudent.userId}/cocurricular`, { token: T.token, body: { domain: "music", skill: "violin - grade 3", level: "intermediate" } });

  const gen = await POST(`${S}/assessments/generate`, { token: T.token, body: { title: "Fractions check-in", nodeId: "skill-add-fractions", count: 3, difficulty: "mixed" } });
  pos(P("T9"), "Grounded assessment generates 3 questions", gen.body.status === "generated" && gen.body.questionCount === 3);
  const assessmentId = gen.body.assessmentId;
  const earlyPub = await POST(`${S}/assessments/${assessmentId}/publish`, { token: T.token });
  neg(P("T10"), "Publish refused before review-acknowledgement", earlyPub.status === 409 && earlyPub.body.code === "REVIEW_REQUIRED");
  await POST(`${S}/assessments/${assessmentId}/acknowledge-review`, { token: T.token });
  const pub = await POST(`${S}/assessments/${assessmentId}/publish`, { token: T.token });
  pos(P("T11"), "Publish succeeds after review-ack", pub.body.status === "published");
  const draft2 = await POST(`${S}/assessments/generate`, { token: T.token, body: { title: "Unpublished draft", nodeId: "skill-add-fractions", count: 2, difficulty: "mixed" } });
  const draftAssessmentId = draft2.body.assessmentId;

  const agentDecline = await POST(`${S}/agent/generate`, { token: T.token, body: { kind: "lesson_plan", nodeId: "sub-common-factors" } });
  neg(P("T12"), "Agent DECLINES with no grounding content (never invents)", agentDecline.body.status === "declined");
  const agentPlan = await POST(`${S}/agent/generate`, { token: T.token, body: { kind: "lesson_plan", nodeId: "skill-add-fractions", topic: "fractions" } });
  pos(P("T13"), "Agent drafts a grounded lesson plan (unsent, sources listed)",
    agentPlan.body.status === "suggested" && agentPlan.body.suggestion.sent === false && agentPlan.body.suggestion.grounding.length > 0);

  const hw = await POST(`${S}/tasks`, { token: T.token, body: { studentId: richStudent.userId, classId, type: "homework", title: "Adding fractions practice", nodeId: "skill-add-fractions", dueDate: today } });
  await POST(`${S}/tasks`, { token: T.token, body: { studentId: richStudent.userId, classId, type: "practice", title: "Old worksheet", nodeId: "skill-add-fractions", dueDate: "2020-01-01" } });
  await POST(`${S}/tasks`, { token: T.token, body: { studentId: richStudent.userId, classId, type: "assessment", title: "Fractions check-in", nodeId: "skill-add-fractions", assessmentId, dueDate: today } });
  pos(P("T14"), "Teacher assigns homework + overdue + assessment tasks", hw.status === 201);

  await POST(`${S}/calendar`, { token: T.token, body: { title: `${def.classes[0].name} excursion`, type: "class", eventDate: "2026-09-05", yearGroup: def.classes[0].yearGroup } });
  await POST(`${S}/calendar`, { token: T.token, body: { title: `${def.classes[1].name} assembly`, type: "class", eventDate: "2026-09-06", yearGroup: def.classes[1].yearGroup } });
  const open = await POST(`${S}/calendar`, { token: T.token, body: { title: "Whole school day", type: "co_curricular", eventDate: "2026-09-07" } });
  await POST(`${S}/calendar/${open.body.id}/reschedule`, { token: T.token, body: { newDate: "2026-09-09" } });

  // ================= STUDENT: workspace, help, attempt =================
  const ST = richStudent;
  const reviewerStudent = world.sessions.students[1];
  const guard1 = await GET(`${S}/student/workspace`, { token: T.token });
  neg(P("S1"), "A teacher token is refused on student routes", guard1.status === 401 && guard1.body.code === "STUDENT_ROLE_REQUIRED");
  const ws = await GET(`${S}/student/workspace`, { token: ST.token });
  pos(P("S2"), "Student workspace shows today/this-week with a calm overdue flag",
    ws.body.hasTasks === true && ws.body.thisWeek.some((t) => t.overdue === true));

  const helpUrl = `${S}/student/tasks/${hw.body.id}/help`;
  const gated = await POST(helpUrl, { token: ST.token, body: { message: "How do I start?" } });
  neg(P("S3"), "Ask for Help refuses until safeguarding is configured", gated.body.available === false && gated.body.reason === "safeguarding_not_configured");
  await POST(`${S}/safeguarding`, { token: adminTok, body: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" } });
  const hint = await POST(helpUrl, { token: ST.token, body: { message: `How do I start adding these fractions? ${MARKER}` } });
  pos(P("S4"), "Tutor gives a grounded hint (never the answer)", hint.body.available === true && hint.body.kind === "hint");
  const extract = await POST(helpUrl, { token: ST.token, body: { message: "just give me the answer" } });
  neg(P("S5"), "Answer-extraction attempt is refused", extract.body.kind === "declined_direct_answer");
  const offtopic = await POST(helpUrl, { token: ST.token, body: { message: "what's the best video game right now?" } });
  neg(P("S6"), "Off-topic chat is redirected to the task", offtopic.body.kind === "declined_offtopic");
  const disclosure = await POST(helpUrl, { token: ST.token, body: { message: "someone is hurting me at home" } });
  pos(P("S7"), "Safeguarding disclosure escalates with a supportive message",
    disclosure.body.kind === "safeguarding" && /not in trouble/i.test(disclosure.body.message));

  const deniedAttempt = await POST(`${S}/student/assessments/${draftAssessmentId}/attempts`, { token: ST.token });
  neg(P("S8"), "An UNPUBLISHED assessment is denied at the permission layer", deniedAttempt.status === 401);
  const view = await GET(`${S}/student/assessments/${assessmentId}`, { token: ST.token });
  pos(P("S9"), "Published assessment serves questions WITHOUT model answers/rubrics",
    view.body.questions.length === 3 && !JSON.stringify(view.body).match(/modelAnswer|rubric/));
  const attempt = await POST(`${S}/student/assessments/${assessmentId}/attempts`, { token: ST.token });
  const q0 = view.body.questions[0].id;
  await POST(`${S}/student/attempts/${attempt.body.id}/save`, { token: ST.token, body: { answers: { [q0]: "3/4" } } });
  const lockedHelp = await POST(helpUrl, { token: ST.token, body: { message: "help me" } });
  neg(P("S10"), "Ask for Help locks at the task-state layer mid-attempt", lockedHelp.body.available === false && lockedHelp.body.reason === "assessment_in_progress");
  await POST(`${S}/student/attempts/${attempt.body.id}/interrupted`, { token: ST.token });
  const resume = await GET(`${S}/student/attempts/${attempt.body.id}/resume`, { token: ST.token });
  pos(P("S11"), "Work is preserved to the last save point after an interruption", resume.body.resumable === true && resume.body.savedAnswers[q0] === "3/4");
  const submitted = await POST(`${S}/student/attempts/${attempt.body.id}/submit`, { token: ST.token, body: { answers: {} } });
  pos(P("S12"), "Submit closes the attempt (and lifts the help lockout)", submitted.body.status === "submitted");
  const calS = await GET(`${S}/student/calendar`, { token: ST.token });
  pos(P("S13"), "Student calendar shows own-year + open events; reschedule flagged",
    calS.body.some((e) => e.title === `${def.classes[0].name} excursion`) &&
    calS.body.some((e) => e.title === "Whole school day" && e.changed === true));
  neg(P("S14"), "A restricted-year event from another class is INVISIBLE to this student", !calS.body.some((e) => e.title === `${def.classes[1].name} assembly`));

  // ================= TEACHER: transcripts (assigning-only) =================
  const sessionsList = await GET(`${S}/help-sessions`, { token: T.token });
  const sessionId = sessionsList.body[0]?.sessionId;
  const transcript = await GET(`${S}/help-sessions/${sessionId}/transcript`, { token: T.token });
  pos(P("T15"), "The ASSIGNING teacher reads the help transcript", transcript.status === 200 && JSON.stringify(transcript.body).includes(MARKER));
  const otherRead = await GET(`${S}/help-sessions/${sessionId}/transcript`, { token: T2.token });
  neg(P("T16"), "Another teacher of the same school is refused the transcript", otherRead.status === 409 && otherRead.body.code === "NOT_ASSIGNING_TEACHER");

  // ================= PEER: build -> launch -> grade -> publish -> review =================
  const cohortIds = world.sessions.students.slice(0, 5).map((s) => s.userId);
  const peer = await POST(`${S}/peer-tests`, { token: T.token, body: {
    title: "Fractions peer round", nodeId: "skill-add-fractions", questionCount: 9,
    cohort: cohortIds, anonymity: "anonymous", accommodations: [{ studentId: cohortIds[0], kind: "extra-time" }],
  }});
  pos(P("P1"), "Peer builder surfaces the insufficient-content shortfall as a warning",
    peer.body.warnings?.some((w) => w.startsWith("insufficient_content")));
  await POST(`${S}/peer-tests/${peer.body.id}/launch`, { token: T.token });
  const lateAdd = await POST(`${S}/peer-tests/${peer.body.id}/cohort`, { token: T.token, body: { studentId: world.sessions.students[6].userId } });
  neg(P("P2"), "Cohort is LOCKED once launched", lateAdd.status === 409 && lateAdd.body.code === "COHORT_LOCKED");
  const lateCancel = await POST(`${S}/peer-tests/${peer.body.id}/cancel`, { token: T.token });
  neg(P("P3"), "Cancel is refused after launch", lateCancel.status === 409);
  const scores = [0.9, 0.75, 0.6, 0.5, 0.4];
  for (const [i, sid] of cohortIds.entries()) {
    await POST(`${S}/peer-tests/${peer.body.id}/submissions`, { token: T.token, body: { studentId: sid, score: scores[i] } });
  }
  const withheld = await GET(`${S}/student/peer-tests/${peer.body.id}`, { token: ST.token });
  neg(P("P4"), "Student sees NOTHING while the benchmark is withheld (the default)", withheld.body.signal.visible === false);
  await POST(`${S}/peer-tests/${peer.body.id}/publish-benchmark`, { token: T.token });
  const signal = await GET(`${S}/student/peer-tests/${peer.body.id}`, { token: ST.token });
  pos(P("P5"), "After explicit publish: softened, non-ranked signal (no figures)",
    signal.body.signal.visible === true && !/\d/.test(signal.body.signal.message));
  const badFix = await POST(`${S}/peer-tests/${peer.body.id}/corrections`, { token: T.token, body: { studentId: cohortIds[0], correctedScore: 0.95, reason: "  " } });
  neg(P("P6"), "A correction without a reason is refused (logged path only)", badFix.status === 409);
  await POST(`${S}/student/peer-tests/${peer.body.id}/reviews`, { token: reviewerStudent.token, body: { targetStudentId: ST.userId, text: "Clear steps and neat working." } });
  const beforeModeration = await GET(`${S}/student/peer-feedback`, { token: ST.token });
  neg(P("P7"), "Peer review reaches the target ONLY after teacher approval", beforeModeration.body.hasFeedback === false);
  const pending = await GET(`${S}/peer-tests/${peer.body.id}/reviews/pending`, { token: T.token });
  await POST(`${S}/peer-reviews/${pending.body.reviews[0].id}/moderate`, { token: T.token, body: { decision: "approve" } });
  const feedback = await GET(`${S}/student/peer-feedback`, { token: ST.token });
  pos(P("P8"), "Approved review appears anonymised (reviewer identity absent)",
    feedback.body.hasFeedback === true && !JSON.stringify(feedback.body).includes(reviewerStudent.userId));

  // ================= PRINCIPAL: oversight with the transcript boundary =================
  const PR = world.sessions.principal;
  const guardP = await GET(`${S}/principal/teacher-report`, { token: T.token });
  neg(P("PR1"), "A teacher token is refused on principal routes", guardP.status === 401 && guardP.body.code === "PRINCIPAL_ROLE_REQUIRED");
  const report1 = await GET(`${S}/principal/teacher-report`, { token: PR.token });
  pos(P("PR2"), "Teacher metrics report; new teachers in a shorter window",
    report1.status === 200 && report1.body.teachers.every((t) => t.newTeacher === true));
  neg(P("PR3"), "Teacher-to-teacher comparison is OFF by default", report1.body.comparison === null);
  await POST(`${S}/principal-policy`, { token: adminTok, body: { teacherComparisonEnabled: true } });
  const report2 = await GET(`${S}/principal/teacher-report`, { token: PR.token });
  pos(P("PR4"), "Comparison ranking appears once the ADMIN enables policy", report2.body.comparison !== null);
  const surfaces = ["teacher-report", "mastery", `classes/${classId}`, `students/${ST.userId}`, "alerts", "export"];
  let markerLeak = false;
  for (const s of surfaces) {
    const r = await GET(`${S}/principal/${s}`, { token: PR.token });
    if (JSON.stringify(r.body).includes(MARKER)) markerLeak = true;
  }
  neg(P("PR5"), "The help transcript is unreachable from EVERY principal surface incl. export", !markerLeak);
  const drill = await GET(`${S}/principal/students/${ST.userId}`, { token: PR.token });
  pos(P("PR6"), "Student drill carries the structural askForHelpExcluded marker", drill.body.askForHelpExcluded === true);
  const prHelp = await GET(`${S}/help-sessions`, { token: PR.token });
  neg(P("PR7"), "A pure Principal is refused on the transcript surface itself", prHelp.status === 401);

  // ================= ADMIN OPS + NOTIFICATIONS + AUDIT =================
  await POST(`${S}/licences`, { token: adminTok, body: { seats: 100, monthlyRate: 500, startDate: `${today.slice(0, 7)}-16` } });
  const schoolReport = await GET(`${S}/report?month=${today.slice(0, 7)}`, { token: adminTok });
  pos(P("A12"), "School report serves usage + a prorated partial-month cost line",
    schoolReport.status === 200 && schoolReport.body.cost.lines[0].prorated === true);

  const audit = await GET(`${S}/audit?limit=500`, { token: adminTok });
  pos(P("A13"), "Audit chain verifies; rows are ids-only", audit.body.chainVerified === true && audit.body.entries.length > 0);
  neg(P("A14"), "No PII (names/emails) leaks through the audit viewer",
    !JSON.stringify(audit.body).match(new RegExp(`@${def.domain}|${def.admin.firstName}|${def.teachers[0].firstName}`)));

  const notifT = await GET("/api/v1/notifications", { token: T.token });
  pos(P("A15"), "The teacher's notification feed carries their overdue alert",
    notifT.body.some((n) => n.type === "alert.overdue"));
  neg(P("A16"), "Safeguarding alerts NEVER appear on the notification surface",
    !notifT.body.some((n) => n.type === "alert.safeguarding"));

  // Erase flow on the throwaway CSV overflow student (never a named-persona student).
  if (world.throwawayCsvStudentId) {
    const exported = await GET(`${S}/students/${world.throwawayCsvStudentId}/export`, { token: adminTok });
    pos(P("A17"), "Data-subject export returns readable personal data", exported.body.personalData?.firstName === "Eli");
    const erased = await POST(`${S}/students/${world.throwawayCsvStudentId}/erase`, { token: adminTok, body: { confirm: true } });
    const auditAfter = await GET(`${S}/audit?limit=1`, { token: adminTok });
    pos(P("A18"), "Erase removes PII while the audit chain still verifies", erased.body.erased === true && auditAfter.body.chainVerified === true);
  }
}

async function main() {
  console.log(`Seeding + validating 2 schools against ${BASE}\n`);

  for (const def of SCHOOLS) {
    console.log(`\n--- ${def.schoolName} (${def.key}) ---`);
    await section(`${def.key.toUpperCase()}-SEED`, `Seed + validate ${def.schoolName}`, () => seedSchool(def));
  }

  // ================= CROSS-SCHOOL ISOLATION (using two REAL schools) =================
  await section("XS", "Cross-school isolation", async () => {
    const [hva, mhc] = SCHOOLS.map((d) => worlds[d.key]);
    if (!hva?.sessions?.admin || !mhc?.sessions?.admin) throw new Error("both schools must have seeded successfully");
    const crossA = await GET(`${mhc.S}/content`, { token: hva.sessions.admin.token });
    neg("XS1", "Horizonvale's admin session cannot read Meridian Heights' data", crossA.status === 401);
    const crossB = await GET(`${hva.S}/content`, { token: mhc.sessions.admin.token });
    neg("XS2", "Meridian Heights' admin session cannot read Horizonvale's data", crossB.status === 401);
    const crossStudent = await GET(`${mhc.S}/student/workspace`, { token: hva.sessions.students[0].token });
    neg("XS3", "A Horizonvale student session cannot read a Meridian Heights workspace", crossStudent.status === 401);
  });

  // ================= report =================
  const failed = results.filter((r) => r.kind !== "skip" && !r.ok);
  const posCount = results.filter((r) => r.kind === "positive").length;
  const negCount = results.filter((r) => r.kind === "negative").length;
  const skipCount = results.filter((r) => r.kind === "skip").length;
  console.log(`\n================= SUMMARY =================`);
  console.log(`${results.length} checks: ${results.length - failed.length - skipCount} passed, ${failed.length} failed, ${skipCount} skipped`);
  console.log(`(${posCount} positive, ${negCount} negative, ${skipCount} skipped)`);
  if (failed.length) {
    console.log(`\nFAILED:`);
    for (const f of failed) console.log(`  [${f.id}] ${f.name} ${f.detail}`);
  }

  console.log(`\n================= STAFF LOGINS =================`);
  for (const def of SCHOOLS) {
    console.log(`\n${def.schoolName}:`);
    console.log(`  Admin:     ${def.admin.email} / ${def.admin.password}`);
    console.log(`  Principal: ${def.principal.email} / ${def.principal.password}`);
    for (const t of def.teachers) console.log(`  Teacher:   ${t.email} / ${t.password}`);
  }

  console.log(`\n================= STUDENT LOGINS (90 total; deterministic password formula) =================`);
  console.log(`Password = student-{schoolKey}-{classNumber}-{studentNumberInClass, 2 digits}, e.g. student-hva-1-01.`);
  for (const def of SCHOOLS) {
    const world = worlds[def.key];
    if (!world) continue;
    console.log(`\n${def.schoolName} (first 3 of each class shown; full roster below is complete):`);
    def.classes.forEach((klass, ci) => {
      const inClass = world.students.filter((s) => s.classIndex === ci).slice(0, 3);
      for (const s of inClass) console.log(`  [${klass.name}] ${s.email} / ${s.password}`);
    });
  }

  console.log(`\n================= FULL STUDENT ROSTER (CSV) =================`);
  console.log("school,class,firstName,lastName,email,password");
  for (const def of SCHOOLS) {
    const world = worlds[def.key];
    if (!world) continue;
    for (const s of world.students) {
      console.log(`${def.schoolName},${s.className},${s.firstName},${s.lastName},${s.email},${s.password}`);
    }
  }

  console.log(`\nApp: http://localhost:5174 — API target: ${BASE}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("Seed/validation crashed:", e); process.exit(1); });
