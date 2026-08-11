import { describe, expect, it } from "vitest";
import { makeUser, seedMastery, setupPrincipalSchool } from "./helpers";

/** Milestone 10 — FR-REP-004: parent term report; empty sections omit gracefully. */
describe("M10 FR-REP-004 — parent report", () => {
  const WHEN = "2025-12-20T00:00:00.000Z";

  async function verifiedParent(p: Awaited<ReturnType<typeof setupPrincipalSchool>>, studentId: string) {
    const parent = await makeUser(p.ctx, p.schoolId, `parent-${Math.random()}@r.edu`);
    const link = await p.ctx.parents.linkChild(p.adminId, p.schoolId, { parentId: parent.id, studentId, relationship: "parent" });
    await p.ctx.parents.verifyLink(p.adminId, p.schoolId, link.id);
    return parent.id;
  }

  it("happy path — strengths, focus areas and teacher comments in plain language", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Ada");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.9, WHEN);
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId2, 0.2, WHEN);
    await p.ctx.reporting.addComment(teacher.user.id, p.schoolId, student, "Ada has grown in confidence this term.");
    await p.ctx.coCurricular.recordCapability(teacher.user.id, p.schoolId, { studentId: student, domain: "music", skill: "violin", level: "grade 3" });
    const parentId = await verifiedParent(p, student);

    const report = await p.ctx.reporting.parentReport(parentId, p.schoolId, student);
    expect(report.strengths.length).toBeGreaterThan(0);
    expect(report.focusAreas.length).toBeGreaterThan(0);
    expect(report.teacherComments).toContain("Ada has grown in confidence this term.");
    expect(report.coCurricular.some((c) => c.skill === "violin")).toBe(true);
  });

  it("edge — no teacher comments: that section is omitted gracefully (empty, not broken)", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const student = await p.enrol(klass.id, "Ben");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.8, WHEN);
    const parentId = await verifiedParent(p, student);

    const report = await p.ctx.reporting.parentReport(parentId, p.schoolId, student);
    expect(report.teacherComments).toEqual([]);
  });
});
