import { describe, expect, it } from "vitest";
import { seedMastery, setupParentSchool } from "./helpers";

/**
 * Milestone 8 — FR-PAR-001 / FR-PAR-005: plain-language progress summaries.
 * The fixed clock is at 2026-01-01; "recent" = within the last 30 days.
 */
describe("M8 FR-PAR-001/005 — parent dashboard", () => {
  const RECENT = "2025-12-20T00:00:00.000Z";
  const OLD = "2025-10-01T00:00:00.000Z";

  async function verified() {
    const s = await setupParentSchool();
    const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "mother" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    return s;
  }

  it("happy path — a plain-language summary of strengths, focus areas and recent activity", async () => {
    const s = await verified();
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.9, RECENT); // strength
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.integersNode.id, 0.2, RECENT);  // focus area
    await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, { studentId: s.studentId, type: "homework", title: "Worksheet", dueDate: RECENT })
      .then((t) => s.ctx.studentWorkspace.completeTask(s.studentId, t.id));

    const summary = await s.ctx.parents.dashboardFor(s.parentId, s.studentId);
    expect(summary.hasRecentActivity).toBe(true);
    expect(summary.childName).toBe("Ada");
    expect(summary.strengths.length).toBeGreaterThan(0);
    expect(summary.focusAreas.length).toBeGreaterThan(0);
    expect(summary.summaryText.toLowerCase()).toContain("ada");
  });

  it("edge — no recent activity: states this plainly rather than showing stale data", async () => {
    const s = await verified();
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.9, OLD); // older than the reporting window

    const summary = await s.ctx.parents.dashboardFor(s.parentId, s.studentId);
    expect(summary.hasRecentActivity).toBe(false);
    expect(summary.strengths).toHaveLength(0);
    expect(summary.summaryText).toMatch(/no new activity/i);
  });

  it("edge — technical jargon is translated to plain language, not raw internal labels", async () => {
    const s = await verified();
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.9, RECENT);

    const summary = await s.ctx.parents.dashboardFor(s.parentId, s.studentId);
    // Uses a plain topic word, never the raw node id or an internal code.
    expect(summary.summaryText).not.toContain(s.fractionsNode.id);
    expect(summary.summaryText).not.toMatch(/\bMA4\b|[A-Z]{2,}\d/);
    expect(summary.strengths.join(" ")).not.toContain(s.fractionsNode.id);
  });
});
