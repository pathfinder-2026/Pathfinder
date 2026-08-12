import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";

/**
 * Production Student HTTP surface (/api/v1) — STU-1..4, the safety-critical
 * thread: workspace, task detail + Ask for Help (state-layer lockout,
 * safeguarding gate), calendar (year-group invisibility, changed flag), and the
 * assessment attempt with work preservation. Everything drives over HTTP.
 */

const NODE = "skill-add-fractions";

function makeApp() {
  const ctx = buildContext({ clock: new FixedClock() });
  return { ctx, app: buildApp({}, ctx) };
}

async function startSchool(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/onboarding/start",
    payload: {
      school: {
        name: `Student Thread High ${newId()}`,
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
      admin: { email: `admin-${newId()}@s.edu`, firstName: "Ada", lastName: "Admin", password: "password123" },
    },
  });
  const body = res.json() as { token: string; schoolId: string; campusId: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

/** Invite + accept a user of the given role; returns their session + userId. */
async function addMember(
  app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>, role: "teacher" | "student",
) {
  const invited = await app.inject({
    method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth,
    payload: { role, email: `${role}-${newId()}@s.edu`, firstName: "Sam", lastName: "Person" },
  });
  const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth })).json() as
    { id: string; inviteToken: string | null }[];
  const token = rows.find((r) => r.id === invited.json().inviteId)!.inviteToken!;
  const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
  const auth = { authorization: `Bearer ${accepted.json().token as string}` };
  const me = (await app.inject({ method: "GET", url: "/api/v1/me", headers: auth })).json();
  return { auth, userId: me.userId as string };
}

/** Sign off the graph and approve+map one grounding item as the teacher. */
async function prepareGrounding(
  app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>, teacherAuth: Record<string, string>,
  sections = 3,
) {
  const imported = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/import-seed`, headers: adminAuth });
  await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/${imported.json().versionId}/sign-off`, headers: adminAuth });
  const text = Array.from({ length: sections }, (_, i) => `# Topic ${i}\nExplain the idea clearly in prose.`).join("\n");
  const base = `/api/v1/schools/${schoolId}/content`;
  const up = await app.inject({ method: "POST", url: base, headers: teacherAuth, payload: { title: "Grounding pack", fileType: "pdf", text } });
  const itemId = up.json().contentItemId as string;
  for (const step of ["ingest", "classify", "classification/approve", "attest", "approve"]) {
    await app.inject({ method: "POST", url: `${base}/${itemId}/${step}`, headers: teacherAuth });
  }
  await app.inject({ method: "POST", url: `${base}/${itemId}/map`, headers: teacherAuth, payload: { nodeIds: [NODE] } });
}

