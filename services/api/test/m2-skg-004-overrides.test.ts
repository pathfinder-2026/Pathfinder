import { describe, expect, it } from "vitest";
import {
  makeApprovedContent,
  makeHarness,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";

/** FR-SKG-004 — Teacher can override any mapping. */
describe("FR-SKG-004 teacher overrides", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    setupSignedGraph(ctx, school.id);
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id, itemId };
  }

  it("happy path: an override is saved and reflected everywhere the mapping is used", async () => {
    const { ctx, teacherId, itemId } = await setup();
    const [mapping] = ctx.mapping.mapContent(itemId, ["skill-add-fractions"], { source: "ai" });

    const result = ctx.mapping.overrideMapping(mapping!.id, "skill-convert-fdp", teacherId);
    expect(result.requiresDecision).toBe(false);

    // Every read of the mapping now reflects the override.
    const views = ctx.mapping.mappingViews(itemId);
    expect(views).toHaveLength(1);
    expect(views[0]?.mapping.nodeId).toBe("skill-convert-fdp");
    expect(views[0]?.mapping.source).toBe("teacher");
    expect(views[0]?.mapping.overriddenFromNodeId).toBe("skill-add-fractions");
  });

  it("edge — overriding with existing mastery data prompts to remap history rather than discard it", async () => {
    const { ctx, teacherId, itemId } = await setup();
    const [mapping] = ctx.mapping.mapContent(itemId, ["skill-add-fractions"]);
    // Simulate historical mastery data recorded against the old mapping (future M5).
    ctx.skillGraphStore.recordMastery(itemId, "skill-add-fractions");

    const prompt = ctx.mapping.overrideMapping(mapping!.id, "skill-convert-fdp", teacherId);
    expect(prompt).toMatchObject({ requiresDecision: true, prompt: "remap-historical-data" });

    // With an explicit decision, the override proceeds.
    const done = ctx.mapping.overrideMapping(mapping!.id, "skill-convert-fdp", teacherId, { remapHistorical: true });
    expect(done.requiresDecision).toBe(false);
  });

  it("edge — a bulk override applies with a single confirmation", async () => {
    const { ctx, teacherId, itemId } = await setup();
    // Map several items to one node, then bulk-remap them all.
    const m1 = ctx.mapping.mapContent(itemId, ["skill-add-fractions"])[0]!;
    const m2 = ctx.mapping.mapContent(itemId, ["skill-solve-linear"])[0]!;

    const preview = ctx.mapping.bulkOverride([m1.id, m2.id], "skill-convert-fdp", teacherId);
    expect(preview).toEqual({ requiresConfirmation: true, count: 2 });

    const applied = ctx.mapping.bulkOverride([m1.id, m2.id], "skill-convert-fdp", teacherId, { confirm: true });
    expect(applied).toEqual({ requiresConfirmation: false, applied: 2 });
    expect(ctx.skillGraphStore.getMapping(m1.id)?.nodeId).toBe("skill-convert-fdp");
    expect(ctx.skillGraphStore.getMapping(m2.id)?.nodeId).toBe("skill-convert-fdp");
  });
});
