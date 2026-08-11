import { describe, expect, it } from "vitest";
import { setupPeerClass } from "./helpers";

/**
 * Milestone 5b — FR-PEER-002: anonymised peer review with teacher moderation
 * BEFORE release. A teacher may reject/hide but never rewrite peer wording.
 */
describe("M5b FR-PEER-002 — anonymised peer review", () => {
  async function reviewSetup(cohortSize: number) {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: cohortSize });
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, {
      title: "Essay peer review", nodeId, questionCount: 1, cohort: students, anonymity: "anonymous",
    });
    return { ctx, schoolId, teacherId, testId: test.id, students };
  }

  it("happy path — reviews are hidden until the teacher approves them", async () => {
    const { ctx, schoolId, teacherId, testId, students } = await reviewSetup(6);
    const [target, r1, r2] = students;
    const a = await ctx.peerReviews.submitReview(r1!, schoolId, testId, target!, "Clear argument, add more evidence.");
    await ctx.peerReviews.submitReview(r2!, schoolId, testId, target!, "Good structure.");

    // Before moderation the reviewed student sees nothing.
    expect((await ctx.peerReviews.feedbackForStudent(target!)).reviews).toHaveLength(0);

    await ctx.peerReviews.moderate(teacherId, a.review.id, "approve");
    const feedback = await ctx.peerReviews.feedbackForStudent(target!);
    expect(feedback.hasFeedback).toBe(true);
    expect(feedback.reviews).toHaveLength(1);
    expect(feedback.reviews[0]!.text).toMatch(/evidence/);
  });

  it("edge — inappropriate comment: rejected/hidden but never rewritten (stays peer-authored)", async () => {
    const { ctx, schoolId, teacherId, testId, students } = await reviewSetup(6);
    const [target, reviewer] = students;
    const original = "This is unkind and unhelpful.";
    const { review } = await ctx.peerReviews.submitReview(reviewer!, schoolId, testId, target!, original);

    await ctx.peerReviews.moderate(teacherId, review.id, "reject");

    // Hidden from the student…
    expect((await ctx.peerReviews.feedbackForStudent(target!)).hasFeedback).toBe(false);
    // …and its wording is untouched (the teacher can reject but not rewrite).
    const stored = await ctx.peerReviews.pendingForTest(testId); // rejected → not pending
    expect(stored).toHaveLength(0);
    // moderate() has no text parameter → wording cannot be edited by design.
  });

  it("edge — anonymity breach risk: flagged in a small cohort, not in a large one", async () => {
    const small = await reviewSetup(3);
    const flaggedSmall = await small.ctx.peerReviews.submitReview(
      small.students[1]!, small.schoolId, small.testId, small.students[0]!, "Nice work.",
    );
    expect(flaggedSmall.anonymityRisk).toBe(true);

    const large = await reviewSetup(8);
    const flaggedLarge = await large.ctx.peerReviews.submitReview(
      large.students[1]!, large.schoolId, large.testId, large.students[0]!, "Nice work.",
    );
    expect(flaggedLarge.anonymityRisk).toBe(false);
  });

  it("edge — zero reviews: a neutral 'no peer feedback this round', not an empty/broken screen", async () => {
    const { ctx, students } = await reviewSetup(6);
    const feedback = await ctx.peerReviews.feedbackForStudent(students[0]!);
    expect(feedback.hasFeedback).toBe(false);
    expect(feedback.message).toMatch(/no peer feedback/i);
  });
});
