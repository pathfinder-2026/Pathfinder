import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/domain/errors";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/** FR-ADM-002 — Manage teacher/student accounts, roles and permissions. */
describe("FR-ADM-002 accounts, roles and permissions", () => {
  it("happy path: a class/role change takes effect immediately without re-login", async () => {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const classA = await ctx.schools.createClass(school.id, campus.id, "8 Maths A");
    const classB = await ctx.schools.createClass(school.id, campus.id, "8 Maths B");

    // A Teacher account exists and is logged in (holds a live session).
    const res = await ctx.invites.inviteTeacher(school.id, {
      email: "teacher@springfield.edu",
      firstName: "Tara",
      lastName: "Teach",
    });
    await ctx.auth.acceptInvite(res.invite.token, "password123");
    const login = await ctx.auth.login("teacher@springfield.edu", "password123");
    // Assign to class A first, then change to class B.
    const membership = (await ctx.store.listMembershipsByUser(res.user.id)).find((m) => m.role === "teacher")!;
    await ctx.accounts.changeMembership(membership.id, { classId: classA.id });
    await ctx.accounts.changeMembership(membership.id, { classId: classB.id });

    // Same session token — no re-login — reflects the new class immediately.
    const authz = await ctx.auth.authorize(login.token);
    expect(authz.memberships.find((m) => m.role === "teacher")?.classId).toBe(classB.id);
  });

  it("edge — removing the only Admin is blocked until another Admin is designated", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    // Only one Admin -> removal blocked.
    await expect(
      ctx.accounts.removeOrDowngradeAdmin(admin.membership.id, { remove: true }),
    ).rejects.toThrow(ConflictError);

    // Designate a second Admin, then the first can be removed.
    const second = await ctx.accounts.createAccount({
      schoolId: school.id,
      role: "admin",
      email: "admin2@springfield.edu",
      firstName: "Bob",
      lastName: "Boss",
    });
    await expect(
      ctx.accounts.removeOrDowngradeAdmin(admin.membership.id, { remove: true }),
    ).resolves.toBeUndefined();
    expect(await ctx.store.getMembership(admin.membership.id)).toBeUndefined();
    expect(await ctx.store.getMembership(second.membership.id)).toBeDefined();
  });

  it("edge — student transferred mid-term: active workspace is Class B, Class A history stays visible to the original Teacher", async () => {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const classA = await ctx.schools.createClass(school.id, campus.id, "Class A");
    const classB = await ctx.schools.createClass(school.id, campus.id, "Class B");

    const teacherA = await ctx.accounts.createAccount({
      schoolId: school.id,
      role: "teacher",
      email: "teacherA@springfield.edu",
      firstName: "Ann",
      lastName: "A",
      classId: classA.id,
    });
    const student = await ctx.accounts.createAccount({
      schoolId: school.id,
      role: "student",
      email: "student@springfield.edu",
      firstName: "Sam",
      lastName: "Student",
    });
    await ctx.accounts.enrolStudent(student.user.id, classA.id);

    await ctx.accounts.transferStudent(student.user.id, classB.id);

    // Active workspace reflects Class B.
    expect((await ctx.store.getActiveEnrolmentForStudent(student.user.id))?.classId).toBe(classB.id);

    // Class A history remains visible to the original Teacher.
    const historyForTeacherA = await ctx.store.listEnrolmentHistoryByTeacher(teacherA.user.id);
    expect(historyForTeacherA).toHaveLength(1);
    expect(historyForTeacherA[0]?.classId).toBe(classA.id);
    expect(historyForTeacherA[0]?.studentId).toBe(student.user.id);
  });
});
