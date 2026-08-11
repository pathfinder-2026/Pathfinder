import { describe, expect, it } from "vitest";
import { setupPeerClass } from "./helpers";

/**
 * Milestone 5b — FR-PEER-003: Peer Test Builder (questions, rubric, cohort,
 * anonymity, accommodations). Tensions and shortfalls are surfaced, never silent.
 */
describe("M5b FR-PEER-003 — peer test builder", () => {
  it("happy path — a draft peer test is created matching the configuration", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 6, sections: 4 });
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, {
      title: "Unit 3 peer test", nodeId, questionCount: 3, rubric: "Clarity, evidence, structure.",
      cohort: students, anonymity: "anonymous",
    });

    expect(test.status).toBe("draft");
    expect(test.benchmarkPublish).toBe("withheld"); // nothing reaches students yet
    expect(test.questionCount).toBe(3);
    expect(test.cohort).toHaveLength(6);
    expect(test.warnings).toHaveLength(0);
  });

  it("edge — accommodation vs anonymity tension: the teacher is warned, not silently applied", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 3, sections: 4 });
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, {
      title: "Small anonymous test", nodeId, questionCount: 2, cohort: students, anonymity: "anonymous",
      accommodations: [{ studentId: students[0]!, kind: "extra-time-read-aloud" }],
    });
    expect(test.warnings.some((w) => w.startsWith("accommodation_anonymity_tension"))).toBe(true);
  });

  it("edge — insufficient content for scope: the teacher is told what's missing, not given a thin test silently", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 6, sections: 1 });
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, {
      title: "Over-scoped test", nodeId, questionCount: 5, cohort: students, anonymity: "anonymous",
    });
    expect(test.warnings.some((w) => w.startsWith("insufficient_content"))).toBe(true);
    // Capped to what the approved content can actually ground — not silently padded.
    expect(test.questionCount).toBe(1);
  });
});
