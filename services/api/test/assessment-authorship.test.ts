import { describe, expect, it } from "vitest";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";
import type { AppContext } from "../src/context";

const NODE = "skill-add-fractions";

/**
 * Task #6 — teacher authorship over assessment questions: edit and delete while
 * a draft, write-your-own from scratch. Published assessments stay immutable
 * (students never see a moving target), and authorship is recorded honestly.
 */
describe("Assessment authorship — edit, delete, write-your-own", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  async function draft(ctx: AppContext, schoolId: string, teacherId: string) {
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 3 });
    const res = await ctx.assessment.generate(schoolId, teacherId, { title: "Quiz", nodeId: NODE, count: 3, difficulty: "mixed" });
    if (res.status !== "generated") throw new Error("unreachable");
    return res.assessmentId;
  }

  it("edits a drafted question: new wording saved, recorded as teacher-edited and reviewed", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await draft(ctx, schoolId, teacherId);
    const [q] = await ctx.assessmentStore.listQuestionsByAssessment(id);

    const updated = await ctx.assessment.editQuestion(id, q!.id, teacherId, {
      prompt: "Rewritten: add 1/4 and 2/4, showing your working.",
      modelAnswer: "3/4 — add numerators over the common denominator.",
    });
    expect(updated.teacherEdited).toBe(true);
    expect(updated.reviewed).toBe(true); // editing IS reviewing
    const stored = await ctx.assessmentStore.getQuestion(q!.id);
    expect(stored!.prompt).toMatch(/Rewritten/);
    expect(ctx.audit.find((e) => e.action === "assessment.question.edited")).toHaveLength(1);
  });

  it("removes a weak question from a draft; a published assessment is immutable", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await draft(ctx, schoolId, teacherId);
    const questions = await ctx.assessmentStore.listQuestionsByAssessment(id);

    await ctx.assessment.removeQuestion(id, questions[0]!.id, teacherId);
    expect(await ctx.assessmentStore.listQuestionsByAssessment(id)).toHaveLength(questions.length - 1);

    await ctx.assessment.acknowledgeReview(id, teacherId);
    await ctx.assessment.publish(id, teacherId);
    await expect(ctx.assessment.editQuestion(id, questions[1]!.id, teacherId, { prompt: "sneaky change" }))
      .rejects.toThrow(/unpublish first/i);
    await expect(ctx.assessment.removeQuestion(id, questions[1]!.id, teacherId))
      .rejects.toThrow(/unpublish first/i);
  });

  it("only the owning teacher can edit; empty prompts are refused", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const other = await makeTeacher(ctx, schoolId, "other@springfield.edu");
    const id = await draft(ctx, schoolId, teacherId);
    const [q] = await ctx.assessmentStore.listQuestionsByAssessment(id);

    await expect(ctx.assessment.editQuestion(id, q!.id, other.user.id, { prompt: "mine now" }))
      .rejects.toThrow(/not your assessment/i);
    await expect(ctx.assessment.editQuestion(id, q!.id, teacherId, { prompt: "   " }))
      .rejects.toThrow(/needs a prompt/i);
  });

  it("write-your-own: teacher-authored questions, same review + publish gates, gradable", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const created = await ctx.assessment.createManual(schoolId, teacherId, {
      title: "Last year's fractions paper",
      nodeId: NODE,
      questions: [
        { prompt: "What is 1/2 + 1/4?", modelAnswer: "3/4" },
        { prompt: "Simplify 4/8.", modelAnswer: "1/2" },
      ],
    });
    expect(created.questionCount).toBe(2);

    const questions = await ctx.assessmentStore.listQuestionsByAssessment(created.assessmentId);
    expect(questions.every((q) => q.teacherAuthored && q.reviewed)).toBe(true);
    expect(questions.every((q) => q.groundingContentIds.length === 0)).toBe(true); // their words ARE the provenance

    // Same gates as generated drafts: ack then publish.
    await expect(ctx.assessment.publish(created.assessmentId, teacherId)).rejects.toThrow(/review/i);
    await ctx.assessment.acknowledgeReview(created.assessmentId, teacherId);
    const published = await ctx.assessment.publish(created.assessmentId, teacherId);
    expect(published.status).toBe("published");

    expect(ctx.audit.find((e) => e.action === "assessment.authored")).toHaveLength(1);
  });

  it("write-your-own refuses an empty paper or a blank question", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await expect(ctx.assessment.createManual(schoolId, teacherId, { title: "Empty", nodeId: NODE, questions: [] }))
      .rejects.toThrow(/at least one question/i);
    await expect(ctx.assessment.createManual(schoolId, teacherId, {
      title: "Blank", nodeId: NODE, questions: [{ prompt: "  " }],
    })).rejects.toThrow(/needs a prompt/i);
  });
});
