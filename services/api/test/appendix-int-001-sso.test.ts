import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";
import { LocalIdentityProvider } from "../src/ports/identityProviderPort";
import type { AppContext } from "../src/context";

/**
 * Appendix Milestone A — FR-INT-001: sign-in via Google/Microsoft SSO. One test
 * per Given/When/Then: happy path, IdP outage, and access revoked upstream.
 */

/** A school with SSO configured for school.edu and a Teacher account in that domain. */
async function ssoSchool(ctx: AppContext) {
  const { school } = await seedSchoolWithAdmin(ctx, `SSO School ${Math.random().toString(36).slice(2, 8)}`);
  const admin = (await ctx.store.listMembershipsBySchool(school.id)).find((m) => m.role === "admin")!;
  await ctx.sso.configure(school.id, { provider: "google", domain: "school.edu" }, admin.userId);
  const teacher = await ctx.accounts.createAccount({
    schoolId: school.id, role: "teacher", email: "tara@school.edu", firstName: "Tara", lastName: "Teach",
  });
  return { schoolId: school.id, teacherId: teacher.user.id, teacherEmail: "tara@school.edu" };
}

describe("FR-INT-001 — SSO sign-in", () => {
  it("happy path: a Teacher signs in with Google and is authenticated with no password created", async () => {
    const { ctx } = makeHarness();
    const { schoolId, teacherId, teacherEmail } = await ssoSchool(ctx);

    const { token, userId } = await ctx.sso.signIn(schoolId, "google", { email: teacherEmail });
    expect(userId).toBe(teacherId);

    // A real session that authorizes to the Teacher's dashboard role.
    const authz = await ctx.auth.authorize(token);
    expect(authz.roles).toContain("teacher");

    // No password was ever created for this user.
    expect(await ctx.store.getCredential(teacherId)).toBeUndefined();
  });

  it("IdP outage: a clear service-unavailable error is surfaced, not a generic login failure", async () => {
    const { ctx } = makeHarness();
    const { schoolId, teacherEmail } = await ssoSchool(ctx);

    (ctx.idp as LocalIdentityProvider).setOutage("google", true);

    const err = await ctx.sso.signIn(schoolId, "google", { email: teacherEmail }).catch((e) => e);
    expect(err.code).toBe("SSO_IDP_UNAVAILABLE");
    expect(err.code).not.toBe("AUTH"); // distinctly NOT "invalid credentials"
    expect(err.message).toMatch(/unavailable/i);
  });

  it("access revoked upstream: sign-in is denied AND any stale cached session stops working", async () => {
    const { ctx } = makeHarness();
    const { schoolId, teacherId, teacherEmail } = await ssoSchool(ctx);

    // The user signs in earlier and holds a valid session.
    const { token } = await ctx.sso.signIn(schoolId, "google", { email: teacherEmail });
    expect((await ctx.auth.authorize(token)).user.id).toBe(teacherId);

    // Their upstream Google Workspace account is suspended by the organisation.
    (ctx.idp as LocalIdentityProvider).suspend(teacherEmail);

    // A fresh sign-in is denied.
    const err = await ctx.sso.signIn(schoolId, "google", { email: teacherEmail }).catch((e) => e);
    expect(err.code).toBe("SSO_ACCESS_REVOKED");

    // And the previously-cached session is no longer honoured.
    await expect(ctx.auth.authorize(token)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("sign-in is refused when SSO is not configured for the school", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx, `NoSSO ${Math.random().toString(36).slice(2, 8)}`);
    const err = await ctx.sso.signIn(school.id, "google", { email: "x@school.edu" }).catch((e) => e);
    expect(err.code).toBe("SSO_NOT_CONFIGURED");
  });
});
