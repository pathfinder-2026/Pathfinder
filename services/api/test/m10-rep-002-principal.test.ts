import { describe, expect, it } from "vitest";
import { seedMastery, setupPrincipalSchool } from "./helpers";

/** Milestone 10 — FR-REP-002: whole-school reports (school-level only) + prorated cost. */
describe("M10 FR-REP-002 — school report", () => {
  const WHEN = "2025-12-20T00:00:00.000Z";

  it("happy path — a whole-school report aggregates all classes within this single school", async () => {
    const p = await setupPrincipalSchool();
    const a = await p.makeClass("8A");
    const b = await p.makeClass("8B");
    await seedMastery(p.ctx, p.schoolId, await p.enrol(a.id, "A"), p.nodeId, 0.8, WHEN);
    await seedMastery(p.ctx, p.schoolId, await p.enrol(b.id, "B"), p.nodeId, 0.6, WHEN);
    await p.ctx.reporting.addLicence(p.adminId, p.schoolId, { seats: 100, monthlyRate: 1000, startDate: "2026-01-01" });

    const report = await p.ctx.reporting.schoolReport(p.principalId, p.schoolId, "2026-01");
    expect(report.performance.classCount).toBe(2);
    expect(report.performance.avgScore).toBeGreaterThan(0);
    expect(report.cost.total).toBeGreaterThan(0);
  });

  it("edge — a licence added mid-month is prorated, not charged a flat full-month cost", async () => {
    const p = await setupPrincipalSchool();
    // Added on the 16th of a 31-day month => 16 active days.
    await p.ctx.reporting.addLicence(p.adminId, p.schoolId, { seats: 50, monthlyRate: 3100, startDate: "2026-01-16" });

    const cost = await p.ctx.reporting.costReport(p.schoolId, "2026-01");
    const line = cost.lines[0]!;
    expect(line.prorated).toBe(true);
    expect(line.proratedCost).toBeLessThan(3100); // not a flat full-month charge
    expect(line.proratedCost).toBeCloseTo(3100 * (16 / 31), 0);
  });
});
