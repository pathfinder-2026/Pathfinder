import { describe, expect, it } from "vitest";
import { makeHarness, seedActivityClass } from "./helpers";

/**
 * Milestone 5a — FR-TDB-001 / FR-CAP-001: mastery heatmaps, misconceptions and
 * flagged intervention/extension candidates. One test per Given/When/Then row.
 */
describe("M5a FR-TDB-001/CAP-001 — dashboard heatmap", () => {
  it("happy path — a per-student, per-skill heatmap with intervention/extension flags", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);

    const heatmap = await ctx.dashboard.heatmap(schoolId, classId);

    expect(heatmap.enoughData).toBe(true);
    expect(heatmap.students).toHaveLength(25);
    expect(heatmap.skills.length).toBeGreaterThanOrEqual(3);
    // A cell for (roughly) each student × skill.
    expect(heatmap.cells.length).toBeGreaterThan(25);
    // Both ends of the class are flagged: someone needs help, someone needs challenge.
    expect(heatmap.flags.some((f) => f.kind === "intervention")).toBe(true);
    expect(heatmap.flags.some((f) => f.kind === "extension")).toBe(true);
    expect(summary.focusNodeId).toBeTruthy();
  });

  it("edge — insufficient data: a brand-new class shows a clear 'not enough data yet' state", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId } = await seedActivityClass(ctx);
    // A second, brand-new class in the same school with no completed work.
    const campuses = await ctx.store.listCampusesBySchool(schoolId);
    const fresh = await ctx.schools.createClass(schoolId, campuses[0]!.id, "8B");
    expect(fresh.id).not.toBe(classId);

    const heatmap = await ctx.dashboard.heatmap(schoolId, fresh.id);

    expect(heatmap.enoughData).toBe(false);
    expect(heatmap.cells).toHaveLength(0);
    // Not a blank/misleading grid — no fabricated cells, an explicit empty state.
  });

  it("edge — inconsistent performance: the heatmap reflects the TREND, not only the latest point", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);

    const heatmap = await ctx.dashboard.heatmap(schoolId, classId);
    const cell = heatmap.cells.find(
      (c) => c.studentId === summary.fluctuatingStudentId && c.nodeId === summary.focusNodeId,
    );

    expect(cell).toBeDefined();
    // The student declined across assessments (0.85 → 0.6 → 0.35): a down trend,
    // surfaced even though the latest single point alone would understate it.
    expect(cell!.trend).toBe("down");
  });
});
