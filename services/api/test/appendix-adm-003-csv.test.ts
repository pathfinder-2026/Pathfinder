import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";
import type { AppContext } from "../src/context";

/**
 * Appendix Milestone A — FR-ADM-003: CSV import (+ the SSO domain-mismatch row,
 * which lives in this requirement's acceptance table). One test per Given/When/Then.
 */

async function schoolWithClass(ctx: AppContext, className = "8A") {
  const { school, campus, admin } = await seedSchoolWithAdmin(ctx, `CSV School ${Math.random().toString(36).slice(2, 8)}`);
  const klass = await ctx.schools.createClass(school.id, campus.id, className, admin.user.id, "8");
  return { schoolId: school.id, adminId: admin.user.id, classId: klass.id, className };
}

const HEADER = "firstName,lastName,email,role,class";

describe("FR-ADM-003 — CSV import", () => {
  it("happy path: a correct CSV of 200 students creates 200 accounts with the right role + class", async () => {
    const { ctx } = makeHarness();
    const { schoolId, adminId, classId, className } = await schoolWithClass(ctx);

    const rows = Array.from({ length: 200 }, (_, i) => `First${i},Last${i},student${i}@springfield.edu,student,${className}`);
    const csv = [HEADER, ...rows].join("\n");

    const result = await ctx.csvImport.importUsers(schoolId, csv, adminId);

    expect(result.imported).toHaveLength(200);
    expect(result.rejected).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);

    // Correct role + class assignment (spot-check one imported account end-to-end).
    const sample = result.imported[0]!;
    expect(sample.classId).toBe(classId);
    const memberships = await ctx.store.listMembershipsByUser(sample.userId);
    expect(memberships[0]!.role).toBe("student");
    expect(memberships[0]!.classId).toBe(classId);
    const enrolment = await ctx.store.getActiveEnrolmentForStudent(sample.userId);
    expect(enrolment?.classId).toBe(classId);
  });

  it("malformed rows: 5 rows missing required fields are each rejected with a specific error, valid rows still import", async () => {
    const { ctx } = makeHarness();
    const { schoolId, adminId, className } = await schoolWithClass(ctx);

    const csv = [
      HEADER,
      `Ada,Valid,ada@springfield.edu,student,${className}`, // valid
      `,Nolast,noname@springfield.edu,student,${className}`, // missing firstName
      `Bob,,nolast@springfield.edu,student,${className}`, // missing lastName
      `Cara,Noemail,,student,${className}`, // missing email
      `Dan,Norole,dan@springfield.edu,,${className}`, // missing role
      `Eve,Noclass,eve@springfield.edu,student,`, // missing class
      `Finn,Valid,finn@springfield.edu,student,${className}`, // valid
    ].join("\n");

    const result = await ctx.csvImport.importUsers(schoolId, csv, adminId);

    expect(result.imported).toHaveLength(2);
    expect(result.rejected).toHaveLength(5);
    // Each rejection names the specific problem field, and points at its own row.
    const byLine = Object.fromEntries(result.rejected.map((r) => [r.line, r.errors.join("; ")]));
    expect(byLine[3]).toContain("firstName");
    expect(byLine[4]).toContain("lastName");
    expect(byLine[5]).toContain("email");
    expect(byLine[6]).toContain("role");
    expect(byLine[7]).toContain("class");
  });

  it("duplicate emails (existing + in-file): flagged as duplicate and skipped, never creating a conflicting account", async () => {
    const { ctx } = makeHarness();
    const { schoolId, adminId, className } = await schoolWithClass(ctx);

    // An account that already exists in the system.
    await ctx.accounts.createAccount({ schoolId, role: "student", email: "existing@springfield.edu", firstName: "Al", lastName: "Ready", classId: null });

    const csv = [
      HEADER,
      `Dupe,System,existing@springfield.edu,student,${className}`, // dup of existing account
      `New,Person,new@springfield.edu,student,${className}`, // fresh
      `Dupe,Infile,new@springfield.edu,student,${className}`, // dup of the row above
    ].join("\n");

    const result = await ctx.csvImport.importUsers(schoolId, csv, adminId);

    expect(result.imported.map((i) => i.email)).toEqual(["new@springfield.edu"]);
    expect(result.duplicates.map((d) => d.email).sort()).toEqual(["existing@springfield.edu", "new@springfield.edu"]);

    // No conflicting account: the pre-existing email still resolves to exactly one user.
    const existingId = await ctx.store.findUserIdByEmail("existing@springfield.edu");
    expect(existingId).toBeTruthy();
    const all = await ctx.store.listUsersBySchool(schoolId);
    const withExisting = await Promise.all(all.map(async (u) => (await ctx.store.getPersonalData(u.id))?.email));
    expect(withExisting.filter((e) => e === "existing@springfield.edu")).toHaveLength(1);
  });

  it("spreadsheet formula injection (NEW v1.4): the cell is sanitised to inert text, the row imports flagged for review, and no export ever emits an evaluable cell", async () => {
    const { ctx } = makeHarness();
    const { schoolId, adminId, className } = await schoolWithClass(ctx);

    const csv = [
      HEADER,
      `=SUM(1+1),Hacker,inject@springfield.edu,student,${className}`, // formula in firstName
      `Plain,Student,plain@springfield.edu,student,${className}`, // ordinary
    ].join("\n");

    const result = await ctx.csvImport.importUsers(schoolId, csv, adminId);

    expect(result.imported).toHaveLength(2);
    expect(result.flaggedForReview).toBe(1);
    const flagged = result.imported.find((i) => i.flaggedForReview)!;
    expect(flagged.email).toBe("inject@springfield.edu");

    // Stored value is neutralised (leading apostrophe => literal text in a spreadsheet).
    const pii = await ctx.store.getPersonalData(flagged.userId);
    expect(pii!.firstName.startsWith("'=")).toBe(true);

    // The export never emits a cell a spreadsheet would evaluate.
    const exported = await ctx.csvImport.exportUsersCsv(schoolId);
    for (const line of exported.split("\n").slice(1)) {
      for (const cell of line.split(",")) {
        const bare = cell.replace(/^"|"$/g, "");
        expect(["=", "+", "@"].includes(bare[0] ?? "")).toBe(false);
        // a lone leading '-' (from a negative) would also be neutralised
        if (bare[0] === "-") expect(bare.startsWith("'")).toBe(true);
      }
    }
  });

  it("SSO domain mismatch: a sign-in from outside the configured domain is denied with a clear message", async () => {
    const { ctx } = makeHarness();
    const { schoolId, adminId } = await schoolWithClass(ctx);

    await ctx.sso.configure(schoolId, { provider: "google", domain: "school.edu" }, adminId);

    const err = await ctx.sso.signIn(schoolId, "google", { email: "intruder@outside.com" }).catch((e) => e);
    expect(err.code).toBe("SSO_DOMAIN_MISMATCH");
    expect(err.message).toMatch(/school\.edu/);
    expect(err.message).toMatch(/denied/i);
  });
});
