import { describe, expect, it } from "vitest";
import { setupPeerClass } from "./helpers";

/**
 * Milestone 5b — FR-PEER-005: Peer Test Results. Monitor completion, review
 * benchmarks, and make an explicit publish/withhold decision. Computed results
 * cannot be edited; corrections go through a separate, logged path only.
 */
describe("M5b FR-PEER-005 — peer test results", () => {
  async function closedTest(cohortSize: number, submitCount: number, scores: number[]) {
    const { ctx, clock, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: cohortSize });
    const cohort = students.slice(0, cohortSize);
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, { title: "Results test", nodeId, questionCount: 2, cohort, anonymity: "anonymous" });
    await ctx.peerTests.launch(teacherId, test.id);
    for (let i = 0; i < submitCount; i++) await ctx.peerTests.recordSubmission(test.id, cohort[i]!, scores[i]!);
    await ctx.peerTests.close(teacherId, test.id);
    return { ctx, clock, teacherId, testId: test.id, cohort };
  }

  it("happy path — full completion + benchmark, with an explicit publish decision required", async () => {
    const { ctx, teacherId, testId } = await closedTest(6, 6, [0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    const results = await ctx.peerTests.results(teacherId, testId);
    expect(results.completion).toEqual({ completed: 6, total: 6, rate: 1 });
    expect(results.benchmark.suppressed).toBe(false);
    expect(results.requiresPublishDecision).toBe(true); // nothing reaches students until decided
  });

  it("edge — partial completion: the completion rate is shown clearly", async () => {
    const { ctx, teacherId, testId } = await closedTest(10, 6, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const results = await ctx.peerTests.results(teacherId, testId);
    expect(results.completion.completed).toBe(6);
    expect(results.completion.total).toBe(10);
    expect(results.completion.rate).toBeCloseTo(0.6);
  });

  it("edge — edit attempted: no direct edit; a genuine correction goes through a separate, logged path", async () => {
    const { ctx, teacherId, testId, cohort } = await closedTest(6, 6, [0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    const student = cohort[0]!;

    // A correction must carry a reason (never a silent change).
    await expect(ctx.peerTests.recordCorrection(teacherId, testId, student, 0.55, "")).rejects.toMatchObject({ code: "REASON_REQUIRED" });

    await ctx.peerTests.recordCorrection(teacherId, testId, student, 0.55, "Re-marked Q2 after a grading error.");

    // The original submission is untouched (auditable), the correction is logged…
    const submissions = await ctx.peerStore.listSubmissions(testId);
    expect(submissions.find((s) => s.studentId === student)!.score).toBe(0.2);
    const corrections = await ctx.peerStore.listCorrections(testId);
    expect(corrections).toHaveLength(1);
    expect(ctx.audit.find((e) => e.action === "peer.result.corrected")).toHaveLength(1);
    // …and the benchmark reflects the corrected figure via that logged path.
    const benchmark = await ctx.peerTests.benchmark(teacherId, testId);
    expect(benchmark.students.find((s) => s.studentId === student)!.score).toBe(0.55);
  });

  it("edge — never published: results stay teacher-only with no auto-release, even after time passes", async () => {
    const { ctx, clock, teacherId, testId, cohort } = await closedTest(6, 6, [0.2, 0.4, 0.5, 0.6, 0.7, 0.9]);
    // Simulate a long time passing with no publish decision.
    clock.advanceMs(365 * 24 * 60 * 60 * 1000);
    const signal = await ctx.peerTests.studentSignal(testId, cohort[0]!);
    expect(signal.visible).toBe(false);
    const results = await ctx.peerTests.results(teacherId, testId);
    expect(results.publishState).toBe("withheld");
  });
});
