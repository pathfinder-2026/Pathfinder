import { describe, expect, it } from "vitest";
import {
  makeHarness,
  makeMappedContent,
  makeStudents,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";

const NODE = "skill-add-fractions";

/**
 * Real grading on attempt submission: every answered question is graded
 * against its model answer/rubric through the AI service layer, the result is
 * recorded on the attempt (teacher-reviewable at any time), and ONE real
 * (non-synthetic) mastery data point is written per submission — the signal
 * Class Insights (heatmap / focus areas / cohorts / adaptive) reads. Before
 * this, no real submission ever produced mastery data at all.
 */
describe("AssessmentService.submitAttempt grading", () => {
  async function setup() {
    const { ctx, clock } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, NODE, { sections: 5 });
    const [studentId] = await makeStudents(ctx, school.id, 1);
    const generated = await ctx.assessment.generate(school.id, teacher.user.id, {
      title: "Fractions check", nodeId: NODE, count: 2, difficulty: "mixed",
    });
    if (generated.status !== "generated") throw new Error("expected generated");
    await ctx.assessment.acknowledgeReview(generated.assessmentId, teacher.user.id);
    await ctx.assessment.publish(generated.assessmentId, teacher.user.id);
    const questions = await ctx.assessmentStore.listQuestionsByAssessment(generated.assessmentId);
    return { ctx, clock, schoolId: school.id, studentId: studentId!, assessmentId: generated.assessmentId, questions };
  }

  it("grades answered questions on submit and records a real mastery data point", async () => {
    const { ctx, schoolId, studentId, assessmentId, questions } = await setup();
    const attempt = await ctx.assessment.startAttempt(assessmentId, studentId);
    // Answer with each question's own model answer — should grade high.
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.modelAnswer ?? ""]));
    const submitted = await ctx.assessment.submitAttempt(attempt.id, studentId, answers);

    expect(submitted.status).toBe("submitted");
    expect(submitted.gradedScore).not.toBeNull();
    expect(submitted.gradedScore!).toBeGreaterThan(0.67);
    expect(submitted.gradedResults).toHaveLength(questions.length);
    expect(submitted.gradedAt).not.toBeNull();

    const mastery = await ctx.activityStore.listMasteryByNode(schoolId, NODE);
    const record = mastery.find((m) => m.studentId === studentId);
    expect(record).toBeDefined();
    expect(record!.synthetic).toBe(false); // REAL data — survives realMastery() filtering
    expect(record!.score).toBeCloseTo(submitted.gradedScore!, 5);
    expect(record!.dataPoints).toBe(1);
  });

  it("wrong answers grade low and land a low mastery level", async () => {
    const { ctx, schoolId, studentId, assessmentId, questions } = await setup();
    const attempt = await ctx.assessment.startAttempt(assessmentId, studentId);
    const answers = Object.fromEntries(questions.map((q) => [q.id, "zzz nonsense unrelated"]));
    const submitted = await ctx.assessment.submitAttempt(attempt.id, studentId, answers);

    expect(submitted.gradedScore).not.toBeNull();
    expect(submitted.gradedScore!).toBeLessThan(0.34);
    const record = (await ctx.activityStore.listMasteryByNode(schoolId, NODE)).find((m) => m.studentId === studentId);
    expect(record!.level).toBe("low");
  });

  it("an empty submission is NOT graded and writes no mastery record", async () => {
    const { ctx, schoolId, studentId, assessmentId } = await setup();
    const attempt = await ctx.assessment.startAttempt(assessmentId, studentId);
    const submitted = await ctx.assessment.submitAttempt(attempt.id, studentId, {});

    expect(submitted.status).toBe("submitted"); // submit itself always succeeds
    expect(submitted.gradedScore).toBeNull();
    expect((await ctx.activityStore.listMasteryByNode(schoolId, NODE)).filter((m) => m.studentId === studentId)).toHaveLength(0);
  });

  it("a second submission UPDATES the same mastery record (history kept), never duplicates it", async () => {
    const { ctx, schoolId, studentId, assessmentId, questions } = await setup();
    const first = await ctx.assessment.startAttempt(assessmentId, studentId);
    await ctx.assessment.submitAttempt(first.id, studentId, Object.fromEntries(questions.map((q) => [q.id, "zzz nonsense"])));
    const second = await ctx.assessment.startAttempt(assessmentId, studentId);
    await ctx.assessment.submitAttempt(second.id, studentId, Object.fromEntries(questions.map((q) => [q.id, q.modelAnswer ?? ""])));

    const records = (await ctx.activityStore.listMasteryByNode(schoolId, NODE)).filter((m) => m.studentId === studentId);
    expect(records).toHaveLength(1); // updated in place, not duplicated
    expect(records[0]!.dataPoints).toBe(2);
    expect(records[0]!.history).toHaveLength(1); // the prior (low) score preserved as trend
    expect(records[0]!.score).toBeGreaterThan(records[0]!.history![0]!);
  });

  it("grading is teacher-visible via listAttempts and absent from every student-facing surface", async () => {
    const { ctx, studentId, assessmentId, questions } = await setup();
    const attempt = await ctx.assessment.startAttempt(assessmentId, studentId);
    await ctx.assessment.submitAttempt(attempt.id, studentId, Object.fromEntries(questions.map((q) => [q.id, q.modelAnswer ?? ""])));

    const attempts = await ctx.assessment.listAttempts(assessmentId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.gradedScore).not.toBeNull();

    // The student resume surface exposes answers only — never grading.
    const resume = await ctx.assessment.resume(attempt.id);
    expect(JSON.stringify(resume)).not.toMatch(/graded/i);
  });
});
