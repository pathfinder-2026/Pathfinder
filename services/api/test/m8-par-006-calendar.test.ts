import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { makeUser, setupParentSchool } from "./helpers";

/**
 * Milestone 8 — FR-PAR-006: a calendar of relevant events for the verified child.
 */
describe("M8 FR-PAR-006 — parent calendar", () => {
  async function verifiedParent() {
    const s = await setupParentSchool();
    const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "parent" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    return s;
  }

  it("happy path — a parent-teacher meeting and an upcoming assessment both appear", async () => {
    const s = await verifiedParent();
    await s.ctx.studentWorkspace.createEvent(s.teacherId, s.schoolId, { title: "Parent-teacher meeting", type: "parent_meeting", eventDate: "2026-02-02T17:00:00.000Z", yearGroup: "8" });
    await s.ctx.studentWorkspace.createEvent(s.teacherId, s.schoolId, { title: "Fractions assessment", type: "assessment", eventDate: "2026-02-04T09:00:00.000Z", yearGroup: "8" });

    const titles = (await s.ctx.parents.calendarFor(s.parentId, s.studentId)).map((c) => c.title);
    expect(titles).toContain("Parent-teacher meeting");
    expect(titles).toContain("Fractions assessment");
  });

  it("edge — two children in different year groups get separate, correctly-scoped calendars", async () => {
    const s = await setupParentSchool();
    // Child A stays in year 8; child B is a year-9 class.
    const linkA = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "parent" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, linkA.id);

    const campuses = await s.ctx.store.listCampusesBySchool(s.schoolId);
    const class9 = await s.ctx.schools.createClass(s.schoolId, campuses[0]!.id, "9A", s.adminId, "9");
    const childB = await makeUser(s.ctx, s.schoolId, `y9-${newId()}@r.edu`);
    // Enrol child B in the year-9 class.
    await s.ctx.store.insertMembership({ id: newId(), userId: childB.id, schoolId: s.schoolId, role: "student", campusId: campuses[0]!.id, classId: class9.id, department: null });
    const linkB = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: childB.id, relationship: "parent" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, linkB.id);

    await s.ctx.studentWorkspace.createEvent(s.teacherId, s.schoolId, { title: "Year 9 excursion", type: "co_curricular", eventDate: "2026-02-10T09:00:00.000Z", yearGroup: "9" });

    const calA = (await s.ctx.parents.calendarFor(s.parentId, s.studentId)).map((c) => c.title);
    const calB = (await s.ctx.parents.calendarFor(s.parentId, childB.id)).map((c) => c.title);
    expect(calA).not.toContain("Year 9 excursion"); // child A (year 8) never sees the year-9 event
    expect(calB).toContain("Year 9 excursion");
  });
});
