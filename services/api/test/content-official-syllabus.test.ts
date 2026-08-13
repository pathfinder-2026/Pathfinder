import { describe, expect, it } from "vitest";
import { makeHarness, makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const NODE = "skill-add-fractions";

/**
 * Official syllabus tagging (ADR-0035): a content item can be marked as THE
 * syllabus for a subject + year, with a reference link the uploader provides
 * (NESA has no public API to fetch from). Purely a tag — the full approval
 * pipeline still gates whether the item can be mapped/used for grounding.
 */
describe("ContentService — official syllabus tagging and lookup", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("no syllabus on file for a subject/year that's never been tagged", async () => {
    const { ctx, schoolId } = await setup();
    expect(await ctx.content.getOfficialSyllabus(schoolId, "Mathematics", 8)).toBeUndefined();
  });

  it("tagging a content item makes it findable by subject + year", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const itemId = await makeMappedContent(ctx, schoolId, teacherId, NODE, { title: "NSW Maths Y8 Syllabus" });
    await ctx.content.markOfficialSyllabus(itemId, teacherId, {
      subject: "Mathematics",
      yearLevel: 8,
      sourceUrl: "https://curriculum.nsw.edu.au/example-maths-y8",
    });

    const found = await ctx.content.getOfficialSyllabus(schoolId, "Mathematics", 8);
    expect(found?.id).toBe(itemId);
    expect(found?.officialSyllabus).toEqual({
      subject: "Mathematics",
      yearLevel: 8,
      sourceUrl: "https://curriculum.nsw.edu.au/example-maths-y8",
    });

    // A different subject/year still finds nothing — the tag doesn't leak.
    expect(await ctx.content.getOfficialSyllabus(schoolId, "Mathematics", 9)).toBeUndefined();
    expect(await ctx.content.getOfficialSyllabus(schoolId, "Science", 8)).toBeUndefined();
  });

  it("re-tagging (a newer version replacing the old one) is what future lookups return", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const oldItemId = await makeMappedContent(ctx, schoolId, teacherId, NODE, { title: "Old syllabus" });
    await ctx.content.markOfficialSyllabus(oldItemId, teacherId, {
      subject: "Mathematics",
      yearLevel: 8,
      sourceUrl: "https://curriculum.nsw.edu.au/old",
    });

    const newItemId = await makeMappedContent(ctx, schoolId, teacherId, NODE, { title: "New syllabus" });
    await ctx.content.markOfficialSyllabus(newItemId, teacherId, {
      subject: "Mathematics",
      yearLevel: 8,
      sourceUrl: "https://curriculum.nsw.edu.au/new",
    });

    const found = await ctx.content.getOfficialSyllabus(schoolId, "Mathematics", 8);
    expect(found?.id).toBe(newItemId);
  });

  it("tagging does not bypass the approval pipeline — an unapproved item still isn't grounding-eligible", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    // Upload WITHOUT running it through ingest/classify/attest/approve.
    const up = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Draft syllabus",
      fileType: "pdf",
      sizeBytes: 100,
      contentHash: "hash-syllabus-unapproved",
      source: { text: "# Draft\nNot yet reviewed." },
    });
    if (up.status !== "accepted") throw new Error("upload not accepted");
    await ctx.content.markOfficialSyllabus(up.contentItemId, teacherId, {
      subject: "Mathematics",
      yearLevel: 8,
      sourceUrl: "https://curriculum.nsw.edu.au/draft",
    });

    const found = await ctx.content.getOfficialSyllabus(schoolId, "Mathematics", 8);
    expect(found?.id).toBe(up.contentItemId);
    // Tagged and findable, but still governance:"draft" — not in the approved pool.
    expect(found?.governance.status).toBe("draft");
    expect(await ctx.content.isInApprovedPool(up.contentItemId)).toBe(false);
  });
});
