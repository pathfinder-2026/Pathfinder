import { describe, expect, it } from "vitest";
import { setupStudentSchool } from "./helpers";

/**
 * Milestone 7 — FR-STU-004: the student calendar. Restricted (wrong year group)
 * events are invisible; a rescheduled event is flagged as changed.
 */
describe("M7 FR-STU-004 — student calendar", () => {
  it("happy path — an assessment and a co-curricular fixture both appear, correctly dated", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setupStudentSchool();
    await ctx.studentWorkspace.createEvent(teacherId, schoolId, { title: "Fractions assessment", type: "assessment", eventDate: "2026-02-03T09:00:00.000Z", yearGroup: "8" });
    await ctx.studentWorkspace.createEvent(teacherId, schoolId, { title: "Sports fixture", type: "co_curricular", eventDate: "2026-02-05T15:00:00.000Z", yearGroup: null });

    const calendar = await ctx.studentWorkspace.calendarFor(studentId);
    const titles = calendar.map((c) => c.title);
    expect(titles).toContain("Fractions assessment");
    expect(titles).toContain("Sports fixture");
    expect(calendar.find((c) => c.title === "Fractions assessment")!.date).toBe("2026-02-03T09:00:00.000Z");
  });

  it("edge — restricted event for a different year group does not appear at all", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setupStudentSchool({ yearGroup: "8" });
    await ctx.studentWorkspace.createEvent(teacherId, schoolId, { title: "Year 9 excursion", type: "co_curricular", eventDate: "2026-02-10T09:00:00.000Z", yearGroup: "9" });

    const calendar = await ctx.studentWorkspace.calendarFor(studentId);
    expect(calendar.map((c) => c.title)).not.toContain("Year 9 excursion");
  });

  it("edge — rescheduled assessment updates the student's calendar and is flagged as changed", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setupStudentSchool();
    const event = await ctx.studentWorkspace.createEvent(teacherId, schoolId, { title: "Maths test", type: "assessment", eventDate: "2026-02-03T09:00:00.000Z", yearGroup: "8" });

    await ctx.studentWorkspace.rescheduleEvent(teacherId, schoolId, event.id, "2026-02-06T09:00:00.000Z");

    const item = (await ctx.studentWorkspace.calendarFor(studentId)).find((c) => c.id === event.id);
    expect(item).toBeDefined();
    expect(item!.date).toBe("2026-02-06T09:00:00.000Z");
    expect(item!.changed).toBe(true);
  });
});
