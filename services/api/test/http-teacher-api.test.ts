import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";

/**
 * Production Teacher HTTP surface (/api/v1) consumed by apps/app — the
 * content -> approve -> map -> assessment -> publish -> dashboard thread
 * (TCH-1/3/4/5/6), plus the admin skill-graph sign-off gate it depends on.
 *
 * Note: this file drives everything over HTTP with an in-memory context built
 * here (like http-admin-api.test.ts); the heatmap test seeds synthetic activity
 * through the same ctx the app shares.
 */

const NODE = "skill-add-fractions";

function makeApp() {
  const ctx = buildContext({ clock: new FixedClock() });
  return { ctx, app: buildApp({}, ctx) };
}

/** Create a school + admin over HTTP; returns admin session + ids. */
async function startSchool(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/onboarding/start",
    payload: {
      school: {
        name: `Teacher Thread High ${newId()}`,
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
      admin: { email: `admin-${newId()}@t.edu`, firstName: "Ada", lastName: "Admin", password: "password123" },
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { token: string; schoolId: string; campusId: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

/** Admin invites a teacher; the teacher accepts and gets their own session. */
async function addTeacher(
  app: ReturnType<typeof buildApp>,
  schoolId: string,
  adminAuth: Record<string, string>,
) {
  const email = `teacher-${newId()}@t.edu`;
  const invited = await app.inject({
    method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth,
    payload: { role: "teacher", email, firstName: "Tara", lastName: "Teach" },
  });
  // The admin's invite list surfaces the single-use link token (out-of-band delivery).
  const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth })).json() as
    { id: string; inviteToken: string | null }[];
  const token = rows.find((r) => r.id === invited.json().inviteId)!.inviteToken!;
  expect(token).toBeTruthy();
  const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
  expect(accepted.statusCode).toBe(200);
  return { auth: { authorization: `Bearer ${accepted.json().token as string}` } };
}

/** Admin imports the seed graph and signs it off (the human governance action). */
async function signOffGraph(app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>) {
  const imported = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/import-seed`, headers: adminAuth });
  expect(imported.statusCode).toBe(201);
  expect(imported.json()).toMatchObject({ status: "draft" });
  const versionId = imported.json().versionId as string;
  const signed = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/${versionId}/sign-off`, headers: adminAuth });
  expect(signed.json()).toMatchObject({ status: "signed_off" });
  return versionId;
}

/** Drive one item through the full pipeline over HTTP to approved + mapped. */
async function approveAndMap(
  app: ReturnType<typeof buildApp>,
  schoolId: string,
  teacherAuth: Record<string, string>,
  opts: { title: string; text: string; nodeId?: string },
) {
  const base = `/api/v1/schools/${schoolId}/content`;
  const up = await app.inject({ method: "POST", url: base, headers: teacherAuth, payload: { title: opts.title, fileType: "pdf", text: opts.text } });
  expect(up.statusCode).toBe(201);
  const itemId = up.json().contentItemId as string;
  for (const step of ["ingest", "classify", "classification/approve", "attest", "approve"]) {
    const res = await app.inject({ method: "POST", url: `${base}/${itemId}/${step}`, headers: teacherAuth });
    expect(res.statusCode, `step ${step}`).toBe(200);
  }
  if (opts.nodeId) {
    const map = await app.inject({ method: "POST", url: `${base}/${itemId}/map`, headers: teacherAuth, payload: { nodeIds: [opts.nodeId] } });
    expect(map.statusCode).toBe(201);
  }
  return itemId;
}

