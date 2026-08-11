import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { makeUser, setupPrincipalSchool } from "./helpers";

/**
 * Milestone 10 — FR-BSS-001/002: teacher-authored behavioural/social observations,
 * separate from academic mastery, with the v1.3 gates.
 */
describe("M10 FR-BSS-001/002 — behavioural observations", () => {
  async function withConsentAndTeacher(p: Awaited<ReturnType<typeof setupPrincipalSchool>>) {
    await p.ctx.behavioural.configureConsent(p.adminId, p.schoolId);
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Ada");
    return { teacherId: teacher.user.id, student };
  }

  it("happy path — a teacher-authored observation is stored separately from academic mastery", async () => {
    const p = await setupPrincipalSchool();
    const { teacherId, student } = await withConsentAndTeacher(p);

    const obs = await p.ctx.behavioural.recordObservation(teacherId, p.schoolId, { studentId: student, category: "collaboration", note: "Showed strong collaboration in group work." });
    expect(obs.category).toBe("collaboration");
    // No AI-inferred score field anywhere on the observation.
    expect(obs).not.toHaveProperty("score");
    // Stored in the behavioural model, NOT in academic mastery.
    expect(await p.ctx.reportingStore.listObservationsByStudent(student)).toHaveLength(1);
    expect(await p.ctx.activityStore.listMasteryBySchool(p.schoolId)).toHaveLength(0);
  });

  it("edge — AI inference is blocked by design; only the four categories are accepted", async () => {
    const p = await setupPrincipalSchool();
    const { teacherId, student } = await withConsentAndTeacher(p);

    await expect(p.ctx.behavioural.autoScore()).rejects.toMatchObject({ code: "BEHAVIOURAL_INFERENCE_BLOCKED" });
    // A category outside the v1.3 taxonomy is rejected.
    await expect(
      p.ctx.behavioural.recordObservation(teacherId, p.schoolId, { studentId: student, category: "leadership" as never, note: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("edge — visibility differs per persona (author Teacher notes; Principal aggregate; Parent hidden)", async () => {
    const p = await setupPrincipalSchool();
    const { teacherId, student } = await withConsentAndTeacher(p);
    await p.ctx.behavioural.recordObservation(teacherId, p.schoolId, { studentId: student, category: "resilience", note: "Persevered through a hard task." });

    const asTeacher = await p.ctx.behavioural.observationsFor(teacherId, p.schoolId, student);
    expect(asTeacher.visibility).toBe("notes");
    expect(asTeacher.notes.length).toBe(1);

    const asPrincipal = await p.ctx.behavioural.observationsFor(p.principalId, p.schoolId, student);
    expect(asPrincipal.visibility).toBe("aggregate");
    expect(asPrincipal.notes).toHaveLength(0);
    expect(asPrincipal.aggregate.length).toBeGreaterThan(0);

    const parent = await makeUser(p.ctx, p.schoolId, `parent-${Math.random()}@r.edu`);
    await p.ctx.store.insertMembership({ id: newId(), userId: parent.id, schoolId: p.schoolId, role: "parent", campusId: p.campusId, classId: null, department: null });
    const asParent = await p.ctx.behavioural.observationsFor(parent.id, p.schoolId, student);
    expect(asParent.visibility).toBe("hidden");
    expect(asParent.notes).toHaveLength(0);
  });

  it("edge — collection does not go live for a school without its consent mechanism configured", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const teacher = await p.makeTeacher(klass.id);
    const student = await p.enrol(klass.id, "Ben");
    // No configureConsent() called.
    await expect(
      p.ctx.behavioural.recordObservation(teacher.user.id, p.schoolId, { studentId: student, category: "participation", note: "Contributed to discussion." }),
    ).rejects.toMatchObject({ code: "CONSENT_NOT_CONFIGURED" });
  });
});
