import { describe, expect, it } from "vitest";
import { canSurfaceToStakeholder, newInferenceRecord } from "../src/domain/inference";
import { newId } from "../src/platform/ids";
import {
  makeHarness, makeMappedContent, makeTeacher, seedMastery, seedSchoolWithAdmin, setupPrincipalSchool, setupSignedGraph,
} from "./helpers";

/**
 * Milestone 11 — the deliberate red-team against EXACTLY two failure modes:
 *   (1) any path where AI-generated content reaches a student without teacher action;
 *   (2) any path where a Principal surface (incl. exports) exposes Ask-for-Help transcripts.
 */
describe("M11 red-team — AI content never reaches a student without teacher action", () => {
  it("no unreviewed AI artifact is student-reachable: assessment, agent draft, focus material, inference", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const versionId = await setupSignedGraph(ctx, school.id);
    const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).find((n) => n.type === "skill")!.id;
    const teacher = await makeTeacher(ctx, school.id, `t-${newId()}@r.edu`);
    await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { sections: 2 });

    // Assessment: generated content is a DRAFT and denied to students until published.
    const gen = await ctx.assessment.generate(school.id, teacher.user.id, { title: "Q", nodeId, count: 2, difficulty: "mixed" });
    if (gen.status !== "generated") throw new Error("expected generation");
    await expect(ctx.assessment.getForStudent(gen.assessmentId, "stud-1")).rejects.toBeDefined();

    // Teacher-Agent drafts are never auto-sent.
    const draft = await ctx.agent.draftLessonPlan(teacher.user.id, school.id, { nodeId, topic: "T" });
    expect(draft.status).toBe("suggested");
    if (draft.status === "suggested") expect(draft.suggestion.sent).toBe(false);

    // Focus material cannot be pushed without an explicit teacher action.
    const campuses = await ctx.store.listCampusesBySchool(school.id);
    const klass = await ctx.schools.createClass(school.id, campuses[0]!.id, "8A");
    await expect(ctx.dashboard.assignFocusMaterial("system-agent", school.id, klass.id, nodeId, "content-x"))
      .rejects.toMatchObject({ code: "AUTO_ASSIGN_BLOCKED" });

    // AI claims about a student carry an approvable state and cannot surface unreviewed.
    const inference = newInferenceRecord({ studentId: "stud-1", schoolId: school.id, kind: "mastery", claim: "x", createdAt: ctx.clock.isoNow() });
    expect(canSurfaceToStakeholder(inference)).toBe(false);
  });

  it("revoked approval stops delivery: unpublish makes an assessment student-inaccessible again", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const versionId = await setupSignedGraph(ctx, school.id);
    const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).find((n) => n.type === "skill")!.id;
    const teacher = await makeTeacher(ctx, school.id, `t-${newId()}@r.edu`);
    await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { sections: 2 });
    const gen = await ctx.assessment.generate(school.id, teacher.user.id, { title: "Q", nodeId, count: 2, difficulty: "mixed", scheduledStart: "2026-06-01T00:00:00.000Z" });
    if (gen.status !== "generated") throw new Error("expected generation");
    await ctx.assessment.acknowledgeReview(gen.assessmentId, teacher.user.id);
    await ctx.assessment.publish(gen.assessmentId, teacher.user.id);

    await ctx.assessment.unpublish(gen.assessmentId, teacher.user.id);
    await expect(ctx.assessment.getForStudent(gen.assessmentId, "stud-1")).rejects.toBeDefined();
  });
});

describe("M11 red-team — Principal surfaces never expose Ask-for-Help transcripts", () => {
  const SECRET = "REDTEAM_SECRET_TRANSCRIPT";

  it("back-door hunt across every Principal surface and export", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Sam");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.5, "2025-12-20T00:00:00.000Z");
    await p.ctx.safeguarding.setConfig(p.adminId, p.schoolId, { contactName: "DSL", contactRole: "Lead", slaHours: 24, afterHoursPolicy: "on-call" });
    const task = await p.ctx.studentWorkspace.assignTask(teacher.user.id, p.schoolId, { studentId: student, type: "homework", title: "P", nodeId: p.nodeId, dueDate: "2025-12-20T00:00:00.000Z" });
    await p.ctx.askForHelp.ask(student, task.id, `${SECRET} help me`);

    const surfaces = JSON.stringify([
      await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId),
      await p.ctx.principalDashboard.masteryOverview(p.principalId, p.schoolId),
      await p.ctx.principalDashboard.drillClass(p.principalId, p.schoolId, klass.id),
      await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, student),
      await p.ctx.principalDashboard.exportReport(p.principalId, p.schoolId),
      await p.ctx.reporting.schoolReport(p.principalId, p.schoolId, "2026-01"),
    ]);
    expect(surfaces).not.toContain(SECRET);
  });
});
