import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";

/**
 * Production Admin onboarding HTTP surface (/api/v1) consumed by apps/app.
 * Drives the whole 7-step flow end-to-end over HTTP and checks the session guard.
 */
const START = {
  school: {
    name: "Riverbank College",
    campusName: "Main Campus",
    academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
  },
  admin: { email: "ada@riverbank.edu", firstName: "Ada", lastName: "Admin", password: "password123" },
};

function app() {
  return buildApp({}, buildContext({ clock: new FixedClock() }));
}

async function start(a: ReturnType<typeof app>) {
  const res = await a.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START });
  expect(res.statusCode).toBe(201);
  return res.json() as { token: string; schoolId: string; campusId: string; adminId: string };
}

describe("Production Admin API — onboarding over HTTP", () => {
  it("walks the full 7-step onboarding flow to entering the workspace", async () => {
    const a = app();
    const { token, schoolId, campusId } = await start(a);
    const auth = { authorization: `Bearer ${token}` };

    // create is completed by /start.
    let ob = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/onboarding`, headers: auth })).json();
    expect(ob.completedSteps).toContain("create");
    expect(ob.currentStep).toBe("configure");

    // configure: create a class, then mark the step complete.
    const cls = await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth,
      payload: { campusId, name: "8A", yearGroup: "8" },
    });
    expect(cls.statusCode).toBe(201);
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/steps/configure/complete`, headers: auth });

    // invite a teacher, then a student, then a parent; complete each step.
    for (const [role, step, email] of [
      ["teacher", "invite-teachers", "t@riverbank.edu"],
      ["student", "invite-students", "s@riverbank.edu"],
      ["parent", "invite-parents", "p@riverbank.edu"],
    ] as const) {
      const inv = await a.inject({
        method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth,
        payload: { role, email, firstName: "Sam", lastName: "Person" },
      });
      expect(inv.statusCode).toBe(201);
      await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/steps/${step}/complete`, headers: auth });
    }

    // configure-operations: set a safeguarding contact.
    const sg = await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth,
      payload: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" },
    });
    expect(sg.statusCode).toBe(201);
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/steps/configure-operations/complete`, headers: auth });

    // enter workspace — a teacher was invited, so it succeeds.
    const enter = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/enter-workspace`, headers: auth, payload: {} });
    expect(enter.json()).toMatchObject({ ok: true, workspaceEntered: true });

    ob = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/onboarding`, headers: auth })).json();
    expect(ob.workspaceEntered).toBe(true);
    expect(ob.counts).toMatchObject({ teachers: 1, students: 1, parents: 1, classes: 1 });
    await a.close();
  });

  it("entering the workspace with zero teachers warns and requires confirmation", async () => {
    const a = app();
    const { token, schoolId, campusId } = await start(a);
    const auth = { authorization: `Bearer ${token}` };

    // Complete every step EXCEPT inviting a teacher.
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    for (const step of ["configure", "invite-teachers", "invite-students", "invite-parents", "configure-operations"]) {
      await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/steps/${step}/complete`, headers: auth });
    }

    const warn = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/enter-workspace`, headers: auth, payload: {} });
    expect(warn.json()).toMatchObject({ warning: "no-teachers-invited", requiresConfirmation: true });

    const confirmed = await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/onboarding/enter-workspace`, headers: auth, payload: { confirmNoTeachers: true },
    });
    expect(confirmed.json()).toMatchObject({ ok: true });
    await a.close();
  });

  it("an existing admin can sign back in with email + password", async () => {
    const a = app();
    await start(a); // creates the admin with password123

    const login = await a.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: START.admin.email, password: START.admin.password } });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.token).toBeTruthy();
    expect(body.roles).toContain("admin");
    expect(body.schoolId).toBeTruthy();

    const bad = await a.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: START.admin.email, password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    await a.close();
  });

  it("assigns roles and edits names (FR-ADM-002), and blocks demoting the only admin", async () => {
    const a = app();
    const { token, schoolId, campusId } = await start(a);
    const auth = { authorization: `Bearer ${token}` };

    // Invite a teacher, then manage accounts.
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth,
      payload: { role: "teacher", email: "t@riverbank.edu", firstName: "Tara", lastName: "Teach" },
    });

    const accounts = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    expect(accounts.length).toBe(2); // admin + teacher
    const teacher = accounts.find((r) => r.role === "teacher")!;
    const admin = accounts.find((r) => r.role === "admin")!;

    // Change the teacher's role to principal, scoped to the campus (FR-ADM-002/007).
    const roleRes = await a.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${teacher.membershipId}/role`, headers: auth,
      payload: { role: "principal", campusId },
    });
    expect(roleRes.json()).toMatchObject({ role: "principal" });

    // Edit the teacher's name.
    const nameRes = await a.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/users/${teacher.userId}/name`, headers: auth,
      payload: { firstName: "Tanya", lastName: "Teacher" },
    });
    expect(nameRes.statusCode).toBe(200);
    const after = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    expect(after.find((r) => r.userId === teacher.userId)).toMatchObject({ firstName: "Tanya", role: "principal" });

    // Cannot demote the only admin.
    const demote = await a.inject({
      method: "PATCH", url: `/api/v1/schools/${schoolId}/memberships/${admin.membershipId}/role`, headers: auth,
      payload: { role: "teacher" },
    });
    expect(demote.statusCode).toBe(409);
    await a.close();
  });

  it("admin management endpoints: CSV import, SSO, branding logo, campus, principal", async () => {
    const a = app();
    const { token, schoolId, campusId } = await start(a);
    const auth = { authorization: `Bearer ${token}` };
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });

    // CSV import: one valid, one malformed (missing email), one formula-injection.
    const csv = ["firstName,lastName,email,role,class",
      "Ann,Ok,ann@r.edu,student,8A",
      "Bad,NoEmail,,student,8A",
      "=SUM(1),Inject,inj@r.edu,student,8A"].join("\n");
    const imp = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/import/users`, headers: auth, payload: { csv } });
    expect(imp.json()).toMatchObject({ imported: expect.any(Array), rejected: expect.any(Array), flaggedForReview: 1 });
    expect(imp.json().rejected).toHaveLength(1);

    // SSO configure + read back.
    const sso = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/sso`, headers: auth, payload: { provider: "google", domain: "school.edu" } });
    expect(sso.statusCode).toBe(201);
    expect((await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/sso`, headers: auth })).json()).toMatchObject({ provider: "google", domain: "school.edu" });

    // Branding logo: active-content SVG is rejected.
    const bad = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/branding/logo`, headers: auth, payload: { format: "svg", sizeBytes: 40, svgSource: "<svg><script>x()</script></svg>" } });
    expect(bad.statusCode).toBe(409);
    const good = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/branding/logo`, headers: auth, payload: { format: "svg", sizeBytes: 40, svgSource: "<svg><rect/></svg>" } });
    expect(good.statusCode).toBe(201);

    // Add a campus, then assign a principal to it.
    const camp = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/campuses`, headers: auth, payload: { name: "North" } });
    const northId = camp.json().id as string;
    const inv = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth, payload: { role: "teacher", email: "pr@r.edu", firstName: "Pat", lastName: "Ral" } });
    const userId = inv.json().userId as string;
    const assign = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/principals`, headers: auth, payload: { userId, campusIds: [campusId, northId] } });
    expect(assign.json()).toMatchObject({ assigned: 2 });
    await a.close();
  });

  it("an invited teacher accepts their invite, gets a session, and sees role onboarding", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const a = buildApp({}, ctx);
    const started = (await a.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START })).json();
    const auth = { authorization: `Bearer ${started.token}` };
    // Admin finishes configure so the invitee isn't in the waiting state.
    await a.inject({ method: "POST", url: `/api/v1/schools/${started.schoolId}/classes`, headers: auth, payload: { campusId: started.campusId, name: "8A" } });
    await a.inject({ method: "POST", url: `/api/v1/schools/${started.schoolId}/onboarding/steps/configure/complete`, headers: auth });
    await a.inject({ method: "POST", url: `/api/v1/schools/${started.schoolId}/invites`, headers: auth, payload: { role: "teacher", email: "newt@riverbank.edu", firstName: "Nia", lastName: "New" } });

    // Recover the invite token from the notification the invite service emitted.
    const msg = ctx.notificationChannel.delivered.find((m) => m.type === "invite.teacher")!;
    const token = (msg.context as { token: string }).token;

    const preview = await a.inject({ method: "GET", url: `/api/v1/invites/${token}` });
    expect(preview.json()).toMatchObject({ role: "teacher", status: "pending", schoolName: "Riverbank College" });

    const accepted = await a.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
    expect(accepted.statusCode).toBe(200);
    const teacherAuth = { authorization: `Bearer ${accepted.json().token}` };
    expect(accepted.json().roles).toContain("teacher");

    const ob = await a.inject({ method: "GET", url: "/api/v1/onboarding/me", headers: teacherAuth });
    expect(ob.json()).toMatchObject({ state: "ready", roles: ["teacher"] });
    expect(ob.json().steps).toContain("review-classes");
    await a.close();
  });

  it("serves admin operations: safeguarding read, school report with prorated cost, audit viewer, export/erase (ADM-8..11)", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const a = buildApp({}, ctx);
    const { token, schoolId, campusId } = await (async () => {
      const res = await a.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START });
      return res.json() as { token: string; schoolId: string; campusId: string };
    })();
    const auth = { authorization: `Bearer ${token}` };

    // ADM-8: honest unconfigured state, then the saved config reads back.
    expect((await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth })).json()).toMatchObject({ configured: false });
    await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth,
      payload: { contactName: "Sam Safe", contactRole: "DSL", slaHours: 24, afterHoursPolicy: "On-call" },
    });
    expect((await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/safeguarding`, headers: auth })).json()).toMatchObject({ configured: true, contactName: "Sam Safe" });

    // ADM-9: a licence starting mid-month produces a flagged prorated line.
    await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/licences`, headers: auth,
      payload: { seats: 100, monthlyRate: 500, startDate: "2026-01-16" },
    });
    const report = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/report?month=2026-01`, headers: auth })).json();
    expect(report.performance).toBeDefined();
    expect(report.usage).toBeDefined();
    expect(report.cost.lines).toHaveLength(1);
    expect(report.cost.lines[0].prorated).toBe(true);
    expect(report.cost.lines[0].proratedCost).toBeLessThan(500);

    // ADM-10: ids-only audit rows with the chain verified; no PII leaks.
    await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth,
      payload: { role: "teacher", email: "secret-teacher@r.edu", firstName: "Selina", lastName: "Secret" },
    });
    const audit = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/audit`, headers: auth })).json();
    expect(audit.chainVerified).toBe(true);
    expect(audit.entries.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain("secret-teacher@r.edu");
    expect(serialised).not.toContain("Selina");

    // ADM-11: export returns the student's data; erase prompts on active records,
    // then removes PII while the audit chain stays verifiable.
    await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/classes`, headers: auth, payload: { campusId, name: "8A" } });
    const inv = await a.inject({
      method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth,
      payload: { role: "student", email: "kid@r.edu", firstName: "Kim", lastName: "Kid" },
    });
    const studentId = inv.json().userId as string;
    const exported = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/students/${studentId}/export`, headers: auth })).json();
    expect(exported.personalData).toMatchObject({ firstName: "Kim" });

    // Give the student an active record so erase requires the explicit confirm.
    const accounts = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/accounts`, headers: auth })).json() as any[];
    const teacherLike = accounts.find((r) => r.role === "admin")!; // admin doubles as actor; task needs a teacher —
    // assign via the service seam with a real teacher:
    const t2 = await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: auth, payload: { role: "teacher", email: "t2@r.edu", firstName: "Tia", lastName: "Two" } });
    await ctx.studentWorkspace.assignTask(t2.json().userId, schoolId, { studentId, type: "homework", title: "Task", dueDate: "2026-09-01" });
    const prompt = (await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/students/${studentId}/erase`, headers: auth, payload: {} })).json();
    expect(prompt).toMatchObject({ erased: false, requiresConfirmation: true });
    const erased = (await a.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/students/${studentId}/erase`, headers: auth, payload: { confirm: true } })).json();
    expect(erased).toMatchObject({ erased: true });
    const after = (await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/audit`, headers: auth })).json();
    expect(after.chainVerified).toBe(true); // erasure never breaks the chain
    void teacherLike;
    await a.close();
  });

  it("serves per-user notifications and never exposes safeguarding alerts there (S-NOTIF)", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const a = buildApp({}, ctx);
    const started = (await a.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START })).json();
    const auth = { authorization: `Bearer ${started.token}` };
    const adminId = started.adminId as string;

    // One addressed to the admin, one to someone else, one safeguarding alert.
    await ctx.notifications.send({ type: "alert.teacher", to: adminId, subject: "For you", body: "Yours." });
    await ctx.notifications.send({ type: "alert.teacher", to: "someone-else", subject: "Not yours", body: "Theirs." });
    await ctx.notifications.send({ type: "alert.safeguarding", to: adminId, subject: "Safeguarding", body: "Restricted workflow content." });

    const mine = (await a.inject({ method: "GET", url: "/api/v1/notifications", headers: auth })).json() as any[];
    expect(mine.some((m) => m.subject === "For you")).toBe(true);
    expect(mine.some((m) => m.subject === "Not yours")).toBe(false);
    // Safeguarding NEVER surfaces on the generic panel, even addressed to you.
    expect(mine.some((m) => m.type === "alert.safeguarding")).toBe(false);
    await a.close();
  });

  it("rejects onboarding reads without a valid session, and across schools", async () => {
    const a = app();
    const { schoolId } = await start(a);

    const noAuth = await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/onboarding` });
    expect(noAuth.statusCode).toBe(401);

    // A second admin from a DIFFERENT school cannot read the first school's onboarding.
    const other = await a.inject({
      method: "POST", url: "/api/v1/onboarding/start",
      payload: { ...START, school: { ...START.school, name: "Other School" }, admin: { ...START.admin, email: "other@other.edu" } },
    });
    const otherToken = other.json().token as string;
    const cross = await a.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/onboarding`, headers: { authorization: `Bearer ${otherToken}` } });
    expect(cross.statusCode).toBe(401);
    await a.close();
  });
});
