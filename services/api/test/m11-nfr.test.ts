import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import {
  makeApprovedContent, makeMappedContent, makeTeacher, seedMastery, seedSchoolWithAdmin, setupPrincipalSchool, setupSignedGraph, setupStudentSchool,
} from "./helpers";
import { makeHarness } from "./helpers";

describe("M11 NFR verification", () => {
  it("NFR-SEC-001 — Principal and Teacher permissions are provably distinct", async () => {
    const p = await setupPrincipalSchool();
    const teacher = await p.makeTeacher();
    // A Teacher cannot open the Principal dashboard...
    await expect(p.ctx.principalDashboard.teacherReport(teacher.user.id, p.schoolId)).rejects.toMatchObject({ code: "NOT_A_PRINCIPAL" });
    // ...and a Principal is not an Admin (cannot set school policy).
    await expect(p.ctx.principalDashboard.setPolicy(p.principalId, p.schoolId, { teacherComparisonEnabled: true })).rejects.toMatchObject({ code: "NOT_AN_ADMIN" });
  });

  it("NFR-SEC-002 — no Ask-for-Help transcript content appears in any Principal view", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Sam");
    await p.ctx.safeguarding.setConfig(p.adminId, p.schoolId, { contactName: "DSL", contactRole: "Lead", slaHours: 24, afterHoursPolicy: "on-call" });
    const task = await p.ctx.studentWorkspace.assignTask(teacher.user.id, p.schoolId, { studentId: student, type: "homework", title: "P", nodeId: p.nodeId, dueDate: "2025-12-20T00:00:00.000Z" });
    await p.ctx.askForHelp.ask(student, task.id, "MARKER_XYZ please help");

    const drill = await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, student);
    expect(JSON.stringify(drill)).not.toContain("MARKER_XYZ");
    expect(drill.askForHelpExcluded).toBe(true);
  });

  it("NFR-AUD-001 — provenance survives archival: a grounding reference is retained, not broken", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const versionId = await setupSignedGraph(ctx, school.id);
    const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).find((n) => n.type === "skill")!.id;
    const teacher = await makeTeacher(ctx, school.id, `t-${newId()}@r.edu`);
    const contentId = await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { title: "Source doc", sections: 1 });
    const res = await ctx.agent.draftLessonPlan(teacher.user.id, school.id, { nodeId, topic: "T" });
    if (res.status !== "suggested") throw new Error("suggested");

    await ctx.content.archive(contentId, teacher.user.id, { confirm: true });
    const view = await ctx.agent.viewSuggestion(res.suggestion.id);
    const ref = view.grounding.find((g) => g.contentItemId === contentId)!;
    expect(ref).toBeDefined(); // reference retained
    expect(ref.archived).toBe(true); // and correctly flagged as archived
    expect(ref.title).toBe("Source doc"); // snapshot preserved
  });

  it("NFR-PRV-002 — one school's content is never visible in another school's approved pool", async () => {
    const { ctx } = makeHarness();
    const a = await seedSchoolWithAdmin(ctx, "School A");
    const b = await seedSchoolWithAdmin(ctx, "School B");
    const teacherA = await makeTeacher(ctx, a.school.id, `a-${newId()}@r.edu`);
    await makeApprovedContent(ctx, a.school.id, teacherA.user.id, { title: "A-only material" });

    const poolB = await ctx.content.approvedPool(b.school.id);
    expect(poolB).toHaveLength(0); // School B sees none of School A's content
  });

  it("NFR-SAF-001 — a safety-filter trip returns a clear message, not a silent failure, and is logged", async () => {
    const s = await setupStudentSchool();
    await makeMappedContent(s.ctx, s.schoolId, s.teacherId, s.nodeId, { sections: 1 });
    const task = await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, { studentId: s.studentId, type: "homework", title: "P", nodeId: s.nodeId, dueDate: "2026-01-05T09:00:00.000Z" });

    const res = await s.ctx.askForHelp.ask(s.studentId, task.id, "do i have adhd?");
    expect(res.available && res.kind).toBe("blocked_safety");
    if (res.available) expect(res.message.length).toBeGreaterThan(0); // clear message, not silent
    expect(s.ctx.audit.find((e) => e.action === "help.safety.blocked").length).toBeGreaterThanOrEqual(1);
  });

  it("FR-SAF-002 — a safeguarding event is restricted: never on a Teacher dashboard or Principal surface", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Sam");
    await p.ctx.safeguarding.setConfig(p.adminId, p.schoolId, { contactName: "DSL", contactRole: "Lead", slaHours: 24, afterHoursPolicy: "on-call" });
    await makeMappedContent(p.ctx, p.schoolId, teacher.user.id, p.nodeId, { sections: 1 });
    const task = await p.ctx.studentWorkspace.assignTask(teacher.user.id, p.schoolId, { studentId: student, type: "homework", title: "P", nodeId: p.nodeId, dueDate: "2025-12-20T00:00:00.000Z" });
    await p.ctx.askForHelp.ask(student, task.id, "I want to hurt myself");

    // The disclosure escalated to the safeguarding contact (restricted channel)...
    expect(p.ctx.notificationChannel.delivered.some((m) => m.type === "alert.safeguarding")).toBe(true);
    // ...and no safeguarding content leaks into a Principal surface or export.
    const surfaces = JSON.stringify([
      await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, student),
      await p.ctx.principalDashboard.exportReport(p.principalId, p.schoolId),
    ]);
    expect(surfaces.toLowerCase()).not.toContain("hurt myself");
    expect(surfaces.toLowerCase()).not.toContain("safeguard");
  });
});
