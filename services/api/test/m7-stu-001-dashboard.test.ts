import { describe, expect, it } from "vitest";
import { setupStudentSchool } from "./helpers";

/**
 * Milestone 7 — FR-STU-001 / FR-STU-003: the low-analytics student dashboard.
 * The fixed clock is at 2026-01-01; due dates are set relative to that.
 */
describe("M7 FR-STU-001/003 — student dashboard", () => {
  it("happy path — this week's homework and assessment appear with due dates; completed is distinct", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setupStudentSchool();
    const h1 = await ctx.studentWorkspace.assignTask(teacherId, schoolId, { studentId, type: "homework", title: "Fractions worksheet", dueDate: "2026-01-02T09:00:00.000Z" });
    await ctx.studentWorkspace.assignTask(teacherId, schoolId, { studentId, type: "homework", title: "Reading log", dueDate: "2026-01-03T09:00:00.000Z" });
    await ctx.studentWorkspace.assignTask(teacherId, schoolId, { studentId, type: "assessment", title: "Fractions quiz", dueDate: "2026-01-04T09:00:00.000Z" });

    await ctx.studentWorkspace.completeTask(studentId, h1.id);
    const view = await ctx.studentWorkspace.workspaceFor(studentId);

    expect(view.hasTasks).toBe(true);
    expect(view.thisWeek).toHaveLength(3);
    expect(view.thisWeek.every((t) => Boolean(t.dueDate))).toBe(true);
    // Completed items are visually distinct.
    expect(view.thisWeek.filter((t) => t.completed)).toHaveLength(1);
  });

  it("edge — no tasks assigned: a friendly 'nothing assigned yet' state, not a broken screen", async () => {
    const { ctx, studentId } = await setupStudentSchool();
    const view = await ctx.studentWorkspace.workspaceFor(studentId);
    expect(view.hasTasks).toBe(false);
    expect(view.today).toHaveLength(0);
    expect(view.emptyMessage).toMatch(/nothing assigned/i);
  });

  it("edge — overdue task: marked overdue without shaming language, and the teacher is notified", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setupStudentSchool();
    // Due before the fixed 'now' (2026-01-01) → overdue.
    await ctx.studentWorkspace.assignTask(teacherId, schoolId, { studentId, type: "homework", title: "Late worksheet", dueDate: "2025-12-28T09:00:00.000Z" });

    const view = await ctx.studentWorkspace.workspaceFor(studentId);
    const task = view.thisWeek.find((t) => t.title === "Late worksheet");
    expect(task?.overdue).toBe(true);

    // The assigning teacher is separately notified (once).
    const alerts = ctx.notificationChannel.delivered.filter((m) => m.type === "alert.overdue" && m.to === teacherId);
    expect(alerts).toHaveLength(1);
  });
});
