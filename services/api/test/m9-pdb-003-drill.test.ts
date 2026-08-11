import { describe, expect, it } from "vitest";
import { seedMastery, setupPrincipalSchool } from "./helpers";

/** Milestone 9 — FR-PDB-003: drill school -> class -> student; no cross-campus. */
describe("M9 FR-PDB-003 — drill-down", () => {
  const WHEN = "2025-12-20T00:00:00.000Z";

  it("happy path — drill from school to a class to an individual student", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const student = await p.enrol(klass.id, "Sam");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.4, WHEN);

    const overview = await p.ctx.principalDashboard.masteryOverview(p.principalId, p.schoolId);
    expect(overview.classes.some((c) => c.classId === klass.id)).toBe(true);

    const classDrill = await p.ctx.principalDashboard.drillClass(p.principalId, p.schoolId, klass.id);
    expect(classDrill.students.some((s) => s.studentId === student)).toBe(true);

    const studentDrill = await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, student);
    expect(studentDrill.skills.length).toBeGreaterThan(0);
  });

  it("edge — cross-campus comparison is out of MVP scope and not offered", async () => {
    const p = await setupPrincipalSchool();
    await expect(p.ctx.principalDashboard.compareCampuses(p.principalId, p.schoolId)).rejects.toMatchObject({ code: "OUT_OF_MVP_SCOPE" });
  });

  it("edge — Ask-for-Help transcripts remain excluded at the deepest drill level", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const student = await p.enrol(klass.id, "Sam");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.5, WHEN);

    const drill = await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, student);
    expect(drill.askForHelpExcluded).toBe(true);
    // No transcript/message content is present anywhere in the deepest view.
    expect(JSON.stringify(drill).toLowerCase()).not.toContain("transcript");
    expect(JSON.stringify(drill)).not.toContain("help_message");
  });
});
