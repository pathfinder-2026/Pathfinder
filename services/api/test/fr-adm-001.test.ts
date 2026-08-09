import { describe, expect, it } from "vitest";
import { ConfirmationRequiredError, ValidationError } from "../src/domain/errors";
import { makeHarness, VALID_YEAR } from "./helpers";

/**
 * FR-ADM-001 — Create school account; manage campuses, academic years, terms.
 * One test per Given/When/Then acceptance row.
 */
describe("FR-ADM-001 create school; campuses, academic years, terms", () => {
  it("happy path: creates the school and lets the Admin proceed to invite staff", () => {
    const { ctx } = makeHarness();
    const result = ctx.schools.createSchool({
      name: "Springfield High",
      campusName: "Main Campus",
      academicYear: VALID_YEAR,
    });

    expect(ctx.store.getSchool(result.school.id)).toBeDefined();
    expect(ctx.store.listCampusesBySchool(result.school.id)).toHaveLength(1);
    expect(result.campus.setupComplete).toBe(true);
    expect(ctx.store.listAcademicYearsBySchool(result.school.id)).toHaveLength(1);
    expect(result.terms).toHaveLength(2);
    // "can proceed to invite staff": the school now exists to invite into.
    expect(() =>
      ctx.invites.inviteTeacher(result.school.id, {
        email: "t@springfield.edu",
        firstName: "Tom",
        lastName: "Teach",
      }),
    ).not.toThrow();
    // Significant admin action was audited.
    expect(ctx.audit.find((e) => e.action === "school.created")).toHaveLength(1);
  });

  it("edge — duplicate school name: warns and requires confirmation before proceeding", () => {
    const { ctx } = makeHarness();
    ctx.schools.createSchool({ name: "Acme College", campusName: "A", academicYear: VALID_YEAR });

    // Second creation with the same name is blocked pending confirmation.
    let thrown: unknown;
    try {
      ctx.schools.createSchool({ name: "Acme College", campusName: "B", academicYear: VALID_YEAR });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfirmationRequiredError);
    expect((thrown as ConfirmationRequiredError).code).toBe("DUPLICATE_SCHOOL_NAME");

    // Confirming proceeds and creates the second school.
    const confirmed = ctx.schools.createSchool({
      name: "Acme College",
      campusName: "B",
      academicYear: VALID_YEAR,
      confirmDuplicate: true,
    });
    expect(confirmed.school.id).toBeDefined();
  });

  it("edge — campus added later: inherits global settings, may have its own year/terms", () => {
    const { ctx } = makeHarness();
    const { school } = ctx.schools.createSchool({
      name: "Riverdale",
      campusName: "North",
      academicYear: VALID_YEAR,
      settings: { timezone: "Australia/Sydney", defaultCurriculum: "NSW" },
    });

    const added = ctx.schools.addCampus(school.id, {
      name: "South",
      academicYear: { name: "2026 South", terms: VALID_YEAR.terms },
    });

    // Inherits the school's global settings...
    expect(added.campus.settings).toEqual(school.settings);
    // ...but can carry its own academic year/terms.
    expect(added.academicYear).not.toBeNull();
    expect(added.academicYear?.campusId).toBe(added.campus.id);
    expect(added.terms).toHaveLength(2);
  });

  it("edge — incomplete term dates: blocks saving with a validation error", () => {
    const { ctx } = makeHarness();

    // Missing end date.
    expect(() =>
      ctx.schools.createSchool({
        name: "Blank Dates School",
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "Term 1", startDate: "2026-01-28", endDate: "" }] },
      }),
    ).toThrow(ValidationError);

    // End before start.
    expect(() =>
      ctx.schools.createSchool({
        name: "Backwards Dates School",
        campusName: "Main",
        academicYear: {
          name: "2026",
          terms: [{ name: "Term 1", startDate: "2026-04-10", endDate: "2026-01-28" }],
        },
      }),
    ).toThrow(ValidationError);

    // Nothing was persisted.
    expect(ctx.store.findSchoolByName("Blank Dates School")).toBeUndefined();
    expect(ctx.store.findSchoolByName("Backwards Dates School")).toBeUndefined();
  });
});
