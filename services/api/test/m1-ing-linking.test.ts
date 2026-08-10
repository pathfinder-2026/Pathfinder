import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/** FR-ING-003/004 — link lessons, questions, outcomes; outdated & orphan flags. */
describe("FR-ING-003/004 linking lessons, questions, outcomes", () => {
  function setup() {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    return { ctx, schoolId: school.id };
  }

  it("happy path: a lesson's linked questions and outcomes are all visible and navigable", () => {
    const { ctx, schoolId } = setup();
    const o1 = ctx.knowledge.createOutcome(schoolId, "MA4-1", "Computes with integers");
    const o2 = ctx.knowledge.createOutcome(schoolId, "MA4-2", "Works with fractions");
    const q1 = ctx.knowledge.createQuestion(schoolId, "Q1", [o1.id]);
    const q2 = ctx.knowledge.createQuestion(schoolId, "Q2", [o2.id]);
    const q3 = ctx.knowledge.createQuestion(schoolId, "Q3", [o1.id]);
    const lesson = ctx.knowledge.createLesson(schoolId, "Integers & Fractions", [q1.id, q2.id, q3.id], [o1.id, o2.id]);

    const view = ctx.knowledge.getLessonView(lesson.id);
    expect(view.questions).toHaveLength(3);
    expect(view.outcomes).toHaveLength(2);
    expect(view.outcomes.every((o) => !o.outdated)).toBe(true);
  });

  it("edge — a retired curriculum outcome is flagged 'outdated', not silently broken", () => {
    const { ctx, schoolId } = setup();
    const outcome = ctx.knowledge.createOutcome(schoolId, "MA4-OLD", "Retired outcome");
    const lesson = ctx.knowledge.createLesson(schoolId, "Lesson", [], [outcome.id]);
    ctx.knowledge.deprecateOutcome(outcome.id);

    const view = ctx.knowledge.getLessonView(lesson.id);
    expect(view.outcomes[0]?.outdated).toBe(true);
  });

  it("edge — an orphaned question surfaces in the 'needs linking' view", () => {
    const { ctx, schoolId } = setup();
    const outcome = ctx.knowledge.createOutcome(schoolId, "MA4-1", "Linked outcome");
    ctx.knowledge.createQuestion(schoolId, "Linked question", [outcome.id]);
    const orphan = ctx.knowledge.createQuestion(schoolId, "Orphan question", []);

    const needsLinking = ctx.knowledge.needsLinking(schoolId);
    expect(needsLinking.map((q) => q.id)).toEqual([orphan.id]);

    // Linking it resolves the orphan.
    ctx.knowledge.linkQuestionToOutcome(orphan.id, outcome.id);
    expect(ctx.knowledge.needsLinking(schoolId)).toHaveLength(0);
  });
});
