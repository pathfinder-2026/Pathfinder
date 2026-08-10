import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";
import type { AppContext } from "../src/context";

const PRE_WORKSPACE_STEPS = [
  "create",
  "configure",
  "invite-teachers",
  "invite-students",
  "invite-parents",
  "configure-operations",
] as const;

async function completeThrough(ctx: AppContext, schoolId: string, upto: number): Promise<void> {
  for (let i = 0; i <= upto; i++) {
    await ctx.onboarding.completeStep(schoolId, PRE_WORKSPACE_STEPS[i]!);
  }
}

/** FR-ONB-002 — Preserve the 7-step School-Admin onboarding flow. */
describe("FR-ONB-002 seven-step Admin onboarding", () => {
  it("happy path: proceeding through all steps in order lands the Admin in the live workspace", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    // A Teacher is actually invited during the invite step (avoids the warning).
    await ctx.invites.inviteTeacher(school.id, {
      email: "t@springfield.edu",
      firstName: "Tom",
      lastName: "Teach",
    });
    await completeThrough(ctx, school.id, 5); // create..configure-operations

    const result = await ctx.onboarding.enterWorkspace(school.id);
    expect(result).toEqual({ ok: true, workspaceEntered: true });
    expect(await ctx.onboarding.currentStep(school.id)).toBe("enter-workspace");
  });

  it("edge — skipping a step: jumping to Enter Workspace is blocked and returns to the first incomplete step", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await completeThrough(ctx, school.id, 1); // only create + configure

    const nav = await ctx.onboarding.goToStep(school.id, "enter-workspace");
    expect(nav).toEqual({ blocked: true, redirectTo: "invite-teachers" });
  });

  it("edge — resume later: resumes at the first incomplete step, not step one", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await completeThrough(ctx, school.id, 3); // create..invite-students

    expect(await ctx.onboarding.currentStep(school.id)).toBe("invite-parents");
  });

  it("edge — zero teachers invited: warns and requires confirmation before finishing", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await completeThrough(ctx, school.id, 5); // steps complete, but NO teacher invited

    const warned = await ctx.onboarding.enterWorkspace(school.id);
    expect(warned).toEqual({
      ok: false,
      warning: "no-teachers-invited",
      requiresConfirmation: true,
    });

    const confirmed = await ctx.onboarding.enterWorkspace(school.id, { confirmNoTeachers: true });
    expect(confirmed).toEqual({ ok: true, workspaceEntered: true });
  });
});