describe("Production Student API — the safety-critical workspace over HTTP", () => {
  it("guards student routes: teacher/no-token/cross-school all denied; students see only their own tasks", async () => {
    const { app } = makeApp();
    const one = await startSchool(app);
    const teacher = await addMember(app, one.schoolId, one.auth, "teacher");
    const student = await addMember(app, one.schoolId, one.auth, "student");
    const two = await startSchool(app);
    const outsider = await addMember(app, two.schoolId, two.auth, "student");

    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/student/workspace` })).statusCode).toBe(401);
    const asTeacher = await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/student/workspace`, headers: teacher.auth });
    expect(asTeacher.statusCode).toBe(401);
    expect(asTeacher.json().code).toBe("STUDENT_ROLE_REQUIRED");
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/student/workspace`, headers: outsider.auth })).statusCode).toBe(401);

    // Another student's task is unreachable (404, not merely hidden).
    const task = await app.inject({
      method: "POST", url: `/api/v1/schools/${one.schoolId}/tasks`, headers: teacher.auth,
      payload: { studentId: student.userId, type: "homework", title: "Own task", dueDate: "2026-09-01" },
    });
    const second = await addMember(app, one.schoolId, one.auth, "student");
    const cross = await app.inject({ method: "GET", url: `/api/v1/schools/${one.schoolId}/student/tasks/${task.json().id}`, headers: second.auth });
    expect(cross.statusCode).toBe(404);
    await app.close();
  });

  it("shows the calm workspace: friendly empty state, today/this-week, no-shame overdue + teacher notified once (STU-1)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const student = await addMember(app, schoolId, auth, "student");
    const wsUrl = `/api/v1/schools/${schoolId}/student/workspace`;

    // Empty state is a friendly message, not a blank screen.
    const empty = (await app.inject({ method: "GET", url: wsUrl, headers: student.auth })).json();
    expect(empty.hasTasks).toBe(false);
    expect(empty.emptyMessage).toMatch(/caught up/i);

    // One due today (FixedClock), one overdue.
    const today = ctx.clock.isoNow().slice(0, 10);
    await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/tasks`, headers: teacher.auth,
      payload: { studentId: student.userId, type: "homework", title: "Due today", dueDate: today },
    });
    await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/tasks`, headers: teacher.auth,
      payload: { studentId: student.userId, type: "practice", title: "Late one", dueDate: "2020-01-01" },
    });

    const ws = (await app.inject({ method: "GET", url: wsUrl, headers: student.auth })).json();
    expect(ws.hasTasks).toBe(true);
    expect(ws.today.some((t: any) => t.title === "Due today")).toBe(true);
    const late = ws.thisWeek.find((t: any) => t.title === "Late one");
    expect(late.overdue).toBe(true);
    // The overdue flag carries NO shaming language — it's a plain boolean the UI
    // renders as a calm tag; the assigning teacher is notified server-side, once.
    const overdueAlerts = ctx.notificationChannel.delivered.filter((m) => m.type === "alert.overdue");
    expect(overdueAlerts).toHaveLength(1);
    await app.inject({ method: "GET", url: wsUrl, headers: student.auth });
    expect(ctx.notificationChannel.delivered.filter((m) => m.type === "alert.overdue")).toHaveLength(1);
    await app.close();
  });

  it("Ask for Help: safeguarding gate, grounded hints never answers, refusals, escalation (STU-2 / FR-SAG)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const student = await addMember(app, schoolId, auth, "student");
    await prepareGrounding(app, schoolId, auth, teacher.auth);
    const task = (await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/tasks`, headers: teacher.auth,
      payload: { studentId: student.userId, type: "homework", title: "Adding fractions practice", nodeId: NODE, dueDate: "2026-09-01" },
    })).json();
    const helpUrl = `/api/v1/schools/${schoolId}/student/tasks/${task.id}/help`;

    // HARD GATE: no safeguarding contact configured -> Ask for Help refuses.
    const gated = (await app.inject({ method: "POST", url: helpUrl, headers: student.auth, payload: { message: "How do I start?" } })).json();
    expect(gated).toMatchObject({ available: false, reason: "safeguarding_not_configured" });

    await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth,
      payload: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" },
    });

    // Happy path: a scoped hint, grounded in the task's approved content.
    const hint = (await app.inject({ method: "POST", url: helpUrl, headers: student.auth, payload: { message: "How do I start adding these fractions?" } })).json();
    expect(hint).toMatchObject({ available: true, kind: "hint" });

    // Answer-extraction refused; off-topic redirected.
    const extract = (await app.inject({ method: "POST", url: helpUrl, headers: student.auth, payload: { message: "Just give me the answer to question 2" } })).json();
    expect(extract.kind).toBe("declined_direct_answer");
    expect(extract.message).toMatch(/won’t give you the answer/i);
    const offtopic = (await app.inject({ method: "POST", url: helpUrl, headers: student.auth, payload: { message: "What's the best video game right now?" } })).json();
    expect(offtopic.kind).toBe("declined_offtopic");

    // A safeguarding disclosure escalates to the configured contact with a
    // supportive message to the student — never an alarm.
    const disclosure = (await app.inject({ method: "POST", url: helpUrl, headers: student.auth, payload: { message: "someone is hurting me at home" } })).json();
    expect(disclosure.kind).toBe("safeguarding");
    expect(disclosure.message).toMatch(/not in trouble/i);
    expect(ctx.notificationChannel.delivered.some((m) => m.type === "alert.safeguarding")).toBe(true);
    await app.close();
  });

  it("calendar: other year groups' restricted events are invisible; reschedule is flagged (STU-3)", async () => {
    const { app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const student = await addMember(app, schoolId, auth, "student");
    // Put the student in a Year 8 class so year-group filtering applies.
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A", yearGroup: "8" } });
    const accounts = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    const membership = accounts.find((a) => a.userId === student.userId)!;
    await app.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${membership.membershipId}/role`, headers: auth,
      payload: { role: "student", campusId, classId: cls.json().id },
    });

    const calBase = `/api/v1/schools/${schoolId}/calendar`;
    await app.inject({ method: "POST", url: calBase, headers: teacher.auth, payload: { title: "Year 8 excursion", type: "class", eventDate: "2026-09-05", yearGroup: "8" } });
    await app.inject({ method: "POST", url: calBase, headers: teacher.auth, payload: { title: "Year 7 assembly", type: "class", eventDate: "2026-09-06", yearGroup: "7" } });
    const open = await app.inject({ method: "POST", url: calBase, headers: teacher.auth, payload: { title: "Whole school day", type: "co_curricular", eventDate: "2026-09-07" } });

    const calUrl = `/api/v1/schools/${schoolId}/student/calendar`;
    let cal = (await app.inject({ method: "GET", url: calUrl, headers: student.auth })).json() as any[];
    expect(cal.some((e) => e.title === "Year 8 excursion")).toBe(true);
    expect(cal.some((e) => e.title === "Whole school day")).toBe(true);
    // The Year 7 event is INVISIBLE — not greyed out, simply absent.
    expect(cal.some((e) => e.title === "Year 7 assembly")).toBe(false);

    await app.inject({ method: "POST", url: `${calBase}/${open.json().id}/reschedule`, headers: teacher.auth, payload: { newDate: "2026-09-09" } });
    cal = (await app.inject({ method: "GET", url: calUrl, headers: student.auth })).json() as any[];
    expect(cal.find((e) => e.title === "Whole school day")).toMatchObject({ date: "2026-09-09", changed: true });
    await app.close();
  });

  it("attempts a published assessment with work preservation; unpublished is denied; help locks mid-attempt (STU-4)", async () => {
    const { app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const student = await addMember(app, schoolId, auth, "student");
    await prepareGrounding(app, schoolId, auth, teacher.auth);
    await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth,
      payload: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" },
    });

    // Teacher generates + publishes an assessment (review-ack first).
    const gen = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/assessments/generate`, headers: teacher.auth,
      payload: { title: "Fractions check", nodeId: NODE, count: 3, difficulty: "mixed" },
    });
    const assessmentId = gen.json().assessmentId as string;

    // PERMISSION LAYER: the unpublished assessment is denied to the student.
    const early = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/student/assessments/${assessmentId}/attempts`, headers: student.auth,
    });
    expect(early.statusCode).toBe(401);

    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/assessments/${assessmentId}/acknowledge-review`, headers: teacher.auth });
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/assessments/${assessmentId}/publish`, headers: teacher.auth });

    // The student view carries questions but NEVER model answers or rubrics.
    const view = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/student/assessments/${assessmentId}`, headers: student.auth })).json();
    expect(view.questions.length).toBe(3);
    expect(JSON.stringify(view)).not.toMatch(/modelAnswer|rubric/);

    // Start; autosave; connectivity drops; resume preserves the save point.
    const base = `/api/v1/schools/${schoolId}/student`;
    const attempt = (await app.inject({ method: "POST", url: `${base}/assessments/${assessmentId}/attempts`, headers: student.auth })).json();
    const q0 = view.questions[0].id as string;
    await app.inject({ method: "POST", url: `${base}/attempts/${attempt.id}/save`, headers: student.auth, payload: { answers: { [q0]: "3/4" } } });

    // Mid-attempt, Ask for Help is locked at the TASK-STATE layer.
    const task = (await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/tasks`, headers: teacher.auth,
      payload: { studentId: student.userId, type: "homework", title: "Side homework", nodeId: NODE, dueDate: "2026-09-01" },
    })).json();
    const locked = (await app.inject({
      method: "POST", url: `${base}/tasks/${task.id}/help`, headers: student.auth, payload: { message: "How do I start?" },
    })).json();
    expect(locked).toMatchObject({ available: false, reason: "assessment_in_progress" });

    await app.inject({ method: "POST", url: `${base}/attempts/${attempt.id}/interrupted`, headers: student.auth });
    const resume = (await app.inject({ method: "GET", url: `${base}/attempts/${attempt.id}/resume`, headers: student.auth })).json();
    expect(resume.resumable).toBe(true);
    expect(resume.savedAnswers).toMatchObject({ [q0]: "3/4" });

    // Submit closes the attempt; the help lockout lifts.
    const submitted = (await app.inject({
      method: "POST", url: `${base}/attempts/${attempt.id}/submit`, headers: student.auth,
      payload: { answers: { [view.questions[1].id]: "1/2" } },
    })).json();
    expect(submitted.status).toBe("submitted");
    const unlocked = (await app.inject({
      method: "POST", url: `${base}/tasks/${task.id}/help`, headers: student.auth, payload: { message: "How do I start adding fractions?" },
    })).json();
    expect(unlocked.available).toBe(true);
    await app.close();
  });
});
