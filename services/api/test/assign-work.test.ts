import { describe, expect, it } from "vitest";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";
import type { AppContext } from "../src/context";

const NODE = "skill-add-fractions";

/**
 * Task #9 — assigning work to many students in one explicit teacher action,
 * including the baseline diagnostic for a new concept. Selection is always
 * suggest-then-confirm in the UI; the service only fans out a confirmed list.
 */
describe("Assign work — bulk assignment + baseline diagnostics", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const students: string[] = [];
    for (let i = 0; i < 3; i++) {
      students.push((await ctx.accounts.createAccount({
        schoolId: school.id, role: "student", email: `s${i}@springfield.edu`, firstName: "S", lastName: `T${i}`,
      })).user.id);
    }
    return { ctx, schoolId: school.id, teacherId: teacher.user.id, students };
  }

  async function publishedAssessment(ctx: AppContext, schoolId: string, teacherId: string) {
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 3 });
    const res = await ctx.assessment.generate(schoolId, teacherId, { title: "Fractions check", nodeId: NODE, count: 3, difficulty: "mixed" });
    if (res.status !== "generated") throw new Error("unreachable");
    await ctx.assessment.acknowledgeReview(res.assessmentId, teacherId);
    await ctx.assessment.publish(res.assessmentId, teacherId);
    return res.assessmentId;
  }

  it("assigns one assessment to many students in one action, audited once", async () => {
    const { ctx, schoolId, teacherId, students } = await setup();
    const assessmentId = await publishedAssessment(ctx, schoolId, teacherId);

    const tasks = await ctx.studentWorkspace.assignToStudents(teacherId, schoolId, {
      studentIds: students, type: "assessment", title: "Fractions check",
      nodeId: NODE, assessmentId, dueDate: "2026-02-01",
    });
    expect(tasks).toHaveLength(3);
    expect(new Set(tasks.map((t) => t.studentId))).toEqual(new Set(students));
    // Every student sees it in their workspace.
    for (const s of students) {
      const ws = await ctx.studentWorkspace.workspaceFor(s);
      expect(ws.hasTasks).toBe(true);
    }
    // One bulk audit entry, not three.
    expect(ctx.audit.find((e) => e.action === "task.assigned.bulk")).toHaveLength(1);
  });

  it("deduplicates the student list and refuses an empty one", async () => {
    const { ctx, schoolId, teacherId, students } = await setup();
    const assessmentId = await publishedAssessment(ctx, schoolId, teacherId);

    const tasks = await ctx.studentWorkspace.assignToStudents(teacherId, schoolId, {
      studentIds: [students[0]!, students[0]!], type: "assessment", title: "Fractions check",
      nodeId: NODE, assessmentId, dueDate: "2026-02-01",
    });
    expect(tasks).toHaveLength(1); // never two copies of the same task

    await expect(ctx.studentWorkspace.assignToStudents(teacherId, schoolId, {
      studentIds: [], type: "assessment", title: "x", dueDate: "2026-02-01",
    })).rejects.toThrow(/at least one student/i);
  });

  it("baseline diagnostic: flagged through to the student's workspace with calm framing", async () => {
    const { ctx, schoolId, teacherId, students } = await setup();
    const assessmentId = await publishedAssessment(ctx, schoolId, teacherId);

    await ctx.studentWorkspace.assignToStudents(teacherId, schoolId, {
      studentIds: [students[0]!], type: "assessment", title: "Where are we starting from?",
      nodeId: NODE, assessmentId, dueDate: "2026-02-01", baseline: true,
    });
    const ws = await ctx.studentWorkspace.workspaceFor(students[0]!);
    const task = [...ws.today, ...ws.thisWeek].find((t) => t.title.includes("starting"))
      ?? (await ctx.workspaceStore.listTasksByStudent(students[0]!))[0];
    expect(task).toBeDefined();
    // The flag survives persistence — the student UI renders it as planning
    // help ("not a graded test"), and later mastery writes give the growth
    // report its first real starting line.
    const stored = (await ctx.workspaceStore.listTasksByStudent(students[0]!))[0]!;
    expect(stored.baseline).toBe(true);
  });

  it("a baseline submission seeds the FIRST mastery data point (the cold-start fix)", async () => {
    const { ctx, schoolId, teacherId, students } = await setup();
    const assessmentId = await publishedAssessment(ctx, schoolId, teacherId);
    const student = students[0]!;
    await ctx.studentWorkspace.assignToStudents(teacherId, schoolId, {
      studentIds: [student], type: "assessment", title: "Baseline",
      nodeId: NODE, assessmentId, dueDate: "2026-02-01", baseline: true,
    });

    // Before: no mastery at all (the cold start).
    const before = (await ctx.activityStore.listMasteryBySchool(schoolId)).filter((m) => m.studentId === student);
    expect(before).toHaveLength(0);

    // The student sits the baseline; grading writes the first real data point.
    const attempt = await ctx.assessment.startAttempt(assessmentId, student);
    const questions = await ctx.assessmentStore.listQuestionsByAssessment(assessmentId);
    await ctx.assessment.submitAttempt(attempt.id, student, { [questions[0]!.id]: "A clear correct answer about fractions" });
    const after = (await ctx.activityStore.listMasteryBySchool(schoolId)).filter((m) => m.studentId === student && !m.synthetic);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]!.nodeId).toBe(NODE);
  });
});
