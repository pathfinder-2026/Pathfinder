import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { seedMastery, setupPrincipalSchool } from "./helpers";

/**
 * Milestone 9 — FR-PDB-005 (non-negotiable DoD): Ask-for-Help transcripts are
 * unreachable from EVERY Principal-facing surface, including exports. Tested by
 * hunting for a back door, not just the front door.
 */
describe("M9 FR-PDB-005 — tutor transcripts never reach a Principal surface", () => {
  const SECRET = "PINEAPPLE_SECRET_TRANSCRIPT_TEXT";
  const WHEN = "2025-12-20T00:00:00.000Z";

  /** Create a real Ask-for-Help transcript containing SECRET, assigned by `teacherId`. */
  async function seedTranscript(p: Awaited<ReturnType<typeof setupPrincipalSchool>>, classId: string, teacherId: string) {
    const student = await p.enrol(classId, "Sam");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.5, WHEN);
    await p.ctx.safeguarding.setConfig(p.adminId, p.schoolId, { contactName: "DSL", contactRole: "Lead", slaHours: 24, afterHoursPolicy: "on-call" });
    const task = await p.ctx.studentWorkspace.assignTask(teacherId, p.schoolId, { studentId: student, type: "homework", title: "Practice", nodeId: p.nodeId, dueDate: WHEN });
    await p.ctx.askForHelp.ask(student, task.id, `${SECRET} — can you help me start?`);
    const session = (await p.ctx.workspaceStore.findHelpSession(student, task.id))!;
    return { student, task, session };
  }

  it("back-door hunt — SECRET never appears in any Principal surface, including exports", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    await seedTranscript(p, klass.id, teacher.user.id);

    const surfaces = JSON.stringify([
      await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId),
      await p.ctx.principalDashboard.masteryOverview(p.principalId, p.schoolId),
      await p.ctx.principalDashboard.drillClass(p.principalId, p.schoolId, klass.id),
      await p.ctx.principalDashboard.exportReport(p.principalId, p.schoolId),
    ]);
    expect(surfaces).not.toContain(SECRET);

    const classDrill = await p.ctx.principalDashboard.drillClass(p.principalId, p.schoolId, klass.id);
    for (const s of classDrill.students) {
      const studentDrill = await p.ctx.principalDashboard.drillStudent(p.principalId, p.schoolId, s.studentId);
      expect(JSON.stringify(studentDrill)).not.toContain(SECRET);
    }
  });

  it("dual-role Principal-Teacher — sees own-class transcripts via Teacher capacity, never via a Principal surface", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    // A user who is BOTH a teacher (assigning) and a principal.
    const dual = await p.makeTeacher(klass.id);
    await p.ctx.store.insertMembership({ id: newId(), userId: dual.user.id, schoolId: p.schoolId, role: "principal", campusId: p.campusId, classId: null, department: null });
    const { session } = await seedTranscript(p, klass.id, dual.user.id);

    // Teacher capacity: the assigning teacher CAN read the transcript.
    const transcript = await p.ctx.askForHelp.transcript(dual.user.id, session.id);
    expect(JSON.stringify(transcript)).toContain(SECRET);

    // A pure Principal (not the assigning teacher) cannot read it at all.
    await expect(p.ctx.askForHelp.transcript(p.principalId, session.id)).rejects.toMatchObject({ code: "NOT_ASSIGNING_TEACHER" });

    // And the dual-role user's Principal surface still excludes it.
    const asPrincipal = await p.ctx.principalDashboard.exportReport(dual.user.id, p.schoolId);
    expect(JSON.stringify(asPrincipal)).not.toContain(SECRET);
  });
});
