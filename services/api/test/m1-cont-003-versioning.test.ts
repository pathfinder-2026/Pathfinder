import { describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/** FR-CONT-003 — Organise content; versioning, duplicate detection, archiving. */
describe("FR-CONT-003 versioning, duplicates, archiving", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: a revised version retains the old one in history and becomes current", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const up = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("v1"),
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const v2 = await ctx.content.addVersion(up.contentItemId, teacherId, {
      title: "Worksheet", fileType: "pdf", sizeBytes: 1200, contentHash: testHash("v2"),
    });
    const history = await ctx.contentStore.listVersionsByItem(up.contentItemId);
    expect(history).toHaveLength(2); // old retained
    expect((await ctx.contentStore.getContentItem(up.contentItemId))?.currentVersionId).toBe(v2.id);
    expect(v2.versionNumber).toBe(2);
  });

  it("edge — near-duplicate content is flagged for teacher review, not auto-merged", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const textA = "the quick brown fox jumps over the lazy dog near the river bank today";
    const textB = "the quick brown fox jumps over the lazy dog near the river bank tomorrow";
    await ctx.content.uploadOne(schoolId, teacherId, { title: "A", fileType: "txt", sizeBytes: 100, contentHash: testHash("na"), source: { text: textA } });
    const second = await ctx.content.uploadOne(schoolId, teacherId, { title: "B", fileType: "txt", sizeBytes: 100, contentHash: testHash("nb"), source: { text: textB } });
    expect(second.status).toBe("accepted");
    if (second.status !== "accepted") throw new Error("unreachable");
    expect(second.flags).toContain("likely_duplicate"); // flagged, not rejected/merged
  });

  it("edge — archiving content in active use warns before confirming", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const up = await ctx.content.uploadOne(schoolId, teacherId, { title: "In use", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("arch") });
    if (up.status !== "accepted") throw new Error("unreachable");
    // Simulate an active assignment referencing this content.
    await ctx.contentStore.insertReference({ id: newId(), contentItemId: up.contentItemId, refType: "assignment", refId: "assign-1", active: true });

    const warned = await ctx.content.archive(up.contentItemId, teacherId);
    expect(warned).toMatchObject({ archived: false, warning: "in-use", requiresConfirmation: true });

    const confirmed = await ctx.content.archive(up.contentItemId, teacherId, { confirm: true });
    expect(confirmed).toEqual({ archived: true });
    expect((await ctx.contentStore.getContentItem(up.contentItemId))?.archived).toBe(true);
  });

  it("edge (NEW v1.4) — concurrent edits both become versions; the later save doesn't overwrite", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const up = await ctx.content.uploadOne(schoolId, teacherId, { title: "Shared", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("c1") });
    if (up.status !== "accepted") throw new Error("unreachable");
    // Two teachers save near-simultaneously — each save is captured as a version.
    const edit1 = await ctx.content.addVersion(up.contentItemId, teacherId, { title: "Shared", fileType: "pdf", sizeBytes: 1100, contentHash: testHash("c2") });
    const edit2 = await ctx.content.addVersion(up.contentItemId, teacherId, { title: "Shared", fileType: "pdf", sizeBytes: 1200, contentHash: testHash("c3") });

    const history = await ctx.contentStore.listVersionsByItem(up.contentItemId);
    expect(history.map((v) => v.versionNumber)).toEqual([1, 2, 3]); // both edits retained
    expect(edit1.id).not.toBe(edit2.id);
    expect((await ctx.contentStore.getContentItem(up.contentItemId))?.currentVersionId).toBe(edit2.id);
  });
});
