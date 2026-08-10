import { describe, expect, it } from "vitest";
import {
  makeApprovedContent,
  makeHarness,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";

/** FR-SKG-002 — Support NSW now; extensible to VIC / Australian Curriculum / custom. */
describe("FR-SKG-002 curriculum support", () => {
  it("happy path: a NSW school maps to NSW curriculum codes, not generic ones", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);

    const [mapping] = await ctx.mapping.mapContent(itemId, ["skill-add-fractions"]);
    const version = (await ctx.skillGraph.getVersion(mapping!.graphVersionId))!;
    expect(version.curriculum).toBe("NSW");
    // The outcome in this chain carries an NSW NESA code.
    const views = await ctx.mapping.mappingViews(itemId);
    const outcome = views[0]?.chain.find((n) => n.type === "outcome");
    expect(outcome?.code).toMatch(/^MA4-/);
  });

  it("edge — switching curriculum mid-year flags previously mapped content for re-mapping", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);
    await ctx.mapping.mapContent(itemId, ["skill-add-fractions"]);

    const flagged = await ctx.mapping.switchCurriculum(school.id, "Custom");
    expect(flagged.map((m) => m.contentItemId)).toContain(itemId);
    // Not silently inconsistent — explicitly surfaced.
    expect(await ctx.mapping.mappingsNeedingRemap(school.id)).toHaveLength(1);
  });

  it("edge — a custom curriculum with no defined outcomes makes outcome mapping pending", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await ctx.mapping.configureCurriculum(school.id, "Custom", /* customOutcomesDefined */ false);
    expect(await ctx.mapping.outcomeMappingPolicy(school.id)).toBe("pending");

    // Once the school finishes configuring its custom outcomes, it becomes required.
    await ctx.mapping.configureCurriculum(school.id, "Custom", true);
    expect(await ctx.mapping.outcomeMappingPolicy(school.id)).toBe("required");
  });
});
