import { describe, expect, it } from "vitest";
import { setupPrincipalSchool } from "./helpers";

/** Milestone 9 — FR-PDB-006: sensitive comparison views configurable by school policy. */
describe("M9 FR-PDB-006 — policy-gated comparison views", () => {
  it("happy path — with teacher-to-teacher comparison disabled, that view does not appear at all", async () => {
    const p = await setupPrincipalSchool();
    await p.makeTeacher();
    // Default policy: comparison disabled.
    const report = await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId);
    expect(report.comparison).toBeNull();
  });

  it("edge — enabling the comparison mid-term makes it available going forward", async () => {
    const p = await setupPrincipalSchool();
    await p.makeTeacher();
    expect((await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId)).comparison).toBeNull();

    // The school enables it via policy (recorded with an updatedAt — going forward).
    const policy = await p.ctx.principalDashboard.setPolicy(p.adminId, p.schoolId, { teacherComparisonEnabled: true });
    expect(policy.updatedAt).toBeTruthy();

    const report = await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId);
    expect(report.comparison).not.toBeNull();
    expect(report.comparison!.ranking.length).toBeGreaterThan(0);
  });
});
