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
