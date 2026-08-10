import { describe, expect, it } from "vitest";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/** FR-CONT-004 — Share or restrict content by department or class. */
describe("FR-CONT-004 share/restrict content", () => {
  it("happy path: a class-restricted item is invisible to a teacher not in that class", () => {
    const { ctx } = makeHarness();
    const { school, campus } = seedSchoolWithAdmin(ctx);
    const class8A = ctx.schools.createClass(school.id, campus.id, "8A");
    const owner = makeTeacher(ctx, school.id, "owner@springfield.edu", { classId: class8A.id });
    const other = makeTeacher(ctx, school.id, "other@springfield.edu");

    const up = ctx.content.uploadOne(school.id, owner.user.id, {
      title: "8A worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("s1"),
      share: { type: "class", classId: class8A.id },
    });
    if (up.status !== "accepted") throw new Error("unreachable");

    const otherLibrary = ctx.content.browseSharedLibrary(other.user.id, school.id);
    expect(otherLibrary.map((i) => i.id)).not.toContain(up.contentItemId);
    // Owner still sees their own item.
    expect(ctx.content.browseSharedLibrary(owner.user.id, school.id).map((i) => i.id)).toContain(up.contentItemId);
  });

  it("edge — a student who changes class loses access to the restricted resource immediately", () => {
    const { ctx } = makeHarness();
    const { school, campus } = seedSchoolWithAdmin(ctx);
    const class8A = ctx.schools.createClass(school.id, campus.id, "8A");
    const class8B = ctx.schools.createClass(school.id, campus.id, "8B");
    const owner = makeTeacher(ctx, school.id, "owner@springfield.edu", { classId: class8A.id });
    const student = ctx.accounts.createAccount({ schoolId: school.id, role: "student", email: "stu@springfield.edu", firstName: "S", lastName: "T" });
    ctx.accounts.enrolStudent(student.user.id, class8A.id);

    const up = ctx.content.uploadOne(school.id, owner.user.id, {
      title: "8A only", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("s2"),
      share: { type: "class", classId: class8A.id },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = ctx.contentStore.getContentItem(up.contentItemId)!;

    expect(ctx.content.canView(item, student.user.id)).toBe(true);
    ctx.accounts.transferStudent(student.user.id, class8B.id);
    expect(ctx.content.canView(item, student.user.id)).toBe(false); // immediate
  });

  it("edge — a departing department member loses access, but the content remains for the rest", () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const owner = makeTeacher(ctx, school.id, "owner@springfield.edu", { department: "Mathematics" });
    const member = makeTeacher(ctx, school.id, "member@springfield.edu", { department: "Mathematics" });
    const stayer = makeTeacher(ctx, school.id, "stayer@springfield.edu", { department: "Mathematics" });

    const up = ctx.content.uploadOne(school.id, owner.user.id, {
      title: "Dept resource", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("s3"),
      share: { type: "department", department: "Mathematics" },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = ctx.contentStore.getContentItem(up.contentItemId)!;

    expect(ctx.content.canView(item, member.user.id)).toBe(true);
    // The member leaves the department.
    ctx.accounts.changeMembership(member.membership.id, { department: null });
    expect(ctx.content.canView(item, member.user.id)).toBe(false); // access revoked
    // Content remains for the rest of the department.
    expect(ctx.content.canView(item, stayer.user.id)).toBe(true);
    expect(ctx.contentStore.getContentItem(up.contentItemId)).toBeDefined();
  });
});
