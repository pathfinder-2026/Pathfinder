import { describe, expect, it } from "vitest";
import { makeUser, setupPrincipalSchool } from "./helpers";

/** Milestone 10 — FR-CAP-002: co-curricular capability, its own simpler structure. */
describe("M10 FR-CAP-002 — co-curricular capability", () => {
  it("happy path — a recorded instrument skill appears in capability data, separate from academic mastery", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Ada");

    await p.ctx.coCurricular.recordCapability(teacher.user.id, p.schoolId, { studentId: student, domain: "music", skill: "violin", level: "grade 3" });

    const records = await p.ctx.coCurricular.capabilityFor(student);
    expect(records).toHaveLength(1);
    expect(records[0]!.domain).toBe("music");
    // Separate from academic mastery: it is NOT in the academic mastery store.
    expect(await p.ctx.activityStore.listMasteryBySchool(p.schoolId)).toHaveLength(0);
  });

  it("edge — no co-curricular data: the report section is omitted, not a misleading 'no progress'", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const student = await p.enrol(klass.id, "Ben");
    const parent = await makeUser(p.ctx, p.schoolId, `parent-${Math.random()}@r.edu`);
    const link = await p.ctx.parents.linkChild(p.adminId, p.schoolId, { parentId: parent.id, studentId: student, relationship: "parent" });
    await p.ctx.parents.verifyLink(p.adminId, p.schoolId, link.id);

    const report = await p.ctx.reporting.parentReport(parent.id, p.schoolId, student);
    expect(report.coCurricular).toEqual([]);
  });

  it("edge — no formal curriculum mapping: uses a free-text skill, not the academic skill-graph shape", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Cai");

    const record = await p.ctx.coCurricular.recordCapability(teacher.user.id, p.schoolId, { studentId: student, domain: "sport", skill: "200m freestyle", level: "regional" });
    // A simpler structure: a free-text skill + domain, with no skill-graph node id.
    expect(record.skill).toBe("200m freestyle");
    expect(record).not.toHaveProperty("nodeId");
  });
});
