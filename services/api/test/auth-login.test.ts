import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { seedSchoolWithAdmin } from "./helpers";

/**
 * Definition of done — create a school, invite a Teacher (through the
 * notification service), accept, and log in as that Teacher. Covered at the
 * service level and end-to-end over HTTP.
 */
describe("Milestone 0 DoD — log in as the invited Teacher", () => {
  it("service level: invite -> accept -> login -> authorize", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const { school } = seedSchoolWithAdmin(ctx);

    const invite = await ctx.invites.inviteTeacher(school.id, {
      email: "teacher@springfield.edu",
      firstName: "Tara",
      lastName: "Teach",
    });
    ctx.auth.acceptInvite(invite.invite.token, "password123");
    const login = ctx.auth.login("teacher@springfield.edu", "password123");
    const authz = ctx.auth.authorize(login.token);

    expect(authz.user.id).toBe(invite.user.id);
    expect(authz.roles).toContain("teacher");
  });

  it("end-to-end over HTTP", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const app = buildApp({}, ctx);

    const createRes = await app.inject({
      method: "POST",
      url: "/schools",
      payload: {
        name: "HTTP High",
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const schoolId = createRes.json().school.id as string;

    const inviteRes = await app.inject({
      method: "POST",
      url: `/schools/${schoolId}/invites/teacher`,
      payload: { email: "httpteacher@springfield.edu", firstName: "Huey", lastName: "Teach" },
    });
    expect(inviteRes.statusCode).toBe(201);
    const token = inviteRes.json().token as string;

    const acceptRes = await app.inject({
      method: "POST",
      url: "/invites/accept",
      payload: { token, password: "password123" },
    });
    expect(acceptRes.statusCode).toBe(200);

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "httpteacher@springfield.edu", password: "password123" },
    });
    expect(loginRes.statusCode).toBe(200);
    const sessionToken = loginRes.json().token as string;

    const meRes = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().roles).toContain("teacher");

    await app.close();
  });

  it("rejects login with a wrong password", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const { school } = seedSchoolWithAdmin(ctx);
    const invite = await ctx.invites.inviteTeacher(school.id, {
      email: "wrongpw@springfield.edu",
      firstName: "Wanda",
      lastName: "Wrong",
    });
    ctx.auth.acceptInvite(invite.invite.token, "password123");
    expect(() => ctx.auth.login("wrongpw@springfield.edu", "nope")).toThrow();
  });
});
