import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/domain/errors";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/** FR-ADM-002 — Manage teacher/student accounts, roles and permissions. */
describe("FR-ADM-002 accounts, roles and permissions", () => {
  it("happy path: a class/role change takes effect immediately without re-login", () => {
    const { ctx } = makeHarness();
    const { school, campus } = seedSchoolWithAdmin(ctx);
    const classA = ctx.schools.createClass(school.id, campus.id, "8 Maths A");
    const classB = ctx.schools.createClass(school.id, campus.id, "8 Maths B");

    // A Teacher account exists and is logged in (holds a live session).
    const invited = ctx.invites.inviteTeacher(school.id, {
      email: "teacher@springfield.edu",
      firstName: "Tara",
      lastName: "Teach",
    });
    // inviteTeacher is async; resolve it.
    return invited.then((res) => {
      ctx.auth.acceptInvite(res.invite.token, "password123");
      const login = ctx.auth.login("teacher@springfield.edu", "password123");
      // Assign to class A first, then change to class B.
      const membership = ctx.store.listMembershipsByUser(res.user.id).find((m) => m.role === "teacher")!;
      ctx.accounts.changeMembership(membership.id, { classId: classA.id });
      ctx.accounts.changeMembership(membership.id, { classId: classB.id });

      // Same session token — no re-login — reflects the new class immediately.
      const authz = ctx.auth.authorize(login.token);
      expect(authz.memberships.find((m) => m.role === "teacher")?.classId).toBe(classB.id);
    });
  });

  it("edge — removing the only Admin is blocked until another Admin is designated", () => {
    const { ctx } = makeHarness();
    const { school, admin } = seedSchoolWithAdmin(ctx);

    // Only one Admin -> removal blocked.
    expect(() =>
      ctx.accounts.removeOrDowngradeAdmin(admin.membership.id, { remove: true }),
    ).toThrow(ConflictError);

    // Designate a second Admin, then the first can be removed.
    const second = ctx.accounts.createAccount({
      schoolId: school.id,
      role: "admin",
      email: "admin2@springfield.edu",
      firstName: "Bob",
      lastName: "Boss",
    });
    expect(() =>
      ctx.accounts.removeOrDowngradeAdmin(admin.membership.id, { remove: true }),
    ).not.toThrow();
    expect(ctx.store.getMembership(admin.membership.id)).toBeUndefined();
    expect(ctx.store.getMembership(second.membership.id)).toBeDefined();
  });

  it("edge — student transferred mid-term: active workspace is Class B, Class A history stays visible to the original Teacher", () => {
    const { ctx } = makeHarness();
    const { school, campus } = seedSchoolWithAdmin(ctx);
    const classA = ctx.schools.createClass(school.id, campus.id, "Class A");
    const classB = ctx.schools.createClass(school.id, campus.id, "Class B");

    const teacherA = ctx.accounts.createAccount({
      schoolId: school.id,
      role: "teacher",
      email: "teacherA@springfield.edu",
      firstName: "Ann",
      lastName: "A",
      classId: classA.id,
    });
    const student = ctx.accounts.createAccount({
      schoolId: school.id,
      role: "student",
      email: "student@springfield.edu",
      firstName: "Sam",
      lastName: "Student",
    });
    ctx.accounts.enrolStudent(student.user.id, classA.id);

    ctx.accounts.transferStudent(student.user.id, classB.id);

    // Active workspace reflects Class B.
    expect(ctx.store.getActiveEnrolmentForStudent(student.user.id)?.classId).toBe(classB.id);

    // Class A history remains visible to the original Teacher.
    const historyForTeacherA = ctx.store.listEnrolmentHistoryByTeacher(teacherA.user.id);
    expect(historyForTeacherA).toHaveLength(1);
    expect(historyForTeacherA[0]?.classId).toBe(classA.id);
    expect(historyForTeacherA[0]?.studentId).toBe(student.user.id);
  });
});
