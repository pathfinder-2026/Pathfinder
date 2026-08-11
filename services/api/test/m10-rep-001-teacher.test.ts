import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { setupPrincipalSchool } from "./helpers";

/** Milestone 10 — FR-REP-001: teacher capability/growth reports. Clock = 2026-01-01. */
describe("M10 FR-REP-001 — teacher growth report", () => {
  async function masteryFromTo(p: Awaited<ReturnType<typeof setupPrincipalSchool>>, studentId: string, baseline: number, current: number, whenIso: string) {
    await p.ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId: p.schoolId, nodeId: p.nodeId, level: current >= 0.67 ? "secure" : "developing",
      score: current, dataPoints: 6, lastActivityAt: whenIso, history: [baseline], synthetic: false,
    });
  }

  it("happy path — a full-term growth report reflects that term's mastery changes", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const s = await p.enrol(klass.id, "Ada");
    await masteryFromTo(p, s, 0.5, 0.8, "2025-10-15T00:00:00.000Z"); // ~11 weeks of data

    const report = await p.ctx.reporting.teacherGrowthReport(teacher.user.id, p.schoolId, klass.id);
    expect(report.limited).toBe(false);
    const g = report.growth.find((x) => x.nodeId === p.nodeId)!;
    expect(g.baseline).toBe(0.5);
    expect(g.current).toBe(0.8);
    expect(g.change).toBeCloseTo(0.3);
  });

  it("edge — partial-term data is clearly stated as limited/early", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const s = await p.enrol(klass.id, "Ben");
    await masteryFromTo(p, s, 0.4, 0.5, "2025-12-11T00:00:00.000Z"); // ~3 weeks of data

    const report = await p.ctx.reporting.teacherGrowthReport(teacher.user.id, p.schoolId, klass.id);
    expect(report.limited).toBe(true);
    expect(report.note).toMatch(/limited|early|full term/i);
  });
});
