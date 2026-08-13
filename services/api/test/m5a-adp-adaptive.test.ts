import { describe, expect, it } from "vitest";
import type { Assessment, AssessmentAttempt } from "../src/domain/assessment";
import { newId } from "../src/platform/ids";
import { makeHarness, makeTeacher, seedActivityClass } from "./helpers";

/**
 * Milestone 5a — FR-ADP-001 / FR-ADP-002: recommend the next best action per
 * student and schedule spaced revision. The engine advises the Teacher; it never
 * auto-assigns, and it escalates rather than looping remediation forever.
 */
describe("M5a FR-ADP-001/002 — adaptive engine", () => {
  it("happy path — strong mastery recommends progression/extension, not repeating content", async () => {
    const { ctx } = makeHarness();
    const { schoolId, summary } = await seedActivityClass(ctx);

    const action = await ctx.adaptive.nextAction(schoolId, summary.multiGroupStudentId, summary.focusNodeId);

    expect(action.action).toBe("extension");
    expect(action.escalated).toBe(false);
  });

  it("edge — a persistent misconception escalates to the Teacher instead of auto-remediating", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    // A class Teacher exists → the escalation also reaches them via the notification service.
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu", { classId });
    const student = summary.misconceptionStudentIds[0]!;

    const action = await ctx.adaptive.nextAction(schoolId, student, summary.misconceptionNodeId);

    expect(action.action).toBe("escalate");
    expect(action.escalated).toBe(true);
    // Surfaced on the dashboard as an escalation…
    const escalations = await ctx.adaptive.escalations(schoolId, classId);
    expect(escalations.some((e) => e.studentId === student)).toBe(true);
    // …and the class Teacher is alerted (first Milestone 5 consumer of the notification service).
    const alerts = ctx.notificationChannel.delivered.filter((m) => m.type === "alert.teacher");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some((m) => m.to === teacher.user.id)).toBe(true);
    expect(ctx.audit.find((e) => e.action === "adaptive.misconception.escalated").length).toBeGreaterThanOrEqual(1);
  });

  it("edge — conflicting signals: the recommendation weighs both, not only the latest score", async () => {
    const { ctx } = makeHarness();
    const { schoolId, summary } = await seedActivityClass(ctx);

    // This student is strong independently (0.85) but weak when assisted (0.3).
    const action = await ctx.adaptive.nextAction(schoolId, summary.conflictingStudentId, summary.conflictingNodeId);

    // Not "extension" (which the latest independent score alone would suggest) —
    // the divergence triggers a reassessment to confirm before progressing.
    expect(action.action).toBe("reassessment");
    expect(action.reason).toMatch(/assisted/i);
    expect(action.escalated).toBe(false);
  });

  it("edge — a spaced-revision reminder is deferred while an assessment is in progress", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu", { classId });

    const withAttempt = summary.staleStudentIds[0]!;
    const withoutAttempt = summary.staleStudentIds[1]!;

    // A minimal published assessment + an in-progress attempt for one stale student.
    const assessment: Assessment = {
      id: newId(), schoolId, teacherId: teacher.user.id, title: "Quiz",
      request: { title: "Quiz", nodeId: summary.focusNodeId, count: 1, difficulty: "mixed" },
      status: "published", generationStatus: "generated", publishedAt: ctx.clock.isoNow(),
      scheduledStart: null, reviewAcknowledged: true, shortfall: null, flags: [], createdAt: ctx.clock.isoNow(),
    };
    await ctx.assessmentStore.insertAssessment(assessment);
    const attempt: AssessmentAttempt = {
      id: newId(), assessmentId: assessment.id, studentId: withAttempt, status: "in_progress",
      savedAnswers: {}, lastSavedAt: ctx.clock.isoNow(), interrupted: false,
      resumeDeadline: ctx.clock.isoNow(), createdAt: ctx.clock.isoNow(),
      gradedScore: null, gradedResults: null, gradedAt: null,
    };
    await ctx.assessmentStore.insertAttempt(attempt);

    const reminders = await ctx.adaptive.dueRevisionReminders(schoolId, classId);

    const forWith = reminders.filter((r) => r.studentId === withAttempt);
    const forWithout = reminders.filter((r) => r.studentId === withoutAttempt);
    expect(forWith.length).toBeGreaterThanOrEqual(1);
    expect(forWith.every((r) => r.deferred)).toBe(true);
    expect(forWith.every((r) => r.reason && /assessment in progress/i.test(r.reason))).toBe(true);
    // A stale student without an attempt is not deferred — the reminder stands.
    expect(forWithout.length).toBeGreaterThanOrEqual(1);
    expect(forWithout.every((r) => !r.deferred)).toBe(true);
  });
});
