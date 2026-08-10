import { describe, expect, it } from "vitest";
import { makeHarness, makeUser, seedSchoolWithAdmin, VALID_YEAR } from "./helpers";

/** FR-ADM-007 — Assign the Principal role to one or more campuses. */
describe("FR-ADM-007 assign Principal to campuses", () => {
  it("happy path: a Principal assigned to two campuses gets an aggregated scope within the one school", async () => {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const second = await ctx.schools.addCampus(school.id, {
      name: "West Campus",
      academicYear: { name: "2026 West", terms: VALID_YEAR.terms },
    });
    const user = await makeUser(ctx, school.id, "principal@springfield.edu");

    await ctx.principals.assignPrincipal(user.id, [campus.id, second.campus.id]);

    const scope = await ctx.principals.getPrincipalScope(user.id);
    expect(scope.schoolId).toBe(school.id); // aggregated within this single school
    expect(scope.campuses.map((c) => c.campusId).sort()).toEqual(
      [campus.id, second.campus.id].sort(),
    );
    expect(scope.campuses.every((c) => c.status === "ready")).toBe(true);
  });

  it("edge — campus not yet configured: assignment is allowed but flagged 'campus setup incomplete'", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    // A campus added without its own academic year is still being set up.
    const incomplete = await ctx.schools.addCampus(school.id, { name: "New Campus" });
    expect(incomplete.campus.setupComplete).toBe(false);

    const user = await makeUser(ctx, school.id, "principal2@springfield.edu");
    await expect(ctx.principals.assignPrincipal(user.id, [incomplete.campus.id])).resolves.toBeDefined();

    const scope = await ctx.principals.getPrincipalScope(user.id);
    expect(scope.campuses).toHaveLength(1);
    expect(scope.campuses[0]?.status).toBe("campus setup incomplete");
  });

  it("edge — reassignment mid-term revokes access to the previous campus immediately", async () => {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const second = await ctx.schools.addCampus(school.id, {
      name: "East Campus",
      academicYear: { name: "2026 East", terms: VALID_YEAR.terms },
    });
    const user = await makeUser(ctx, school.id, "principal3@springfield.edu");

    await ctx.principals.assignPrincipal(user.id, [campus.id]);
    await ctx.principals.reassignPrincipal(user.id, campus.id, second.campus.id);

    const scope = await ctx.principals.getPrincipalScope(user.id);
    const campusIds = scope.campuses.map((c) => c.campusId);
    expect(campusIds).toContain(second.campus.id);
    expect(campusIds).not.toContain(campus.id); // previous access revoked
  });
});
