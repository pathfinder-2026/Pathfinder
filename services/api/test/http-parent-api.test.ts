import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";

/**
 * Production Parent HTTP surface (/api/v1) — PAR-1..5. Verification-before-data
 * is absolute; summaries are plain-language and never diagnostic; the digest is
 * a single weekly consolidated cadence with none-when-nothing.
 */

const NODE = "skill-add-fractions";

function makeApp() {
  const clock = new FixedClock();
  const ctx = buildContext({ clock });
  return { ctx, clock, app: buildApp({}, ctx) };
}

async function startSchool(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/onboarding/start",
    payload: {
      school: {
        name: `Parent Thread High ${newId()}`,
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
      admin: { email: `admin-${newId()}@p.edu`, firstName: "Ada", lastName: "Admin", password: "password123" },
    },
  });
  const body = res.json() as { token: string; schoolId: string; campusId: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

async function addMember(
  app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>, role: "teacher" | "student" | "parent",
) {
  const invited = await app.inject({
    method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth,
    payload: { role, email: `${role}-${newId()}@p.edu`, firstName: role === "parent" ? "Pat" : "Sam", lastName: "Person" },
  });
  const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth })).json() as
    { id: string; inviteToken: string | null }[];
  const token = rows.find((r) => r.id === invited.json().inviteId)!.inviteToken!;
  const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
  const auth = { authorization: `Bearer ${accepted.json().token as string}` };
  const me = (await app.inject({ method: "GET", url: "/api/v1/me", headers: auth })).json();
  return { auth, userId: me.userId as string };
}

