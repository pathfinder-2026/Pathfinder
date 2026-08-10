import { describe, expect, it } from "vitest";
import { makeHarness, makeTeacher, seedActivityClass } from "./helpers";

/**
 * Milestone 5a — FR-COH-001 / FR-COH-002: suggested groups (support,
 * misconception, extension, review, peer-learning), all editable before the
 * Teacher assigns work.
 */
describe("M5a FR-COH-001/002 — cohorts", () => {
  it("happy path — students sharing a misconception are suggested as an editable group", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);

    const groups = await ctx.cohorts.suggestGroups(schoolId, classId);
    const misconception = groups.find((g) => g.type === "misconception" && g.nodeId === summary.misconceptionNodeId);

    expect(misconception).toBeDefined();
    expect([...misconception!.studentIds].sort()).toEqual([...summary.misconceptionStudentIds].sort());
    expect(misconception!.studentIds).toHaveLength(5);
  });

  it("edge — a student who fits multiple groups is shown in both, not forced into one", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);

    const groups = await ctx.cohorts.suggestGroups(schoolId, classId);
    const inExtension = groups.some((g) => g.type === "extension" && g.studentIds.includes(summary.multiGroupStudentId));
    const inPeerLearning = groups.some((g) => g.type === "peer-learning" && g.studentIds.includes(summary.multiGroupStudentId));

    expect(inExtension).toBe(true);
    expect(inPeerLearning).toBe(true);
  });

  it("edge — a student removed before assigning does not receive the work", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu");

    const groups = await ctx.cohorts.suggestGroups(schoolId, classId);
    const group = groups.find((g) => g.type === "misconception")!;
    const removed = group.studentIds[0]!;
    const remaining = group.studentIds.filter((id) => id !== removed);

    const assignment = await ctx.cohorts.assignWork(teacher.user.id, schoolId, classId, {
      type: group.type, nodeId: group.nodeId, studentIds: remaining,
    });

    expect(assignment.studentIds).not.toContain(removed);
    expect(assignment.studentIds).toHaveLength(4);
    // Persisted as it was assigned.
    const stored = await ctx.dashboardStore.getAssignment(assignment.id);
    expect(stored!.studentIds).toEqual(remaining);
    expect(ctx.audit.find((e) => e.action === "cohort.work.assigned")).toHaveLength(1);
  });

  it("edge — a group built from stale data is labelled as based on older data", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId } = await seedActivityClass(ctx);

    const groups = await ctx.cohorts.suggestGroups(schoolId, classId);
    const stale = groups.find((g) => g.basis === "stale");

    expect(stale).toBeDefined();
    expect(stale!.staleNote).toMatch(/older data|staleness/i);
  });
});
