import { describe, expect, it } from "vitest";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const NODE = "skill-add-fractions";

/** FR-ASM-003 — Generate rubrics, model answers, balanced difficulty, multiple versions. */
describe("FR-ASM-003 rubrics, model answers, versions", () => {
  async function setup(opts: { difficulty?: string; sections?: number } = {}) {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, NODE, {
      sections: opts.sections ?? 3, difficulty: opts.difficulty ?? "developing",
    });
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: an extended-response question gets a matching rubric and model answer", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "ER", nodeId: NODE, count: 1, difficulty: "mixed",
      typeMix: [{ type: "extended_response", count: 1 }],
    });
    if (res.status !== "generated") throw new Error("unreachable");
    const [q] = await ctx.assessmentStore.listQuestionsByAssessment(res.assessmentId);
    expect(q?.rubric).toBeTruthy();
    expect(q?.modelAnswer).toBeTruthy();
  });

  it("edge — multiple versions test the same outcomes at matched difficulty, different wording", async () => {
    const { ctx, schoolId, teacherId } = await setup({ sections: 3 });
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Two rooms", nodeId: NODE, count: 3, difficulty: "mixed", versions: 2,
    });
    if (res.status !== "generated") throw new Error("unreachable");
    const versions = await ctx.assessmentStore.listVersionsByAssessment(res.assessmentId);
    expect(versions).toHaveLength(2);

    const qa = await ctx.assessmentStore.listQuestionsByVersion(versions[0]!.id);
    const qb = await ctx.assessmentStore.listQuestionsByVersion(versions[1]!.id);
    expect(qa).toHaveLength(3);
    expect(qb).toHaveLength(3);
    // Same content grounding + difficulty, different wording.
    expect(qa[0]?.groundingContentIds).toEqual(qb[0]?.groundingContentIds);
    expect(qa[0]?.difficulty).toBe(qb[0]?.difficulty);
    expect(qa[0]?.prompt).not.toBe(qb[0]?.prompt);
  });

  it("edge — imbalanced difficulty: generates what it can and flags it couldn't be met", async () => {
    const { ctx, schoolId, teacherId } = await setup({ difficulty: "developing" }); // easy-ish content
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "All hard", nodeId: NODE, count: 3, difficulty: "hard",
    });
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.flags).toContain("difficulty_balance_unmet");
    expect(res.questionCount).toBeGreaterThan(0); // still generated what it could
  });
});
