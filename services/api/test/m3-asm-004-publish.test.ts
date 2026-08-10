import { describe, expect, it } from "vitest";
import { AuthError } from "../src/domain/errors";
import type { AppContext } from "../src/context";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const NODE = "skill-add-fractions";

/** FR-ASM-004 — All generated output stays in draft until teacher review and publish. */
describe("FR-ASM-004 draft-until-publish", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }
  async function generatedAssessment(ctx: AppContext, schoolId: string, teacherId: string, scheduledStart?: string) {
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 3 });
    const res = await ctx.assessment.generate(schoolId, teacherId, { title: "Q", nodeId: NODE, count: 3, difficulty: "mixed", scheduledStart });
    if (res.status !== "generated") throw new Error("unreachable");
    return res.assessmentId;
  }
  async function student(ctx: AppContext, schoolId: string, email = "stu@springfield.edu") {
    return (await ctx.accounts.createAccount({ schoolId, role: "student", email, firstName: "S", lastName: "T" })).user.id;
  }

  it("happy path: an unpublished assessment cannot be accessed by students", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await generatedAssessment(ctx, schoolId, teacherId);
    const studentId = await student(ctx, schoolId);
    await expect(ctx.assessment.getForStudent(id, studentId)).rejects.toThrow();
  });

  it("edge — accidental publish is reversible before the scheduled start time", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await generatedAssessment(ctx, schoolId, teacherId, "2026-06-01T00:00:00.000Z"); // future
    await ctx.assessment.acknowledgeReview(id, teacherId);
    await ctx.assessment.publish(id, teacherId);

    const reverted = await ctx.assessment.unpublish(id, teacherId);
    expect(reverted.status).toBe("draft"); // students who haven't started are unaffected
  });

  it("edge — publish without review is blocked until a review acknowledgement", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await generatedAssessment(ctx, schoolId, teacherId);
    await expect(ctx.assessment.publish(id, teacherId)).rejects.toThrow(/review/i);

    await ctx.assessment.acknowledgeReview(id, teacherId);
    const pub = await ctx.assessment.publish(id, teacherId);
    expect(pub.status).toBe("published");
  });

  it("edge (NEW v1.4) — direct-link access to an unpublished assessment is denied at the permission layer and logged", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await generatedAssessment(ctx, schoolId, teacherId);
    const studentId = await student(ctx, schoolId);

    // Denied at the permission layer (an error), not merely hidden in the UI.
    await expect(ctx.assessment.getForStudent(id, studentId)).rejects.toBeInstanceOf(AuthError);
    expect(ctx.audit.find((e) => e.action === "assessment.access.denied")).toHaveLength(1);
  });

  it("edge (NEW v1.4) — connectivity loss mid-assessment preserves work; the interruption is visible to the Teacher", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const id = await generatedAssessment(ctx, schoolId, teacherId);
    await ctx.assessment.acknowledgeReview(id, teacherId);
    await ctx.assessment.publish(id, teacherId);
    const studentId = await student(ctx, schoolId);

    const attempt = await ctx.assessment.startAttempt(id, studentId);
    await ctx.assessment.saveProgress(attempt.id, { q1: "my answer" });
    await ctx.assessment.markInterrupted(attempt.id); // connection lost

    const resumed = await ctx.assessment.resume(attempt.id);
    expect(resumed.resumable).toBe(true);
    expect(resumed.savedAnswers).toEqual({ q1: "my answer" }); // preserved to last save

    const interrupted = await ctx.assessment.interruptedAttempts(id);
    expect(interrupted.map((a) => a.id)).toContain(attempt.id); // Teacher sees it
  });
});
