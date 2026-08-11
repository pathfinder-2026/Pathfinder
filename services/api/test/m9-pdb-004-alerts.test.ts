import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { setupPrincipalSchool } from "./helpers";

/** Milestone 9 — FR-PDB-004: anomaly alerts with thresholds; no alert fatigue. */
describe("M9 FR-PDB-004 — alerts", () => {
  // A mastery record whose history shows the class's earlier level, vs the current score.
  async function masteryWithHistory(p: Awaited<ReturnType<typeof setupPrincipalSchool>>, studentId: string, baseline: number, current: number) {
    await p.ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId: p.schoolId, nodeId: p.nodeId, level: current >= 0.67 ? "secure" : "low",
      score: current, dataPoints: 6, lastActivityAt: "2025-12-29T00:00:00.000Z", history: [baseline], synthetic: false,
    });
  }

  it("happy path — a sharp weekly mastery drop raises an alert", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const s = await p.enrol(klass.id, "S");
    await masteryWithHistory(p, s, 0.85, 0.4); // drop of 0.45

    const alerts = await p.ctx.principalDashboard.detectAlerts(p.principalId, p.schoolId);
    expect(alerts.some((a) => a.classId === klass.id && a.kind === "mastery_drop")).toBe(true);
  });

  it("edge — an expected seasonal dip during a break window is not flagged", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const s = await p.enrol(klass.id, "S");
    await masteryWithHistory(p, s, 0.85, 0.4);

    // The fixed clock (2026-01-01) falls inside this configured school break.
    const alerts = await p.ctx.principalDashboard.detectAlerts(p.principalId, p.schoolId, {
      breakWindow: { start: "2025-12-20T00:00:00.000Z", end: "2026-01-10T00:00:00.000Z" },
    });
    expect(alerts).toHaveLength(0);
  });

  it("edge — minor fluctuations below the threshold do not raise alerts (no fatigue)", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const s = await p.enrol(klass.id, "S");
    await masteryWithHistory(p, s, 0.7, 0.66); // drop of only 0.04

    const alerts = await p.ctx.principalDashboard.detectAlerts(p.principalId, p.schoolId);
    expect(alerts).toHaveLength(0);
  });
});