describe("Production Teacher API — content -> approve -> assessment -> publish over HTTP", () => {
  it("guards teacher routes: admin token, no token, and cross-school teacher are all denied", async () => {
    const { ctx, app } = makeApp();
    const one = await startSchool(app);
    const two = await startSchool(app);
    const outsider = await addTeacher(app, two.schoolId, two.auth);

    // No token and admin-only token are rejected (teacher role required).
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/content` })).statusCode).toBe(401);
    const asAdmin = await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/content`, headers: one.auth });
    expect(asAdmin.statusCode).toBe(401);
    expect(asAdmin.json().code).toBe("TEACHER_ROLE_REQUIRED");

    // A teacher from ANOTHER school is rejected on school scope.
    const cross = await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/content`, headers: outsider.auth });
    expect(cross.statusCode).toBe(401);

    // Branding READ is member-wide (white-label themes every surface, FR-WL) —
    // a teacher of the school can read it; an outsider cannot.
    const ownTeacher = await addTeacher(app, one.schoolId, one.auth);
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/branding`, headers: ownTeacher.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/branding`, headers: outsider.auth })).statusCode).toBe(401);
    await app.close();
  });

  it("walks the content pipeline: upload -> ingest -> classify -> approve steps -> approved chip", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    const base = `/api/v1/schools/${schoolId}/content`;

    const up = await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: { title: "Fractions pack", fileType: "pdf", text: "# Topic A\nExplain fractions clearly in prose." },
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({ status: "accepted" });
    const itemId = up.json().contentItemId as string;

    // Unsupported type is a per-item rejection, not an HTTP error.
    const bad = await app.inject({ method: "POST", url: base, headers: teacher.auth, payload: { title: "x", fileType: "exe", text: "nope" } });
    expect(bad.json()).toMatchObject({ status: "rejected", reason: "unsupported_file_type" });

    // Approval is BLOCKED until the pipeline prerequisites are met (M1 gate).
    const early = await app.inject({ method: "POST", url: `${base}/${itemId}/approve`, headers: teacher.auth });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("CONTENT_NOT_APPROVABLE");

    const ingest = await app.inject({ method: "POST", url: `${base}/${itemId}/ingest`, headers: teacher.auth });
    expect(ingest.json()).toMatchObject({ status: "ingested" });
    await app.inject({ method: "POST", url: `${base}/${itemId}/classify`, headers: teacher.auth });
    await app.inject({ method: "POST", url: `${base}/${itemId}/classification/approve`, headers: teacher.auth });
    await app.inject({ method: "POST", url: `${base}/${itemId}/attest`, headers: teacher.auth });
    const approved = await app.inject({ method: "POST", url: `${base}/${itemId}/approve`, headers: teacher.auth });
    expect(approved.json()).toMatchObject({ status: "approved" });

    // The library row reflects the terminal pipeline state.
    const list = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json() as any[];
    const row = list.find((r) => r.id === itemId);
    expect(row).toMatchObject({ status: "approved", rightsAttested: true, ingestionStatus: "ingested", approvalBlockReason: null });
    await app.close();
  });

  it("blocks mapping against an unsigned graph, then maps after the admin signs off", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);

    // Honest node-picker state before any graph exists.
    const none = await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/skills`, headers: teacher.auth });
    expect(none.json()).toMatchObject({ signedOff: false });

    const itemId = await approveAndMap(app, schoolId, teacher.auth, { title: "Unmapped yet", text: "# Topic A\nProse." });
    const blocked = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/content/${itemId}/map`, headers: teacher.auth,
      payload: { nodeIds: [NODE] },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("SKILL_GRAPH_NOT_SIGNED_OFF");

    await signOffGraph(app, schoolId, auth);
    const skills = await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/skills`, headers: teacher.auth });
    expect(skills.json().signedOff).toBe(true);
    expect((skills.json().nodes as any[]).some((n) => n.id === NODE)).toBe(true);

    const mapped = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/content/${itemId}/map`, headers: teacher.auth,
      payload: { nodeIds: [NODE] },
    });
    expect(mapped.statusCode).toBe(201);
    await app.close();
  });

  it("generates a grounded draft, gates publish behind review-ack, and is reversible before start", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    await approveAndMap(app, schoolId, teacher.auth, {
      title: "Fractions grounding", nodeId: NODE,
      text: "# Topic A\nExplain the idea clearly in prose.\n# Topic B\nExplain the idea clearly in prose.\n# Topic C\nExplain the idea clearly in prose.",
    });
    const base = `/api/v1/schools/${schoolId}/assessments`;

    const gen = await app.inject({
      method: "POST", url: `${base}/generate`, headers: teacher.auth,
      payload: { title: "Fractions check-in", nodeId: NODE, count: 3, difficulty: "mixed" },
    });
    expect(gen.statusCode).toBe(201);
    expect(gen.json()).toMatchObject({ status: "generated", questionCount: 3, shortfall: null });
    const id = gen.json().assessmentId as string;

    // The draft renders with questions + grounding sources; still a draft.
    const detail = (await app.inject({ method: "GET", url: `${base}/${id}`, headers: teacher.auth })).json();
    expect(detail.status).toBe("draft");
    expect(detail.questions).toHaveLength(3);
    expect(detail.questions[0].groundingSources[0]).toContain("Fractions grounding");

    // Publish before review-ack is refused (FR-ASM-004).
    const early = await app.inject({ method: "POST", url: `${base}/${id}/publish`, headers: teacher.auth });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("REVIEW_REQUIRED");

    await app.inject({ method: "POST", url: `${base}/${id}/acknowledge-review`, headers: teacher.auth });
    const pub = await app.inject({ method: "POST", url: `${base}/${id}/publish`, headers: teacher.auth });
    expect(pub.json()).toMatchObject({ status: "published" });

    // Reversible before the scheduled start.
    const unpub = await app.inject({ method: "POST", url: `${base}/${id}/unpublish`, headers: teacher.auth });
    expect(unpub.json()).toMatchObject({ status: "draft" });
    await app.close();
  });

  it("reports an honest shortfall when the approved pool cannot ground the request", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    // Two groundable sections only.
    await approveAndMap(app, schoolId, teacher.auth, {
      title: "Thin grounding", nodeId: NODE,
      text: "# Topic A\nExplain the idea clearly in prose.\n# Topic B\nExplain the idea clearly in prose.",
    });

    const gen = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/assessments/generate`, headers: teacher.auth,
      payload: { title: "Too many questions", nodeId: NODE, count: 10, difficulty: "mixed" },
    });
    const body = gen.json();
    expect(body.status).toBe("generated");
    expect(body.questionCount).toBeLessThan(10);
    expect(body.shortfall).toMatchObject({ requested: 10 });
    await app.close();
  });

  it("serves the class mastery heatmap with labels and flags (TCH-6)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);

    // A class with synthetic activity (M4 substrate) — seeded via the shared ctx.
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A", yearGroup: "8" } });
    const classId = cls.json().id as string;
    await ctx.synthetic.seedClass(schoolId, classId, { count: 25, seed: 42 });

    const classes = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/teacher/classes`, headers: teacher.auth })).json() as any[];
    expect(classes.some((c) => c.id === classId)).toBe(true);

    const hm = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/classes/${classId}/heatmap`, headers: teacher.auth })).json();
    expect(hm.enoughData).toBe(true);
    expect(hm.students.length).toBeGreaterThan(0);
    expect(hm.skills.length).toBeGreaterThan(0);
    expect(hm.cells.length).toBeGreaterThan(0);
    // Synthetic students hold no PII — positional labels only, resolved skill labels.
    expect(hm.students[0].label).toMatch(/^Student \d\d$/);
    expect(hm.skills.every((s: { id: string; label: string }) => s.label && s.label !== s.id)).toBe(true);

    // An empty class renders the honest not-enough-data state.
    const empty = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8B" } });
    const emptyHm = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/classes/${empty.json().id}/heatmap`, headers: teacher.auth })).json();
    expect(emptyHm.enoughData).toBe(false);
    await app.close();
  });

  it("suggests focus areas with material or a content gap; dismiss suppresses; assign is explicit (TCH-7)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const summary = await ctx.synthetic.seedClass(schoolId, classId, { count: 25, seed: 42 });
    const base = `/api/v1/schools/${schoolId}/classes/${classId}/focus-areas`;

    // The deterministic weak skill surfaces as a content gap (nothing mapped yet).
    let areas = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json() as any[];
    const gap = areas.find((a) => a.nodeId === summary.focusNodeId);
    expect(gap).toBeDefined();
    expect(gap.contentGap).toBe(true);
    expect(gap.suggested).toHaveLength(0);
    expect(gap.nodeLabel).toBeTruthy();

    // Approve + map material to that node — the suggestion now carries it by title.
    await approveAndMap(app, schoolId, teacher.auth, {
      title: "Reteach pack", nodeId: summary.focusNodeId,
      text: "# Topic A\nExplain the idea clearly in prose.\n# Topic B\nExplain the idea clearly in prose.",
    });
    areas = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json() as any[];
    const withMaterial = areas.find((a) => a.nodeId === summary.focusNodeId);
    expect(withMaterial.contentGap).toBe(false);
    expect(withMaterial.suggested[0].title).toBe("Reteach pack");

    // Assigning is an explicit teacher action over HTTP.
    const assign = await app.inject({
      method: "POST", url: `${base}/${summary.focusNodeId}/assign`, headers: teacher.auth,
      payload: { contentId: withMaterial.suggested[0].id },
    });
    expect(assign.statusCode).toBe(201);
    expect(assign.json().students).toBeGreaterThan(0);

    // Dismissing suppresses the suggestion until the data worsens (FR-TDB-002).
    await app.inject({ method: "POST", url: `${base}/${summary.focusNodeId}/dismiss`, headers: teacher.auth });
    areas = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json() as any[];
    expect(areas.some((a) => a.nodeId === summary.focusNodeId)).toBe(false);
    await app.close();
  });

  it("suggests editable cohorts; assigns only the final membership; refuses an empty group (TCH-8)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const summary = await ctx.synthetic.seedClass(schoolId, classId, { count: 25, seed: 42 });
    const base = `/api/v1/schools/${schoolId}/classes/${classId}/cohorts`;

    const groups = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json() as any[];
    const misconception = groups.find((g) => g.type === "misconception" && g.nodeId === summary.misconceptionNodeId);
    expect(misconception).toBeDefined();
    expect(misconception.students).toHaveLength(5);
    // Labels resolve without PII for synthetic students.
    expect(misconception.students[0].label).toMatch(/^Student \d\d$/);

    // The teacher removes one student — only the FINAL membership is assigned.
    const finalIds = misconception.students.slice(1).map((s: { id: string }) => s.id);
    const assign = await app.inject({
      method: "POST", url: `${base}/assign`, headers: teacher.auth,
      payload: { type: "misconception", nodeId: misconception.nodeId, studentIds: finalIds },
    });
    expect(assign.statusCode).toBe(201);
    expect(assign.json().students).toBe(4);

    // An emptied group is refused outright.
    const emptied = await app.inject({
      method: "POST", url: `${base}/assign`, headers: teacher.auth,
      payload: { type: "misconception", nodeId: misconception.nodeId, studentIds: [] },
    });
    expect(emptied.statusCode).toBe(409);
    expect(emptied.json().code).toBe("EMPTY_GROUP");
    await app.close();
  });

  it("surfaces adaptive escalations, revision reminders, and per-student next actions (TCH-9)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const summary = await ctx.synthetic.seedClass(schoolId, classId, { count: 25, seed: 42 });
    const base = `/api/v1/schools/${schoolId}/classes/${classId}/adaptive`;

    const panel = (await app.inject({ method: "GET", url: base, headers: teacher.auth })).json();
    // The seeded persistent misconception is escalated to the teacher (never a loop).
    const esc = (panel.escalations as any[]).find((e) => e.nodeId === summary.misconceptionNodeId);
    expect(esc).toBeDefined();
    expect(esc.occurrences).toBeGreaterThanOrEqual(3);
    expect(esc.studentLabel).toMatch(/^Student \d\d$/);
    // Stale skills produce spaced-revision reminders (none deferred: no attempt in progress).
    expect((panel.reminders as any[]).length).toBeGreaterThan(0);
    expect((panel.reminders as any[]).every((r) => r.deferred === false)).toBe(true);

    // Next action for the escalated pair is "escalate" with an honest reason.
    const na = await app.inject({
      method: "GET",
      url: `${base}/next-action?studentId=${esc.studentId}&nodeId=${esc.nodeId}`,
      headers: teacher.auth,
    });
    expect(na.json()).toMatchObject({ action: "escalate", escalated: true });

    // A student outside this class is not addressable from this route.
    const foreign = await app.inject({
      method: "GET", url: `${base}/next-action?studentId=not-in-class&nodeId=${esc.nodeId}`, headers: teacher.auth,
    });
    expect(foreign.statusCode).toBe(404);
    await app.close();
  });

  /** Import n students into class 8A via CSV; returns their ids from the picker. */
  async function importStudents(
    app: ReturnType<typeof buildApp>, schoolId: string, classId: string,
    adminAuth: Record<string, string>, teacherAuth: Record<string, string>, n: number,
  ) {
    const rows = ["firstName,lastName,email,role,class"];
    for (let i = 1; i <= n; i++) rows.push(`Stu,Dent${i},s${i}-${newId()}@t.edu,student,8A`);
    const imp = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/import/users`, headers: adminAuth, payload: { csv: rows.join("\n") } });
    expect(imp.json().imported).toHaveLength(n);
    const picker = await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/classes/${classId}/students`, headers: teacherAuth });
    return (picker.json() as { id: string; label: string }[]).map((s) => s.id);
  }

  it("peer builder surfaces shortfall + anonymity tension; cohort locks at launch; cancel is pre-launch only (TCH-10/11)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const students = await importStudents(app, schoolId, classId, auth, teacher.auth, 6);
    // Two groundable sections only -> a 5-question request is an honest shortfall.
    await approveAndMap(app, schoolId, teacher.auth, {
      title: "Peer grounding", nodeId: NODE,
      text: "# Topic A\nExplain the idea clearly in prose.\n# Topic B\nExplain the idea clearly in prose.",
    });
    const base = `/api/v1/schools/${schoolId}/peer-tests`;

    // Small anonymous cohort + accommodation -> BOTH warnings surface, never silent.
    const built = await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: {
        title: "Fractions peer check", nodeId: NODE, questionCount: 5,
        cohort: students.slice(0, 3), anonymity: "anonymous",
        accommodations: [{ studentId: students[0], kind: "extra-time" }],
      },
    });
    expect(built.statusCode).toBe(201);
    const test = built.json();
    expect(test.status).toBe("draft");
    expect(test.benchmarkPublish).toBe("withheld"); // default: nothing auto-releases
    expect(test.warnings.some((w: string) => w.startsWith("insufficient_content"))).toBe(true);
    expect(test.warnings.some((w: string) => w.startsWith("accommodation_anonymity_tension"))).toBe(true);
    expect(test.questionCount).toBe(2); // clamped to the groundable capacity

    // Pre-launch: cohort is editable; a clean cancel leaves no placements.
    await app.inject({ method: "POST", url: `${base}/${test.id}/cohort`, headers: teacher.auth, payload: { studentId: students[3] } });
    const cancelled = await app.inject({ method: "POST", url: `${base}/${test.id}/cancel`, headers: teacher.auth });
    expect(cancelled.json().status).toBe("cancelled");

    // A second test: launch locks the cohort; cancel is refused after launch.
    const second = (await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: { title: "Round 2", nodeId: NODE, questionCount: 2, cohort: students.slice(0, 5), anonymity: "named" },
    })).json();
    const launched = await app.inject({ method: "POST", url: `${base}/${second.id}/launch`, headers: teacher.auth });
    expect(launched.json().status).toBe("launched");
    const lockedAdd = await app.inject({ method: "POST", url: `${base}/${second.id}/cohort`, headers: teacher.auth, payload: { studentId: students[5] } });
    expect(lockedAdd.statusCode).toBe(409);
    expect(lockedAdd.json().code).toBe("COHORT_LOCKED");
    const lateCancel = await app.inject({ method: "POST", url: `${base}/${second.id}/cancel`, headers: teacher.auth });
    expect(lateCancel.statusCode).toBe(409);
    expect(lateCancel.json().code).toBe("ALREADY_LAUNCHED");
    // Launch placed it on each cohort student's dashboard (delivery record).
    expect(await ctx.peerTests.deliveriesForStudent(students[0])).toHaveLength(1);
    await app.close();
  });

  it("peer results: withheld by default, explicit publish, logged correction path, small cohort suppressed (TCH-12)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const students = await importStudents(app, schoolId, classId, auth, teacher.auth, 6);
    await approveAndMap(app, schoolId, teacher.auth, {
      title: "Peer grounding", nodeId: NODE,
      text: "# Topic A\nProse here.\n# Topic B\nProse here.",
    });
    const base = `/api/v1/schools/${schoolId}/peer-tests`;
    const test = (await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: { title: "Benchmarked", nodeId: NODE, questionCount: 2, cohort: students.slice(0, 5), anonymity: "named" },
    })).json();
    await app.inject({ method: "POST", url: `${base}/${test.id}/launch`, headers: teacher.auth });
    // Students complete it (student-side submission arrives with STU-5; seeded via ctx).
    const scores = [0.9, 0.8, 0.7, 0.6, 0.5];
    for (const [i, sid] of students.slice(0, 5).entries()) await ctx.peerTests.recordSubmission(test.id, sid, scores[i]);

    // Results: full figures for the teacher, decision explicitly required.
    let results = (await app.inject({ method: "GET", url: `${base}/${test.id}/results`, headers: teacher.auth })).json();
    expect(results).toMatchObject({ publishState: "withheld", requiresPublishDecision: true });
    expect(results.completion).toMatchObject({ completed: 5, total: 5 });
    expect(results.benchmark.suppressed).toBe(false);
    expect(results.benchmark.students).toHaveLength(5);
    expect(results.benchmark.students[0].label).toBeTruthy();

    // Correction goes through the LOGGED path and requires a reason.
    const noReason = await app.inject({
      method: "POST", url: `${base}/${test.id}/corrections`, headers: teacher.auth,
      payload: { studentId: students[0], correctedScore: 0.95, reason: "  " },
    });
    expect(noReason.statusCode).toBe(409);
    await app.inject({
      method: "POST", url: `${base}/${test.id}/corrections`, headers: teacher.auth,
      payload: { studentId: students[0], correctedScore: 0.95, reason: "Grading error on Q2" },
    });
    results = (await app.inject({ method: "GET", url: `${base}/${test.id}/results`, headers: teacher.auth })).json();
    expect(results.benchmark.students.find((s: any) => s.studentId === students[0]).score).toBe(0.95);

    // Publish is an explicit action; the student signal stays softened + non-ranked.
    const pub = await app.inject({ method: "POST", url: `${base}/${test.id}/publish-benchmark`, headers: teacher.auth });
    expect(pub.json().benchmarkPublish).toBe("published");
    const signal = await ctx.peerTests.studentSignal(test.id, students[4]);
    expect(signal.visible).toBe(true);
    expect(signal.message).not.toMatch(/\d/); // no figures, no rank

    // A cohort below the minimum is suppressed with an honest reason.
    const small = (await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: { title: "Tiny cohort", nodeId: NODE, questionCount: 1, cohort: students.slice(0, 3), anonymity: "named" },
    })).json();
    await app.inject({ method: "POST", url: `${base}/${small.id}/launch`, headers: teacher.auth });
    for (const sid of students.slice(0, 3)) await ctx.peerTests.recordSubmission(small.id, sid, 0.5);
    const smallResults = (await app.inject({ method: "GET", url: `${base}/${small.id}/results`, headers: teacher.auth })).json();
    expect(smallResults.benchmark.suppressed).toBe(true);
    expect(smallResults.benchmark.students).toHaveLength(0);
    await app.close();
  });

  it("moderates peer reviews approve/reject-only with anonymised text (TCH-12)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addTeacher(app, schoolId, auth);
    await signOffGraph(app, schoolId, auth);
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const classId = cls.json().id as string;
    const students = await importStudents(app, schoolId, classId, auth, teacher.auth, 6);
    await approveAndMap(app, schoolId, teacher.auth, { title: "G", nodeId: NODE, text: "# Topic A\nProse." });
    const base = `/api/v1/schools/${schoolId}/peer-tests`;
    const test = (await app.inject({
      method: "POST", url: base, headers: teacher.auth,
      payload: { title: "Reviewed", nodeId: NODE, questionCount: 1, cohort: students.slice(0, 5), anonymity: "anonymous" },
    })).json();
    await app.inject({ method: "POST", url: `${base}/${test.id}/launch`, headers: teacher.auth });

    // Two students review a peer (student-side submission arrives with STU-5).
    await ctx.peerReviews.submitReview(students[1], schoolId, test.id, students[0], "Clear working, nice diagrams.");
    await ctx.peerReviews.submitReview(students[2], schoolId, test.id, students[0], "This is rubbish.");

    const pending = (await app.inject({ method: "GET", url: `${base}/${test.id}/reviews/pending`, headers: teacher.auth })).json();
    expect(pending.reviews).toHaveLength(2);
    // Anonymised: the moderation payload never exposes reviewer identity.
    expect(JSON.stringify(pending.reviews)).not.toContain(students[1]);
    expect(JSON.stringify(pending.reviews)).not.toContain(students[2]);

    const nice = pending.reviews.find((r: any) => r.text.includes("diagrams"));
    const mean = pending.reviews.find((r: any) => r.text.includes("rubbish"));
    const approved = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/peer-reviews/${nice.id}/moderate`, headers: teacher.auth, payload: { decision: "approve" } });
    expect(approved.json().moderationState).toBe("approved");
    const rejected = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/peer-reviews/${mean.id}/moderate`, headers: teacher.auth, payload: { decision: "reject" } });
    expect(rejected.json().moderationState).toBe("rejected");

    // The reviewed student sees only the approved, anonymised text.
    const feedback = await ctx.peerReviews.feedbackForStudent(students[0]);
    expect(feedback.hasFeedback).toBe(true);
    expect(feedback.reviews).toEqual([{ text: "Clear working, nice diagrams." }]);
    await app.close();
  });
});
