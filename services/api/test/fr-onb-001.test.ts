import { describe, expect, it } from "vitest";
import type { Membership, Role } from "../src/domain/types";
import { newId } from "../src/platform/ids";
import { makeHarness, makeUser, seedSchoolWithAdmin } from "./helpers";
import type { AppContext } from "../src/context";

async function addMembership(ctx: AppContext, userId: string, schoolId: string, role: Role): Promise<void> {
  const membership: Membership = {
    id: newId(),
    userId,
    schoolId,
    role,
    campusId: null,
    classId: null,
  };
  await ctx.store.insertMembership(membership);
}

/** Mark the school configured so invited personas are past the waiting state. */
async function finishSchoolConfig(ctx: AppContext, schoolId: string): Promise<void> {
  await ctx.onboarding.completeStep(schoolId, "create");
  await ctx.onboarding.completeStep(schoolId, "configure");
}

/** FR-ONB-001 — Role-appropriate guided onboarding for every persona. */
describe("FR-ONB-001 role-appropriate onboarding", () => {
  it("happy path: a newly invited Teacher sees a Teacher-specific flow, not the Admin flow", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await finishSchoolConfig(ctx, school.id);

    const teacher = await makeUser(ctx, school.id, "teacher@springfield.edu");
    await addMembership(ctx, teacher.id, school.id, "teacher");

    const flow = await ctx.onboarding.getUserOnboarding(teacher.id);
    expect(flow.state).toBe("ready");
    if (flow.state !== "ready") throw new Error("unreachable");
    expect(flow.roles).toEqual(["teacher"]);
    expect(flow.steps).toContain("review-classes");
    // Not the Admin flow.
    expect(flow.steps).not.toContain("invite-teachers");
  });

  it("edge — dual role: onboarding covers both roles without duplicating shared steps", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await finishSchoolConfig(ctx, school.id);

    const user = await makeUser(ctx, school.id, "dual@springfield.edu");
    await addMembership(ctx, user.id, school.id, "teacher");
    await addMembership(ctx, user.id, school.id, "principal");

    const flow = await ctx.onboarding.getUserOnboarding(user.id);
    if (flow.state !== "ready") throw new Error("expected ready state");
    // Shared "profile" step appears exactly once.
    expect(flow.steps.filter((s) => s === "profile")).toHaveLength(1);
    // Both roles' distinctive steps are present.
    expect(flow.steps).toEqual(
      expect.arrayContaining(["review-classes", "workspace-tour", "select-campuses", "dashboard-tour"]),
    );
  });

  it("edge — invite accepted early: shows a 'waiting on school setup' state, not an error", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    // NB: school configuration is deliberately NOT finished here.

    const teacher = await makeUser(ctx, school.id, "early@springfield.edu");
    await addMembership(ctx, teacher.id, school.id, "teacher");

    const flow = await ctx.onboarding.getUserOnboarding(teacher.id);
    expect(flow.state).toBe("waiting_on_school_setup");
  });
});
