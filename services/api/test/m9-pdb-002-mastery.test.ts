import { describe, expect, it } from "vitest";
import { seedMastery, setupPrincipalSchool } from "./helpers";

/** Milestone 9 — FR-PDB-002: whole-school mastery / risk, with outlier classes. */
describe("M9 FR-PDB-002 — school-wide mastery", () => {
  const WHEN = "2025-12-20T00:00:00.000Z";

  it("happy path — school-wide mastery patterns are visible, not just class-by-class", async () => {
    const p = await setupPrincipalSchool();
    const classA = await p.makeClass("8A");
    const classB = await p.makeClass("8B");
    const a1 = await p.enrol(classA.id, "Ann");
    const b1 = await p.enrol(classB.id, "Bob");
    await seedMastery(p.ctx, p.schoolId, a1, p.nodeId, 0.8, WHEN);
    await seedMastery(p.ctx, p.schoolId, b1, p.nodeId, 0.7, WHEN);

    const overview = await p.ctx.principalDashboard.masteryOverview(p.principalId, p.schoolId);
    expect(overview.classes.length).toBe(2);
    expect(overview.schoolWide.classCount).toBe(2);
    expect(overview.schoolWide.avgScore).toBeGreaterThan(0);
  });

  it("edge — an outlier class is highlighted rather than hidden inside a smoothed average", async () => {
    const p = await setupPrincipalSchool();
    const good1 = await p.makeClass("8A");
    const good2 = await p.makeClass("8B");
    const poor = await p.makeClass("8C");
    for (const [c, score] of [[good1, 0.85], [good2, 0.8], [poor, 0.2]] as const) {
      const s = await p.enrol(c.id, "S");
      await seedMastery(p.ctx, p.schoolId, s, p.nodeId, score, WHEN);
    }
    const overview = await p.ctx.principalDashboard.masteryOverview(p.principalId, p.schoolId);
    const poorSummary = overview.classes.find((c) => c.classId === poor.id)!;
    expect(poorSummary.outlier).toBe(true);
    expect(overview.classes.find((c) => c.classId === good1.id)!.outlier).toBe(false);
  });
});
