import { describe, expect, it } from "vitest";
import { DASHBOARD_THRESHOLDS, evidenceNote, evidenceStrength } from "../src/domain/insights";
import { newId } from "../src/platform/ids";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const NODE = "skill-add-fractions";

/**
 * Task #11 — the heatmap, the growth report and the adaptive engine must agree
 * about thin data. Found live in the UI review: for the SAME student+skill the
 * heatmap said "no data", the growth report said 0% → 0%, and the adaptive panel
 * confidently recommended remediation. A dashboard must not argue with itself.
 */
describe("Consistent mastery messaging on thin data", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A", teacher.user.id, "8");
    const student = await ctx.accounts.createAccount({
      schoolId: school.id, role: "student", email: "s1@springfield.edu", firstName: "Sam", lastName: "One", classId: klass.id,
    });
    return { ctx, schoolId: school.id, classId: klass.id, teacherId: teacher.user.id, studentId: student.user.id };
  }

  /** One real data point — the exact shape that used to be reported three ways. */
  async function onePoint(ctx: Awaited<ReturnType<typeof setup>>["ctx"], schoolId: string, studentId: string, score: number) {
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: NODE, level: score >= 0.67 ? "secure" : "low",
      score, dataPoints: 1, lastActivityAt: ctx.clock.isoNow(), synthetic: false,
    });
  }

  it("the shared rule: no record is 'none', one point is 'early', enough points is 'established'", () => {
    expect(evidenceStrength(0)).toBe("none");
    expect(evidenceStrength(1)).toBe("early");
    expect(evidenceStrength(DASHBOARD_THRESHOLDS.insufficientDataMin)).toBe("established");
    // The caveat wording exists exactly once, and only for thin evidence.
    expect(evidenceNote(1)).toMatch(/early signal/i);
    expect(evidenceNote(0)).toBeNull();
    expect(evidenceNote(DASHBOARD_THRESHOLDS.insufficientDataMin)).toBeNull();
  });

  it("heatmap SHOWS a single-point estimate as early evidence rather than hiding it as 'no data'", async () => {
    const { ctx, schoolId, classId, studentId } = await setup();
    await onePoint(ctx, schoolId, studentId, 0.2);

    const heatmap = await ctx.dashboard.heatmap(schoolId, classId);
    const cell = heatmap.cells.find((c) => c.studentId === studentId && c.nodeId === NODE);
    expect(cell).toBeDefined();
    // The record exists and is rendered — flagged early, NOT dropped.
    expect(cell!.evidence).toBe("early");
    expect(cell!.insufficientData).toBe(true);
    expect(cell!.score).toBeCloseTo(0.2, 5);
    // Thin evidence still doesn't earn a hard intervention flag.
    expect(heatmap.flags.some((f) => f.studentId === studentId && f.nodeId === NODE)).toBe(false);
  });

  it("adaptive recommends from that same point, and says so with the same caveat", async () => {
    const { ctx, schoolId, studentId } = await setup();
    await onePoint(ctx, schoolId, studentId, 0.2);

    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    expect(action.action).toBe("remediation"); // the recommendation still stands
    expect(action.evidence).toBe("early");     // …but no longer sounds certain
    expect(action.reason).toMatch(/early signal/i);
  });

  it("growth report says 'no starting point' instead of a meaningless 0% → 0%", async () => {
    const { ctx, schoolId, classId, teacherId, studentId } = await setup();
    await onePoint(ctx, schoolId, studentId, 0.2);

    const report = await ctx.reporting.teacherGrowthReport(teacherId, schoolId, classId);
    const row = report.growth.find((g) => g.nodeId === NODE)!;
    expect(row.hasBaseline).toBe(false); // the UI renders "not enough data yet"
    expect(row.current).toBeCloseTo(0.2, 5);
  });

  it("with real history all three agree on established evidence and genuine growth", async () => {
    const { ctx, schoolId, classId, teacherId, studentId } = await setup();
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: NODE, level: "secure",
      score: 0.8, dataPoints: DASHBOARD_THRESHOLDS.insufficientDataMin + 2,
      lastActivityAt: ctx.clock.isoNow(), synthetic: false, history: [0.4, 0.6],
    });

    const cell = (await ctx.dashboard.heatmap(schoolId, classId)).cells
      .find((c) => c.studentId === studentId && c.nodeId === NODE)!;
    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    const row = (await ctx.reporting.teacherGrowthReport(teacherId, schoolId, classId)).growth
      .find((g) => g.nodeId === NODE)!;

    expect(cell.evidence).toBe("established");
    expect(action.evidence).toBe("established");
    expect(action.reason).not.toMatch(/early signal/i);
    expect(row.hasBaseline).toBe(true);
    expect(row.change).toBeGreaterThan(0); // 0.4 → 0.8 is real, reported growth
  });
});
