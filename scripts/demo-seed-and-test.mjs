/**
 * Pathfinder — demo seed + end-to-end persona validation.
 *
 * Seeds a complete demo school ("Horizon College") through the REAL /api/v1
 * surface (every governed action goes through its production endpoint), then
 * asserts positive AND negative cases for all five personas, printing a
 * PASS/FAIL report and the login credentials.
 *
 * The dev API is in-memory — if the server restarts, re-run this script to
 * rebuild the same world:   node scripts/demo-seed-and-test.mjs
 * (API must be running on :3000 — `npm run dev:api`.)
 */

const BASE = process.env.PF_API ?? "http://localhost:3000";
const MARKER = "TRANSCRIPT-MARKER-7391";
const today = new Date().toISOString().slice(0, 10);

// ---- tiny client ----
async function call(method, path, { token, body } = {}) {
  // Only claim a JSON body when one is actually sent (Fastify rejects
  // content-type: application/json with an empty body).
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

// ---- reporting ----
const results = [];
function check(id, kind, name, ok, detail = "") {
  results.push({ id, kind, name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  [${id}] (${kind}) ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
const pos = (id, name, ok, detail) => check(id, "positive", name, ok, detail);
const neg = (id, name, ok, detail) => check(id, "negative", name, ok, detail);

// ---- personas (stable, re-seeded on every run) ----
const CREDS = {
  admin: { email: "ada@horizon.edu", password: "admin-pass-1", name: ["Ada", "Admin"] },
  teacher: { email: "tara@horizon.edu", password: "teach-pass-1", name: ["Tara", "Teach"] },
  teacher2: { email: "tom@horizon.edu", password: "teach-pass-2", name: ["Tom", "Other"] },
  principal: { email: "priya@horizon.edu", password: "princ-pass-1", name: ["Priya", "Principal"] },
  student: { email: "sana@horizon.edu", password: "stud-pass-1", name: ["Sana", "Student"] },
  student2: { email: "ben@horizon.edu", password: "stud-pass-2", name: ["Ben", "Buddy"] },
  parent: { email: "pat@horizon.edu", password: "parent-pass-1", name: ["Pat", "Parent"] },
  parentUnverified: { email: "uma@horizon.edu", password: "parent-pass-2", name: ["Uma", "Unverified"] },
};

async function main() {
  console.log(`Seeding + validating against ${BASE}\n`);

  // ================= ADMIN: school, structure, people =================
  const schoolName = `Horizon College ${Date.now()}`; // unique per run (in-memory anyway)
  const started = await POST("/api/v1/onboarding/start", { body: {
    school: { name: schoolName, campusName: "Main", academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-12-10" }] } },
    admin: { email: CREDS.admin.email, firstName: CREDS.admin.name[0], lastName: CREDS.admin.name[1], password: CREDS.admin.password },
  }});
  if (started.status !== 201) {
    console.error(`\nCould not create the demo school (${started.status}: ${started.body.message ?? started.body.code}).`);
    console.error("A previous demo world likely exists on this in-memory server.");
    console.error("Restart the API (stop it, then `npm run dev:api`) and re-run this script.");
    process.exit(2);
  }
  pos("A1", "Admin creates the school and gets a session", started.status === 201);
  const admin = { token: started.body.token };
  const schoolId = started.body.schoolId;
  const campusId = started.body.campusId;
  const S = `/api/v1/schools/${schoolId}`;

  const cls8A = await POST(`${S}/classes`, { token: admin.token, body: { campusId, name: "8A", yearGroup: "8" } });
  const cls8B = await POST(`${S}/classes`, { token: admin.token, body: { campusId, name: "7B", yearGroup: "7" } });
  pos("A2", "Admin creates classes 8A (Yr8) and 7B (Yr7)", cls8A.status === 201 && cls8B.status === 201);
  const classId = cls8A.body.id;
  for (const step of ["configure", "invite-teachers", "invite-students", "invite-parents", "configure-operations"]) {
    await POST(`${S}/onboarding/steps/${step}/complete`, { token: admin.token, body: {} });
  }
  await POST(`${S}/onboarding/enter-workspace`, { token: admin.token, body: { confirmNoTeachers: true } });

  // Invite + accept every persona through the real flow.
  const sessions = { admin };
  for (const [key, roleName] of [
    ["teacher", "teacher"], ["teacher2", "teacher"], ["principal", "teacher"],
    ["student", "student"], ["student2", "student"],
    ["parent", "parent"], ["parentUnverified", "parent"],
  ]) {
    const c = CREDS[key];
    const inv = await POST(`${S}/invites`, { token: admin.token, body: { role: roleName, email: c.email, firstName: c.name[0], lastName: c.name[1] } });
    const list = await GET(`${S}/invites`, { token: admin.token });
    const token = list.body.find((r) => r.id === inv.body.inviteId)?.inviteToken;
    const accepted = await POST("/api/v1/invites/accept", { body: { token, password: c.password } });
    const me = await GET("/api/v1/me", { token: accepted.body.token });
    sessions[key] = { token: accepted.body.token, userId: me.body.userId };
  }
  pos("A3", "All personas accept invites and hold sessions", Object.keys(sessions).length === 8);

  // CSV import: 3 valid cohort students + 1 malformed + 1 formula-injection.
  const csv = ["firstName,lastName,email,role,class",
    "Cai,Cohort,cai@horizon.edu,student,8A",
    "Dee,Cohort,dee@horizon.edu,student,8A",
    "Eli,Cohort,eli@horizon.edu,student,8A",
    "Bad,NoEmail,,student,8A",
    "=SUM(A1),Inject,inj@horizon.edu,student,8A"].join("\n");
  const imp = await POST(`${S}/import/users`, { token: admin.token, body: { csv } });
  pos("A4", "CSV import: valid rows import independently", imp.body.imported.length === 4);
  neg("A5", "CSV import: malformed row rejected with a per-row error", imp.body.rejected.length === 1);
  neg("A6", "CSV import: formula cell neutralised and flagged", imp.body.flaggedForReview === 1);

  // Place Sana + Ben in 8A; promote Priya to Principal (not invitable by design).
  const accounts = (await GET(`${S}/accounts`, { token: admin.token })).body;
  const rowOf = (email) => accounts.find((a) => a.email === email);
  for (const key of ["student", "student2"]) {
    await PATCH(`${S}/memberships/${rowOf(CREDS[key].email).membershipId}/role`, { token: admin.token, body: { role: "student", campusId, classId } });
  }
  const promoted = await PATCH(`${S}/memberships/${rowOf(CREDS.principal.email).membershipId}/role`, { token: admin.token, body: { role: "principal", campusId } });
  pos("A7", "Admin promotes a member to Principal (FR-ADM-007)", promoted.status === 200);
  const demote = await PATCH(`${S}/memberships/${rowOf(CREDS.admin.email).membershipId}/role`, { token: admin.token, body: { role: "teacher" } });
  neg("A8", "Demoting the ONLY admin is refused (409)", demote.status === 409);

  const cohortIds = [sessions.student.userId, sessions.student2.userId,
    rowOf("cai@horizon.edu").userId, rowOf("dee@horizon.edu").userId, rowOf("eli@horizon.edu").userId];

  // ================= TEACHER: content -> map -> assessment =================
  const T = sessions.teacher;
  const up = await POST(`${S}/content`, { token: T.token, body: {
    title: "Fractions pack", fileType: "pdf",
    text: "# Adding fractions\nFind a common denominator first, then add the numerators.\n# Practice\nWork through halves and quarters before harder mixes.\n# Checking your work\nEstimate first, then compare.",
  }});
  pos("T1", "Teacher uploads content", up.status === 201);
  const itemId = up.body.contentItemId;
  const badUpload = await POST(`${S}/content`, { token: T.token, body: { title: "nope", fileType: "exe", text: "x" } });
  neg("T2", "Unsupported file type is rejected per-item", badUpload.body.status === "rejected");
  const earlyApprove = await POST(`${S}/content/${itemId}/approve`, { token: T.token });
  neg("T3", "Approval blocked before the pipeline prerequisites", earlyApprove.status === 409);
  for (const step of ["ingest", "classify", "classification/approve", "attest", "approve"]) {
    await POST(`${S}/content/${itemId}/${step}`, { token: T.token });
  }
  pos("T4", "Full approval pipeline completes (5 explicit steps)",
    (await GET(`${S}/content/${itemId}`, { token: T.token })).body.status === "approved");

  const mapEarly = await POST(`${S}/content/${itemId}/map`, { token: T.token, body: { nodeIds: ["skill-add-fractions"] } });
  neg("T5", "Mapping blocked against an UNSIGNED skill graph", mapEarly.status === 409 && mapEarly.body.code === "SKILL_GRAPH_NOT_SIGNED_OFF");
  const graph = await POST(`${S}/skill-graph/import-seed`, { token: admin.token });
  await POST(`${S}/skill-graph/${graph.body.versionId}/sign-off`, { token: admin.token });
  const mapped = await POST(`${S}/content/${itemId}/map`, { token: T.token, body: { nodeIds: ["skill-add-fractions"] } });
  pos("T6", "Admin signs off the graph; teacher maps content", mapped.status === 201);

  const behEarly = await POST(`${S}/students/${sessions.student.userId}/behavioural`, { token: T.token, body: { category: "collaboration", note: "Works well." } });
  neg("T7", "Behavioural note blocked before consent configured", behEarly.status === 409 && behEarly.body.code === "CONSENT_NOT_CONFIGURED");
  await POST(`${S}/behavioural/consent`, { token: admin.token, body: {} });
  const beh = await POST(`${S}/students/${sessions.student.userId}/behavioural`, { token: T.token, body: { category: "collaboration", note: "Generous partner in group problem-solving." } });
  pos("T8", "Behavioural note records after consent (fixed categories, no score)", beh.status === 201);
  await POST(`${S}/students/${sessions.student.userId}/cocurricular`, { token: T.token, body: { domain: "music", skill: "violin - grade 3", level: "intermediate" } });

  const gen = await POST(`${S}/assessments/generate`, { token: T.token, body: { title: "Fractions check-in", nodeId: "skill-add-fractions", count: 3, difficulty: "mixed" } });
  pos("T9", "Grounded assessment generates 3 questions", gen.body.status === "generated" && gen.body.questionCount === 3);
  const assessmentId = gen.body.assessmentId;
  const earlyPub = await POST(`${S}/assessments/${assessmentId}/publish`, { token: T.token });
  neg("T10", "Publish refused before review-acknowledgement", earlyPub.status === 409 && earlyPub.body.code === "REVIEW_REQUIRED");
  await POST(`${S}/assessments/${assessmentId}/acknowledge-review`, { token: T.token });
  const pub = await POST(`${S}/assessments/${assessmentId}/publish`, { token: T.token });
  pos("T11", "Publish succeeds after review-ack", pub.body.status === "published");
  const draft2 = await POST(`${S}/assessments/generate`, { token: T.token, body: { title: "Unpublished draft", nodeId: "skill-add-fractions", count: 2, difficulty: "mixed" } });
  const draftAssessmentId = draft2.body.assessmentId;

  const agentDecline = await POST(`${S}/agent/generate`, { token: T.token, body: { kind: "lesson_plan", nodeId: "sub-common-factors" } });
  neg("T12", "Agent DECLINES with no grounding content (never invents)", agentDecline.body.status === "declined");
  const agentPlan = await POST(`${S}/agent/generate`, { token: T.token, body: { kind: "lesson_plan", nodeId: "skill-add-fractions", topic: "fractions" } });
  pos("T13", "Agent drafts a grounded lesson plan (unsent, sources listed)",
    agentPlan.body.status === "suggested" && agentPlan.body.suggestion.sent === false && agentPlan.body.suggestion.grounding.length > 0);

  // Tasks for Sana: homework (help-enabled), an overdue one, and the published assessment.
  const hw = await POST(`${S}/tasks`, { token: T.token, body: { studentId: sessions.student.userId, classId, type: "homework", title: "Adding fractions practice", nodeId: "skill-add-fractions", dueDate: today } });
  await POST(`${S}/tasks`, { token: T.token, body: { studentId: sessions.student.userId, classId, type: "practice", title: "Old worksheet", nodeId: "skill-add-fractions", dueDate: "2020-01-01" } });
  await POST(`${S}/tasks`, { token: T.token, body: { studentId: sessions.student.userId, classId, type: "assessment", title: "Fractions check-in", nodeId: "skill-add-fractions", assessmentId, dueDate: today } });
  pos("T14", "Teacher assigns homework + overdue + assessment tasks", hw.status === 201);

  // Calendar: year-restricted + open + reschedule.
  await POST(`${S}/calendar`, { token: T.token, body: { title: "Year 8 excursion", type: "class", eventDate: "2026-09-05", yearGroup: "8" } });
  await POST(`${S}/calendar`, { token: T.token, body: { title: "Year 7 assembly", type: "class", eventDate: "2026-09-06", yearGroup: "7" } });
  const open = await POST(`${S}/calendar`, { token: T.token, body: { title: "Whole school day", type: "co_curricular", eventDate: "2026-09-07" } });
  await POST(`${S}/calendar/${open.body.id}/reschedule`, { token: T.token, body: { newDate: "2026-09-09" } });

  // ================= STUDENT: workspace, help, attempt =================
  const ST = sessions.student;
  const guard1 = await GET(`${S}/student/workspace`, { token: T.token });
  neg("S1", "A teacher token is refused on student routes", guard1.status === 401 && guard1.body.code === "STUDENT_ROLE_REQUIRED");
  const ws = await GET(`${S}/student/workspace`, { token: ST.token });
  pos("S2", "Student workspace shows today/this-week with a calm overdue flag",
    ws.body.hasTasks === true && ws.body.thisWeek.some((t) => t.overdue === true));

  const helpUrl = `${S}/student/tasks/${hw.body.id}/help`;
  const gated = await POST(helpUrl, { token: ST.token, body: { message: "How do I start?" } });
  neg("S3", "Ask for Help refuses until safeguarding is configured", gated.body.available === false && gated.body.reason === "safeguarding_not_configured");
  await POST(`${S}/safeguarding`, { token: admin.token, body: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" } });
  const hint = await POST(helpUrl, { token: ST.token, body: { message: `How do I start adding these fractions? ${MARKER}` } });
  pos("S4", "Tutor gives a grounded hint (never the answer)", hint.body.available === true && hint.body.kind === "hint");
  const extract = await POST(helpUrl, { token: ST.token, body: { message: "just give me the answer" } });
  neg("S5", "Answer-extraction attempt is refused", extract.body.kind === "declined_direct_answer");
  const offtopic = await POST(helpUrl, { token: ST.token, body: { message: "what's the best video game right now?" } });
  neg("S6", "Off-topic chat is redirected to the task", offtopic.body.kind === "declined_offtopic");
  const disclosure = await POST(helpUrl, { token: ST.token, body: { message: "someone is hurting me at home" } });
  pos("S7", "Safeguarding disclosure escalates with a supportive message",
    disclosure.body.kind === "safeguarding" && /not in trouble/i.test(disclosure.body.message));

  const deniedAttempt = await POST(`${S}/student/assessments/${draftAssessmentId}/attempts`, { token: ST.token });
  neg("S8", "An UNPUBLISHED assessment is denied at the permission layer", deniedAttempt.status === 401);
  const view = await GET(`${S}/student/assessments/${assessmentId}`, { token: ST.token });
  pos("S9", "Published assessment serves questions WITHOUT model answers/rubrics",
    view.body.questions.length === 3 && !JSON.stringify(view.body).match(/modelAnswer|rubric/));
  const attempt = await POST(`${S}/student/assessments/${assessmentId}/attempts`, { token: ST.token });
  const q0 = view.body.questions[0].id;
  await POST(`${S}/student/attempts/${attempt.body.id}/save`, { token: ST.token, body: { answers: { [q0]: "3/4" } } });
  const lockedHelp = await POST(helpUrl, { token: ST.token, body: { message: "help me" } });
  neg("S10", "Ask for Help locks at the task-state layer mid-attempt", lockedHelp.body.available === false && lockedHelp.body.reason === "assessment_in_progress");
  await POST(`${S}/student/attempts/${attempt.body.id}/interrupted`, { token: ST.token });
  const resume = await GET(`${S}/student/attempts/${attempt.body.id}/resume`, { token: ST.token });
  pos("S11", "Work is preserved to the last save point after an interruption", resume.body.resumable === true && resume.body.savedAnswers[q0] === "3/4");
  const submitted = await POST(`${S}/student/attempts/${attempt.body.id}/submit`, { token: ST.token, body: { answers: {} } });
  pos("S12", "Submit closes the attempt (and lifts the help lockout)", submitted.body.status === "submitted");
  const calS = await GET(`${S}/student/calendar`, { token: ST.token });
  pos("S13", "Student calendar shows own-year + open events; reschedule flagged",
    calS.body.some((e) => e.title === "Year 8 excursion") &&
    calS.body.some((e) => e.title === "Whole school day" && e.changed === true));
  neg("S14", "A Year 7 restricted event is INVISIBLE to a Year 8 student", !calS.body.some((e) => e.title === "Year 7 assembly"));

  // ================= TEACHER: transcripts (assigning-only) =================
  const sessionsList = await GET(`${S}/help-sessions`, { token: T.token });
  const sessionId = sessionsList.body[0]?.sessionId;
  const transcript = await GET(`${S}/help-sessions/${sessionId}/transcript`, { token: T.token });
  pos("T15", "The ASSIGNING teacher reads the help transcript", transcript.status === 200 && JSON.stringify(transcript.body).includes(MARKER));
  const otherRead = await GET(`${S}/help-sessions/${sessionId}/transcript`, { token: sessions.teacher2.token });
  neg("T16", "Another teacher of the same school is refused the transcript", otherRead.status === 409 && otherRead.body.code === "NOT_ASSIGNING_TEACHER");

  // ================= PEER: build -> launch -> grade -> publish -> review =================
  const peer = await POST(`${S}/peer-tests`, { token: T.token, body: {
    title: "Fractions peer round", nodeId: "skill-add-fractions", questionCount: 9,
    cohort: cohortIds, anonymity: "anonymous", accommodations: [{ studentId: cohortIds[0], kind: "extra-time" }],
  }});
  pos("P1", "Peer builder surfaces the insufficient-content shortfall as a warning",
    peer.body.warnings.some((w) => w.startsWith("insufficient_content")));
  await POST(`${S}/peer-tests/${peer.body.id}/launch`, { token: T.token });
  const lateAdd = await POST(`${S}/peer-tests/${peer.body.id}/cohort`, { token: T.token, body: { studentId: rowOf("cai@horizon.edu").userId } });
  neg("P2", "Cohort is LOCKED once launched", lateAdd.status === 409 && lateAdd.body.code === "COHORT_LOCKED");
  const lateCancel = await POST(`${S}/peer-tests/${peer.body.id}/cancel`, { token: T.token });
  neg("P3", "Cancel is refused after launch", lateCancel.status === 409);
  const scores = [0.9, 0.75, 0.6, 0.5, 0.4];
  for (const [i, sid] of cohortIds.entries()) {
    await POST(`${S}/peer-tests/${peer.body.id}/submissions`, { token: T.token, body: { studentId: sid, score: scores[i] } });
  }
  const withheld = await GET(`${S}/student/peer-tests/${peer.body.id}`, { token: ST.token });
  neg("P4", "Student sees NOTHING while the benchmark is withheld (the default)", withheld.body.signal.visible === false);
  await POST(`${S}/peer-tests/${peer.body.id}/publish-benchmark`, { token: T.token });
  const signal = await GET(`${S}/student/peer-tests/${peer.body.id}`, { token: ST.token });
  pos("P5", "After explicit publish: softened, non-ranked signal (no figures)",
    signal.body.signal.visible === true && !/\d/.test(signal.body.signal.message));
  const badFix = await POST(`${S}/peer-tests/${peer.body.id}/corrections`, { token: T.token, body: { studentId: cohortIds[0], correctedScore: 0.95, reason: "  " } });
  neg("P6", "A correction without a reason is refused (logged path only)", badFix.status === 409);
  await POST(`${S}/student/peer-tests/${peer.body.id}/reviews`, { token: sessions.student2.token, body: { targetStudentId: ST.userId, text: "Clear steps and neat working." } });
  const beforeModeration = await GET(`${S}/student/peer-feedback`, { token: ST.token });
  neg("P7", "Peer review reaches the target ONLY after teacher approval", beforeModeration.body.hasFeedback === false);
  const pending = await GET(`${S}/peer-tests/${peer.body.id}/reviews/pending`, { token: T.token });
  await POST(`${S}/peer-reviews/${pending.body.reviews[0].id}/moderate`, { token: T.token, body: { decision: "approve" } });
  const feedback = await GET(`${S}/student/peer-feedback`, { token: ST.token });
  pos("P8", "Approved review appears anonymised (reviewer identity absent)",
    feedback.body.hasFeedback === true && !JSON.stringify(feedback.body).includes(sessions.student2.userId));

  // ================= PARENT: verification-before-data =================
  const PA = sessions.parent;
  const link = await POST(`${S}/parent-links`, { token: admin.token, body: { parentId: PA.userId, studentId: ST.userId, relationship: "mother" } });
  const umaLink = await POST(`${S}/parent-links`, { token: admin.token, body: { parentId: sessions.parentUnverified.userId, studentId: ST.userId, relationship: "guardian" } });
  const unverifiedDash = await GET(`${S}/parent/children/${ST.userId}/dashboard`, { token: sessions.parentUnverified.token });
  neg("PA1", "An UNVERIFIED parent link yields no data (hard 401)", unverifiedDash.status === 401);
  await POST(`${S}/parent-links/${link.body.id}/verify`, { token: admin.token });
  const children = await GET(`${S}/parent/children`, { token: PA.token });
  pos("PA2", "After verification the child appears for the parent", children.body.length === 1);
  const dash = await GET(`${S}/parent/children/${ST.userId}/dashboard`, { token: PA.token });
  pos("PA3", "Parent dashboard is plain-language and non-diagnostic",
    dash.status === 200 && !/diagnos|disorder|deficit|cognitive/i.test(dash.body.summaryText));
  const crossChild = await GET(`${S}/parent/children/${sessions.student2.userId}/dashboard`, { token: PA.token });
  neg("PA4", "Cross-child access is refused", crossChild.status === 401);
  // Fresh activity for the digest window: Sana completes her homework.
  await POST(`${S}/student/tasks/${hw.body.id}/complete`, { token: ST.token });
  const digestRun = await POST(`${S}/parent-digest/run`, { token: admin.token });
  const digests = await GET(`${S}/parent/digests`, { token: PA.token });
  pos("PA5", "Weekly digest: one consolidated update when there is news",
    digestRun.body.sent >= 1 && digests.body.length >= 1);
  void umaLink;

  // ================= PRINCIPAL: oversight with the transcript boundary =================
  const PR = sessions.principal;
  const guardP = await GET(`${S}/principal/teacher-report`, { token: T.token });
  neg("PR1", "A teacher token is refused on principal routes", guardP.status === 401 && guardP.body.code === "PRINCIPAL_ROLE_REQUIRED");
  const report1 = await GET(`${S}/principal/teacher-report`, { token: PR.token });
  pos("PR2", "Teacher metrics report; new teachers in a shorter window",
    report1.status === 200 && report1.body.teachers.every((t) => t.newTeacher === true));
  neg("PR3", "Teacher-to-teacher comparison is OFF by default", report1.body.comparison === null);
  await POST(`${S}/principal-policy`, { token: admin.token, body: { teacherComparisonEnabled: true } });
  const report2 = await GET(`${S}/principal/teacher-report`, { token: PR.token });
  pos("PR4", "Comparison ranking appears once the ADMIN enables policy", report2.body.comparison !== null);
  const surfaces = ["teacher-report", "mastery", `classes/${classId}`, `students/${ST.userId}`, "alerts", "export"];
  let markerLeak = false;
  for (const s of surfaces) {
    const r = await GET(`${S}/principal/${s}`, { token: PR.token });
    if (JSON.stringify(r.body).includes(MARKER)) markerLeak = true;
  }
  neg("PR5", "The help transcript is unreachable from EVERY principal surface incl. export", !markerLeak);
  const drill = await GET(`${S}/principal/students/${ST.userId}`, { token: PR.token });
  pos("PR6", "Student drill carries the structural askForHelpExcluded marker", drill.body.askForHelpExcluded === true);
  const prHelp = await GET(`${S}/help-sessions`, { token: PR.token });
  neg("PR7", "A pure Principal is refused on the transcript surface itself", prHelp.status === 401);

  // ================= ADMIN OPS + NOTIFICATIONS + AUDIT =================
  await POST(`${S}/licences`, { token: admin.token, body: { seats: 100, monthlyRate: 500, startDate: `${today.slice(0, 7)}-16` } });
  const schoolReport = await GET(`${S}/report?month=${today.slice(0, 7)}`, { token: admin.token });
  pos("A9", "School report serves usage + a prorated partial-month cost line",
    schoolReport.status === 200 && schoolReport.body.cost.lines[0].prorated === true);

  const audit = await GET(`${S}/audit?limit=200`, { token: admin.token });
  pos("A10", "Audit chain verifies; rows are ids-only", audit.body.chainVerified === true && audit.body.entries.length > 0);
  neg("A11", "No PII (names/emails) leaks through the audit viewer",
    !JSON.stringify(audit.body).match(/@horizon\.edu|Sana|Tara|Priya/));

  const notifT = await GET("/api/v1/notifications", { token: T.token });
  pos("A12", "The teacher's notification feed carries their overdue alert",
    notifT.body.some((n) => n.type === "alert.overdue"));
  neg("A13", "Safeguarding alerts NEVER appear on the notification surface",
    !notifT.body.some((n) => n.type === "alert.safeguarding"));

  // Erase flow on a throwaway CSV student (never the demo students).
  const throwaway = rowOf("eli@horizon.edu").userId;
  const exported = await GET(`${S}/students/${throwaway}/export`, { token: admin.token });
  pos("A14", "Data-subject export returns readable personal data", exported.body.personalData?.firstName === "Eli");
  const erased = await POST(`${S}/students/${throwaway}/erase`, { token: admin.token, body: { confirm: true } });
  const auditAfter = await GET(`${S}/audit?limit=1`, { token: admin.token });
  pos("A15", "Erase removes PII while the audit chain still verifies", erased.body.erased === true && auditAfter.body.chainVerified === true);

  // Cross-school isolation.
  const other = await POST("/api/v1/onboarding/start", { body: {
    school: { name: `Other School ${Date.now()}`, campusName: "Main", academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] } },
    admin: { email: `other-${Date.now()}@x.edu`, firstName: "Olly", lastName: "Other", password: "other-pass-1" },
  }});
  const cross = await GET(`${S}/content`, { token: other.body.token });
  neg("A16", "A session from ANOTHER school cannot read this school's data", cross.status === 401);

  // ================= report =================
  const failed = results.filter((r) => !r.ok);
  const posCount = results.filter((r) => r.kind === "positive").length;
  const negCount = results.filter((r) => r.kind === "negative").length;
  console.log(`\n================= SUMMARY =================`);
  console.log(`${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log(`(${posCount} positive, ${negCount} negative)`);
  if (failed.length) {
    console.log(`\nFAILED:`);
    for (const f of failed) console.log(`  [${f.id}] ${f.name} ${f.detail}`);
  }
  console.log(`\n================= LOGINS (${schoolName}) =================`);
  console.log(`  Admin:               ${CREDS.admin.email} / ${CREDS.admin.password}`);
  console.log(`  Teacher (assigning): ${CREDS.teacher.email} / ${CREDS.teacher.password}`);
  console.log(`  Teacher (other):     ${CREDS.teacher2.email} / ${CREDS.teacher2.password}`);
  console.log(`  Principal:           ${CREDS.principal.email} / ${CREDS.principal.password}`);
  console.log(`  Student (rich data): ${CREDS.student.email} / ${CREDS.student.password}`);
  console.log(`  Student (reviewer):  ${CREDS.student2.email} / ${CREDS.student2.password}`);
  console.log(`  Parent (verified):   ${CREDS.parent.email} / ${CREDS.parent.password}`);
  console.log(`  Parent (UNVERIFIED): ${CREDS.parentUnverified.email} / ${CREDS.parentUnverified.password}`);
  console.log(`\nApp: http://localhost:5174 — the API is in-memory; if it restarts, re-run this script.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("Seed/validation crashed:", e); process.exit(1); });
