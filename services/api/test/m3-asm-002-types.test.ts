import { describe, expect, it } from "vitest";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const NODE = "skill-add-fractions";

/** FR-ASM-002 — Support multiple question types. */
describe("FR-ASM-002 question types", () => {
  async function setup(opts: { numeric?: boolean; sections?: number } = {}) {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, NODE, { sections: opts.sections ?? 5, numeric: opts.numeric });
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: the draft contains exactly the requested mix of types", async () => {
    const { ctx, schoolId, teacherId } = await setup({ numeric: true });
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Mixed", nodeId: NODE, count: 5, difficulty: "mixed",
      typeMix: [{ type: "multiple_choice", count: 3 }, { type: "extended_response", count: 2 }],
    });
    if (res.status !== "generated") throw new Error("unreachable");
    const qs = await ctx.assessmentStore.listQuestionsByAssessment(res.assessmentId);
    const counts = qs.reduce<Record<string, number>>((m, q) => ((m[q.type] = (m[q.type] ?? 0) + 1), m), {});
    expect(counts).toEqual({ multiple_choice: 3, extended_response: 2 });
  });

  it("edge — unsuitable question type is flagged, not forced", async () => {
    const { ctx, schoolId, teacherId } = await setup({ numeric: false }); // prose, no numbers
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Writing", nodeId: NODE, count: 3, difficulty: "mixed",
      typeMix: [{ type: "numerical", count: 3 }],
    });
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.flags).toContain("unsuitable_type:numerical");
    // No awkward numerical question was forced.
    const qs = await ctx.assessmentStore.listQuestionsByAssessment(res.assessmentId);
    expect(qs.some((q) => q.type === "numerical")).toBe(false);
  });
});
