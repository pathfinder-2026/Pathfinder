import { describe, expect, it } from "vitest";
import { setupPeerClass } from "./helpers";

/**
 * Milestone 5b — FR-PEER-001: teacher-facing cohort comparison signals; a
 * softened, non-ranked signal if published to students. Publish-or-withhold, not
 * edit-then-approve; withheld by default.
 */
describe("M5b FR-PEER-001 — cohort benchmarking", () => {
  async function launchedTestWithScores(scores: number[]) {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: scores.length });
    const cohort = students.slice(0, scores.length);
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, {
      title: "Fractions peer test", nodeId, questionCount: 2, cohort, anonymity: "anonymous",
    });
    await ctx.peerTests.launch(teacherId, test.id);
    for (let i = 0; i < cohort.length; i++) await ctx.peerTests.recordSubmission(test.id, cohort[i]!, scores[i]!);
    await ctx.peerTests.close(teacherId, test.id);
    return { ctx, schoolId, teacherId, testId: test.id, cohort };
  }

  it("happy path — full cohort comparison (percentile bands) for every student", async () => {
    const { ctx, teacherId, testId, cohort } = await launchedTestWithScores([0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    const benchmark = await ctx.peerTests.benchmark(teacherId, testId);

    expect(benchmark.suppressed).toBe(false);
    expect(benchmark.students).toHaveLength(cohort.length);
    expect(benchmark.students.every((s) => s.percentile >= 0 && s.percentile <= 100)).toBe(true);
    expect(benchmark.students.map((s) => s.band)).toEqual(expect.arrayContaining(["above", "below"]));
  });

  it("edge — published to students: only a softened, non-ranked signal (no rank, no raw figures, no named peers)", async () => {
    const { ctx, teacherId, testId, cohort } = await launchedTestWithScores([0.2, 0.4, 0.5, 0.6, 0.7, 0.95]);
    await ctx.peerTests.publish(teacherId, testId);

    const topStudent = cohort[5]!;
    const signal = await ctx.peerTests.studentSignal(testId, topStudent);
    expect(signal.visible).toBe(true);
    expect(signal.signal).toBe("above");
    // Softened: a band + a plain phrase, never a percentile/rank/number or a peer's name.
    expect(signal.message).toMatch(/cohort average/i);
    expect(signal.message).not.toMatch(/[0-9]/);
    expect(signal.message.toLowerCase()).not.toContain("rank");
  });

  it("edge — cannot edit results: publish/withhold don't change the computed figures (integrity)", async () => {
    const { ctx, teacherId, testId } = await launchedTestWithScores([0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    const before = await ctx.peerTests.benchmark(teacherId, testId);
    await ctx.peerTests.publish(teacherId, testId);
    await ctx.peerTests.withhold(teacherId, testId);
    const after = await ctx.peerTests.benchmark(teacherId, testId);
    // The publish/withhold decision never mutates the underlying comparison figures.
    expect(after.students.map((s) => s.score)).toEqual(before.students.map((s) => s.score));
    expect(after.students.map((s) => s.percentile)).toEqual(before.students.map((s) => s.percentile));
  });

  it("edge — small cohort: suppressed/flagged as statistically unreliable, no per-student figures", async () => {
    const { ctx, teacherId, testId } = await launchedTestWithScores([0.3, 0.6, 0.8]); // under the minimum of 5
    const benchmark = await ctx.peerTests.benchmark(teacherId, testId);
    expect(benchmark.suppressed).toBe(true);
    expect(benchmark.students).toHaveLength(0);
    expect(benchmark.suppressionReason).toMatch(/minimum|anonymity|unreliable/i);
  });

  it("edge — withheld by default: benchmarking is teacher-only and never auto-released", async () => {
    const { ctx, teacherId, testId, cohort } = await launchedTestWithScores([0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    // No publish decision made.
    const results = await ctx.peerTests.results(teacherId, testId);
    expect(results.publishState).toBe("withheld");
    expect(results.requiresPublishDecision).toBe(true);
    const signal = await ctx.peerTests.studentSignal(testId, cohort[0]!);
    expect(signal.visible).toBe(false);
  });
});
