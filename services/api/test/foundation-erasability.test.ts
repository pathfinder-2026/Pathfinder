import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/**
 * Foundational Decision 6 — data minimisation & per-student erasability. A
 * data-subject erasure removes the PII while retaining the structural id and
 * the append-only audited facts about the person ("erase the person, keep the
 * immutable record of the action").
 */
describe("Foundation — minimised data model & per-student erasure", () => {
  it("erasing a student removes PII but keeps the user record and audited facts", () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const student = ctx.accounts.createAccount({
      schoolId: school.id,
      role: "student",
      email: "erase.me@springfield.edu",
      firstName: "Erase",
      lastName: "Me",
    });

    // A fact about the student is recorded in the audit log.
    ctx.audit.append({
      action: "student.enrolled",
      actorId: null,
      subjectType: "user",
      subjectId: student.user.id,
      metadata: {},
    });
    expect(ctx.store.getPersonalData(student.user.id)).toBeDefined();

    ctx.accounts.erasePersonalData(student.user.id);

    // PII is gone...
    expect(ctx.store.getPersonalData(student.user.id)).toBeUndefined();
    expect(ctx.store.findUserIdByEmail("erase.me@springfield.edu")).toBeUndefined();
    // ...but the structural record remains (tombstoned) and facts are retained.
    expect(ctx.store.getUser(student.user.id)?.status).toBe("erased");
    const facts = ctx.audit.find((e) => e.subjectId === student.user.id);
    expect(facts.length).toBeGreaterThanOrEqual(2); // enrolled + erased
    expect(ctx.audit.verifyChain()).toBe(true);
  });

  it("PII lives only in personal_data, not on the structural user record", () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const student = ctx.accounts.createAccount({
      schoolId: school.id,
      role: "student",
      email: "pii@springfield.edu",
      firstName: "Pia",
      lastName: "Ai",
    });
    const user = ctx.store.getUser(student.user.id)!;
    expect(JSON.stringify(user)).not.toContain("pii@springfield.edu");
    expect(JSON.stringify(user)).not.toContain("Pia");
  });
});
