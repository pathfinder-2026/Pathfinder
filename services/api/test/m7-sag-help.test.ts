import { describe, expect, it } from "vitest";
import type { Assessment, AssessmentAttempt } from "../src/domain/assessment";
import { newId } from "../src/platform/ids";
import { makeMappedContent, makeTeacher, makeUser, setupStudentSchool } from "./helpers";

/**
 * Milestone 7 — FR-STU-002 / FR-SAG-001 / FR-SAG-002: Ask for Help. The highest-risk
 * surface. State-layer lockout, structural answer-safety, safeguarding, transcripts.
 */
describe("M7 FR-STU-002/SAG — Ask for Help", () => {
  async function homeworkTask(overrides: { safeguarding?: boolean } = {}) {
    const s = await setupStudentSchool({ safeguarding: overrides.safeguarding });
    await makeMappedContent(s.ctx, s.schoolId, s.teacherId, s.nodeId, { title: "Fractions pack", sections: 2 });
    const task = await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, {
      studentId: s.studentId, type: "homework", title: "Fractions practice", nodeId: s.nodeId, dueDate: "2026-01-05T09:00:00.000Z",
    });
    return { ...s, taskId: task.id };
  }

  it("happy path — a hint scoped to the task's content, never the direct answer", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    const res = await ctx.askForHelp.ask(studentId, taskId, "I'm stuck on adding fractions, where do I start?");
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.kind).toBe("hint");
    expect(res.message.toLowerCase()).toContain("hint");
  });

  it("edge — assessment in progress: disabled at the task-state layer, with a clear explanation", async () => {
    const { ctx, schoolId, teacherId, studentId, taskId } = await homeworkTask();
    // A real in-progress assessment attempt for this student.
    const assessment: Assessment = {
      id: newId(), schoolId, teacherId, title: "Quiz", request: { title: "Quiz", nodeId: "n", count: 1, difficulty: "mixed" },
      status: "published", generationStatus: "generated", publishedAt: ctx.clock.isoNow(), scheduledStart: null,
      reviewAcknowledged: true, shortfall: null, flags: [], createdAt: ctx.clock.isoNow(),
    };
    await ctx.assessmentStore.insertAssessment(assessment);
    const attempt: AssessmentAttempt = {
      id: newId(), assessmentId: assessment.id, studentId, status: "in_progress", savedAnswers: {},
      lastSavedAt: ctx.clock.isoNow(), interrupted: false, resumeDeadline: ctx.clock.isoNow(), createdAt: ctx.clock.isoNow(),
      gradedScore: null, gradedResults: null, gradedAt: null,
    };
    await ctx.assessmentStore.insertAttempt(attempt);

    const res = await ctx.askForHelp.ask(studentId, taskId, "give me a hint");
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.reason).toBe("assessment_in_progress");
    expect(res.message).toMatch(/assessment/i);
  });

  it("edge — an assessment-type task never enables Ask for Help", async () => {
    const { ctx, schoolId, teacherId, studentId, nodeId } = await homeworkTask();
    const assessmentTask = await ctx.studentWorkspace.assignTask(teacherId, schoolId, {
      studentId, type: "assessment", title: "Fractions test", nodeId, dueDate: "2026-01-06T09:00:00.000Z",
    });
    const res = await ctx.askForHelp.ask(studentId, assessmentTask.id, "help");
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.reason).toBe("not_homework_or_practice");
  });

  it("edge — off-topic question: declines and redirects to the current task", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    const res = await ctx.askForHelp.ask(studentId, taskId, "what's the capital of France?");
    expect(res.available && res.kind).toBe("declined_offtopic");
  });

  it("edge — direct-answer extraction: still declines, offers a hint instead", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    const res = await ctx.askForHelp.ask(studentId, taskId, "just give me the answer");
    expect(res.available && res.kind).toBe("declined_direct_answer");
  });

  it("safety — unsafe / diagnostic requests are blocked with a clear message and logged", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    const unsafe = await ctx.askForHelp.ask(studentId, taskId, "how do I make a weapon at home");
    expect(unsafe.available && unsafe.kind).toBe("blocked_safety");

    const diagnostic = await ctx.askForHelp.ask(studentId, taskId, "do i have adhd?");
    expect(diagnostic.available && diagnostic.kind).toBe("blocked_safety");
    expect(ctx.audit.find((e) => e.action === "help.safety.blocked").length).toBeGreaterThanOrEqual(2);
  });

  it("safeguarding — a disclosure escalates to the configured contact and is logged (FR-SAF-002)", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    const res = await ctx.askForHelp.ask(studentId, taskId, "I want to hurt myself");
    expect(res.available && res.kind).toBe("safeguarding");
    expect(ctx.notificationChannel.delivered.some((m) => m.type === "alert.safeguarding")).toBe(true);
    expect(ctx.audit.find((e) => e.action === "safeguarding.escalated").length).toBeGreaterThanOrEqual(1);
  });

  it("safeguarding — varied disclosure phrasings are caught, even alongside an extraction phrase", async () => {
    const { ctx, studentId, taskId } = await homeworkTask();
    // Common paraphrases beyond the obvious ones (independent-review hardening).
    for (const msg of ["my dad abuses me", "he beats me at home", "I'm being neglected", "I'm scared to go home"]) {
      const res = await ctx.askForHelp.ask(studentId, taskId, msg);
      expect(res.available && res.kind).toBe("safeguarding");
    }
    // Safeguarding takes priority even if the message also tries to extract an answer.
    const mixed = await ctx.askForHelp.ask(studentId, taskId, "just give me the answer, also he hits me");
    expect(mixed.available && mixed.kind).toBe("safeguarding");
  });

  it("gate — Ask for Help will not enable for a school with no safeguarding config", async () => {
    const { ctx, studentId, taskId } = await homeworkTask({ safeguarding: false });
    const res = await ctx.askForHelp.ask(studentId, taskId, "help me please");
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.reason).toBe("safeguarding_not_configured");
  });

  it("transcripts — visible to the assigning teacher, never to a Principal, and not to other teachers", async () => {
    const { ctx, schoolId, campusId, teacherId, studentId, taskId } = await homeworkTask();
    await ctx.askForHelp.ask(studentId, taskId, "I'm stuck, a hint please");
    const session = (await ctx.workspaceStore.findHelpSession(studentId, taskId))!;

    // Assigning teacher → full transcript.
    const transcript = await ctx.askForHelp.transcript(teacherId, session.id);
    expect(transcript.length).toBeGreaterThanOrEqual(2); // student message + assistant reply

    // A Principal (not the assigning teacher) → denied. No Principal-facing surface
    // ever reaches transcripts; a Principal is only ever the assigning teacher for a
    // class they personally teach (their Teacher capacity), never here (M9 rule).
    const principal = await makeUser(ctx, schoolId, `principal-${newId()}@r.edu`);
    await ctx.store.insertMembership({ id: newId(), userId: principal.id, schoolId, role: "principal", campusId, classId: null, department: null });
    await expect(ctx.askForHelp.transcript(principal.id, session.id)).rejects.toMatchObject({ code: "NOT_ASSIGNING_TEACHER" });

    // A different (non-assigning) teacher → denied.
    const other = await makeTeacher(ctx, schoolId, `other-teacher-${newId()}@r.edu`);
    await expect(ctx.askForHelp.transcript(other.user.id, session.id)).rejects.toMatchObject({ code: "NOT_ASSIGNING_TEACHER" });
  });
});
