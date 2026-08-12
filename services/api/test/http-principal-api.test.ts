import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";

/**
 * Production Principal HTTP surface (/api/v1) — PRB-1..5. The non-negotiable:
 * Ask-for-Help transcripts are unreachable from EVERY principal route including
 * the export — verified here with a seeded real transcript and a unique marker.
 */

const NODE = "skill-add-fractions";
const MARKER = `unique-transcript-marker-${newId()}`;

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
        name: `Principal Thread High ${newId()}`,
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
      admin: { email: `admin-${newId()}@pr.edu`, firstName: "Ada", lastName: "Admin", password: "password123" },
    },
  });
  const body = res.json() as { token: string; schoolId: string; campusId: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

async function addMember(
  app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>, role: "teacher" | "student",
) {
  const invited = await app.inject({
    method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth,
    payload: { role, email: `${role}-${newId()}@pr.edu`, firstName: "Sam", lastName: "Person" },
  });
  const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth })).json() as
    { id: string; inviteToken: string | null }[];
  const token = rows.find((r) => r.id === invited.json().inviteId)!.inviteToken!;
  const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
  const auth = { authorization: `Bearer ${accepted.json().token as string}` };
  const me = (await app.inject({ method: "GET", url: "/api/v1/me", headers: auth })).json();
  return { auth, userId: me.userId as string };
}

/** Promote an invited teacher to a pure Principal via role change (FR-ADM-007). */
async function addPrincipal(app: ReturnType<typeof buildApp>, schoolId: string, campusId: string, adminAuth: Record<string, string>) {
  const member = await addMember(app, schoolId, adminAuth, "teacher");
  const accounts = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: adminAuth })).json() as any[];
  const row = accounts.find((a) => a.userId === member.userId)!;
  await app.inject({
    method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${row.membershipId}/role`, headers: adminAuth,
    payload: { role: "principal", campusId },
  });
  return member;
}

describe("Production Principal API — school oversight with the transcript boundary", () => {
  it("guards routes, reports teacher metrics, and gates comparison behind policy (PRB-1/2/4)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const principal = await addPrincipal(app, schoolId, campusId, auth);
    const base = `/api/v1/schools/${schoolId}/principal`;

    // A plain teacher is refused.
    const asTeacher = await app.inject({ method: "GET", url: `${base}/teacher-report`, headers: teacher.auth });
    expect(asTeacher.statusCode).toBe(401);
    expect(asTeacher.json().code).toBe("PRINCIPAL_ROLE_REQUIRED");

    // Teacher metrics: the fresh teacher shows in the shorter new-joiner window.
    const report = (await app.inject({ method: "GET", url: `${base}/teacher-report`, headers: principal.auth })).json();
    const row = report.teachers.find((t: any) => t.teacherId === teacher.userId);
    expect(row).toBeDefined();
    expect(row.newTeacher).toBe(true);
    expect(row.lowEngagementOutlier).toBe(false); // never flagged while new
    // Comparison is OFF by default (FR-PDB-006).
    expect(report.comparison).toBeNull();

    // Admin enables the policy -> the ranking appears going forward.
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/principal-policy`, headers: auth, payload: { teacherComparisonEnabled: true } });
    const after = (await app.inject({ method: "GET", url: `${base}/teacher-report`, headers: principal.auth })).json();
    expect(after.comparison).not.toBeNull();
    expect(Array.isArray(after.comparison.ranking)).toBe(true);

    // Mastery overview + alerts respond with school-level aggregates.
    const mastery = (await app.inject({ method: "GET", url: `${base}/mastery`, headers: principal.auth })).json();
    expect(mastery.schoolWide).toBeDefined();
    const alerts = await app.inject({ method: "GET", url: `${base}/alerts`, headers: principal.auth });
    expect(alerts.statusCode).toBe(200);
    await app.close();
  });

  it("drills to class + student with ZERO transcript content anywhere, incl. the export (PRB-3/5)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const student = await addMember(app, schoolId, auth, "student");
    const principal = await addPrincipal(app, schoolId, campusId, auth);
    const base = `/api/v1/schools/${schoolId}/principal`;

    // A class with the student + real mastery data.
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A", yearGroup: "8" } });
    const accounts = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    const stuRow = accounts.find((a) => a.userId === student.userId)!;
    await app.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${stuRow.membershipId}/role`, headers: auth,
      payload: { role: "student", campusId, classId: cls.json().id },
    });
    await ctx.activityStore.insertMastery({
      id: newId(), studentId: student.userId, schoolId, nodeId: NODE,
      level: "developing", score: 0.5, dataPoints: 4, lastActivityAt: ctx.clock.isoNow(), synthetic: false,
    } as never);

    // A REAL help transcript with a unique marker (the back-door bait).
    await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth,
      payload: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" },
    });
    const task = await ctx.studentWorkspace.assignTask(teacher.userId, schoolId, {
      studentId: student.userId, classId: cls.json().id, type: "practice", title: "Bait task", nodeId: NODE, dueDate: "2026-09-01",
    });
    const asked = await ctx.askForHelp.ask(student.userId, task.id, `I am stuck on ${MARKER} help me start`);
    expect(asked.available).toBe(true);

    // Every principal surface responds — and NONE carries the marker.
    const surfaces = [
      `${base}/teacher-report`,
      `${base}/mastery`,
      `${base}/classes/${cls.json().id}`,
      `${base}/students/${student.userId}`,
      `${base}/alerts`,
      `${base}/export`,
    ];
    for (const url of surfaces) {
      const res = await app.inject({ method: "GET", url, headers: principal.auth });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain(MARKER);
    }

    // The student drill carries the structural exclusion marker.
    const drill = (await app.inject({ method: "GET", url: `${base}/students/${student.userId}`, headers: principal.auth })).json();
    expect(drill.askForHelpExcluded).toBe(true);
    expect(drill.avgScore).toBeGreaterThan(0);

    // The pure Principal is also denied on the teacher transcript surface itself.
    const sessions = await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/help-sessions`, headers: principal.auth });
    expect(sessions.statusCode).toBe(401);
    await app.close();
  });
});