describe("Production Parent API — verification-before-data over HTTP", () => {
  it("holds ALL data behind verification, scopes to the own child, and speaks plainly (PAR-1/2)", async () => {
    const { ctx, app } = makeApp();
    const { schoolId, auth } = await startSchool(app);
    const parent = await addMember(app, schoolId, auth, "parent");
    const child = await addMember(app, schoolId, auth, "student");
    const otherChild = await addMember(app, schoolId, auth, "student");
    const base = `/api/v1/schools/${schoolId}/parent`;

    // Role guard: a student token is refused outright.
    const asStudent = await app.inject({ method: "GET", url: `${base}/children`, headers: child.auth });
    expect(asStudent.statusCode).toBe(401);
    expect(asStudent.json().code).toBe("PARENT_ROLE_REQUIRED");

    // Unverified link: the child does not appear, and every surface is denied.
    const link = await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/parent-links`, headers: auth,
      payload: { parentId: parent.userId, studentId: child.userId, relationship: "mother" },
    });
    expect(link.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: `${base}/children`, headers: parent.auth })).json()).toHaveLength(0);
    for (const surface of ["dashboard", "calendar", "report"]) {
      const denied = await app.inject({ method: "GET", url: `${base}/children/${child.userId}/${surface}`, headers: parent.auth });
      expect(denied.statusCode, surface).toBe(401);
    }

    // Verified: the child appears; the dashboard speaks plainly.
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/parent-links/${link.json().id}/verify`, headers: auth });
    const children = (await app.inject({ method: "GET", url: `${base}/children`, headers: parent.auth })).json();
    expect(children).toHaveLength(1);
    expect(children[0].studentId).toBe(child.userId);

    // No activity yet -> the plain "no recent activity" state, never stale data.
    let dash = (await app.inject({ method: "GET", url: `${base}/children/${child.userId}/dashboard`, headers: parent.auth })).json();
    expect(dash.hasRecentActivity).toBe(false);
    expect(dash.summaryText).toMatch(/no new activity/i);

    // With recent activity: plain-language summary, never diagnostic vocabulary.
    await ctx.activityStore.insertMastery({
      id: newId(), studentId: child.userId, schoolId, nodeId: NODE,
      level: "secure", score: 0.9, dataPoints: 5, lastActivityAt: ctx.clock.isoNow(), synthetic: false,
    } as never);
    dash = (await app.inject({ method: "GET", url: `${base}/children/${child.userId}/dashboard`, headers: parent.auth })).json();
    expect(dash.hasRecentActivity).toBe(true);
    expect(dash.strengths.length).toBeGreaterThan(0);
    expect(dash.summaryText).not.toMatch(/dyscalculia|disorder|deficit|diagnos|cognitive|impair/i);
    // Jargon stripped: no raw node ids leak into parent-facing topics.
    expect(JSON.stringify([dash.strengths, dash.focusAreas])).not.toContain("skill-");

    // Cross-student: the OTHER child is a hard 401 on every surface.
    const cross = await app.inject({ method: "GET", url: `${base}/children/${otherChild.userId}/dashboard`, headers: parent.auth });
    expect(cross.statusCode).toBe(401);
    await app.close();
  });

  it("keeps calendars per-child, serves the term report, and sends ONE digest only when there is news (PAR-3/4/5)", async () => {
    const { ctx, clock, app } = makeApp();
    const { schoolId, campusId, auth } = await startSchool(app);
    const teacher = await addMember(app, schoolId, auth, "teacher");
    const parent = await addMember(app, schoolId, auth, "parent");
    const child = await addMember(app, schoolId, auth, "student");
    const base = `/api/v1/schools/${schoolId}/parent`;

    // Place the child in a Year 8 class; link + verify.
    const cls = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A", yearGroup: "8" } });
    const accounts = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    const childRow = accounts.find((a) => a.userId === child.userId)!;
    await app.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${childRow.membershipId}/role`, headers: auth,
      payload: { role: "student", campusId, classId: cls.json().id },
    });
    const link = (await app.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/parent-links`, headers: auth,
      payload: { parentId: parent.userId, studentId: child.userId, relationship: "father" },
    })).json();
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/parent-links/${link.id}/verify`, headers: auth });

    // Calendar: the child's year group only — a Year 7 event is invisible.
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/calendar`, headers: teacher.auth, payload: { title: "Year 8 excursion", type: "class", eventDate: "2026-09-05", yearGroup: "8" } });
    await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/calendar`, headers: teacher.auth, payload: { title: "Year 7 assembly", type: "class", eventDate: "2026-09-06", yearGroup: "7" } });
    const cal = (await app.inject({ method: "GET", url: `${base}/children/${child.userId}/calendar`, headers: parent.auth })).json() as any[];
    expect(cal.some((e) => e.title === "Year 8 excursion")).toBe(true);
    expect(cal.some((e) => e.title === "Year 7 assembly")).toBe(false);

    // Digest: nothing new -> nothing sent; with activity -> exactly one consolidated digest.
    let run = (await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/parent-digest/run`, headers: auth })).json();
    expect(run.sent).toBe(0);
    expect((await app.inject({ method: "GET", url: `${base}/digests`, headers: parent.auth })).json()).toHaveLength(0);

    // New activity lands AFTER the last digest stamp (advance the fixed clock),
    // so the next weekly run has genuinely new items to consolidate.
    clock.advanceMs(60 * 60 * 1000);
    await ctx.activityStore.insertMastery({
      id: newId(), studentId: child.userId, schoolId, nodeId: NODE,
      level: "developing", score: 0.55, dataPoints: 4, lastActivityAt: ctx.clock.isoNow(), synthetic: false,
    } as never);
    clock.advanceMs(60 * 60 * 1000);
    run = (await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/parent-digest/run`, headers: auth })).json();
    expect(run.sent).toBe(1);
    const digests = (await app.inject({ method: "GET", url: `${base}/digests`, headers: parent.auth })).json();
    expect(digests).toHaveLength(1);

    // Term report: sections present, empty ones simply empty (never placeholders).
    const report = (await app.inject({ method: "GET", url: `${base}/children/${child.userId}/report`, headers: parent.auth })).json();
    expect(report.studentId).toBe(child.userId);
    expect(Array.isArray(report.teacherComments)).toBe(true);
    expect(Array.isArray(report.coCurricular)).toBe(true);
    expect(report.focusAreas.length).toBeGreaterThan(0);
    await app.close();
  });
});
