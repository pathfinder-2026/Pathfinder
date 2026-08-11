import { describe, expect, it } from "vitest";
import { containsDiagnosticLanguage } from "../src/domain/parent";
import { seedMastery, setupParentSchool } from "./helpers";

/**
 * Milestone 8 — FR-PAR-003: verification-before-data, no cross-student access, and
 * never diagnostic-sounding language. The DoD calls out the diagnostic-language
 * check specifically — it's easy to violate through careless copy.
 */
describe("M8 FR-PAR-003 — access control & non-diagnostic language", () => {
  const RECENT = "2025-12-20T00:00:00.000Z";

  it("happy path — a parent verified for one child sees only that child; another student is denied", async () => {
    const s = await setupParentSchool();
    const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "father" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    const other = await s.makeChild("Ben");

    expect(await s.ctx.parents.verifiedChildren(s.parentId)).toHaveLength(1);
    await expect(s.ctx.parents.dashboardFor(s.parentId, other)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("edge — two verified children are kept clearly separate, never merged", async () => {
    const s = await setupParentSchool();
    const childB = await s.makeChild("Bea");
    for (const [child] of [[s.studentId], [childB]] as const) {
      const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: child, relationship: "parent" });
      await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    }
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.9, RECENT);
    await seedMastery(s.ctx, s.schoolId, childB, s.integersNode.id, 0.9, RECENT);

    const children = await s.ctx.parents.verifiedChildren(s.parentId);
    expect(children).toHaveLength(2);

    const a = await s.ctx.parents.dashboardFor(s.parentId, s.studentId);
    const b = await s.ctx.parents.dashboardFor(s.parentId, childB);
    expect(a.childName).toBe("Ada");
    expect(b.childName).toBe("Bea");
    expect(a.summaryText).not.toContain("Bea"); // never merged/cross-displayed
    expect(b.summaryText).not.toContain("Ada");
  });

  it("edge — a learning-difficulty pattern is described observationally, never with diagnostic language", async () => {
    const s = await setupParentSchool();
    const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "parent" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    // Persistent low mastery = a "learning-difficulty pattern" in the data.
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.1, RECENT);
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.integersNode.id, 0.15, RECENT);

    const summary = await s.ctx.parents.dashboardFor(s.parentId, s.studentId);
    expect(containsDiagnosticLanguage(summary.summaryText)).toBe(false);
    // The guard itself catches clinical wording.
    expect(containsDiagnosticLanguage("shows signs of dyslexia and ADHD")).toBe(true);
    expect(containsDiagnosticLanguage("has found fractions challenging")).toBe(false);
  });

  it("edge — an unverified relationship shows no student data until verification completes", async () => {
    const s = await setupParentSchool();
    // Linked, but NOT verified.
    await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "parent" });

    expect(await s.ctx.parents.verifiedChildren(s.parentId)).toHaveLength(0);
    await expect(s.ctx.parents.dashboardFor(s.parentId, s.studentId)).rejects.toMatchObject({ code: "AUTH" });
  });
});
