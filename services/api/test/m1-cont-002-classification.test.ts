import { describe, expect, it } from "vitest";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/** FR-CONT-002 — AI-suggested classification. */
describe("FR-CONT-002 AI-suggested classification", () => {
  async function setupWithUpload(text: string) {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const up = ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "Worksheet",
      fileType: "pdf",
      sizeBytes: 1000,
      contentHash: testHash("cls"),
      source: { text },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    ctx.ingestion.ingest(ctx.contentStore.getContentItem(up.contentItemId)!.currentVersionId, teacher.user.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id, itemId: up.contentItemId };
  }

  it("happy path: subject/year/topic/outcome/difficulty suggestions appear for review", async () => {
    const { ctx, itemId, teacherId } = await setupWithUpload("# Algebra\nSolve 2x + 3 = 11 (a linear equation).");
    const c = await ctx.classification.classify(itemId, teacherId);
    expect(c.subject).toBe("Mathematics");
    expect(c.year).toBe(8);
    expect(c.topic).toBeTruthy();
    expect(c.outcome).toBeTruthy();
    expect(c.difficulty).toBeTruthy();
    expect(c.status).toBe("suggested"); // awaits teacher review
  });

  it("edge — low confidence is visibly flagged rather than presented as certain", async () => {
    const { ctx, itemId, teacherId } = await setupWithUpload(
      "# Mixed\nThis worksheet covers algebra equations AND photosynthesis in biology cells.",
    );
    const c = await ctx.classification.classify(itemId, teacherId);
    expect(c.lowConfidence).toBe(true);
    expect(c.confidence).toBeLessThan(0.6);
  });

  it("edge — teacher edits the classification and it persists (does not revert)", async () => {
    const { ctx, itemId, teacherId } = await setupWithUpload("# Algebra\n2x + 3 = 11");
    await ctx.classification.classify(itemId, teacherId);
    ctx.classification.editClassification(itemId, teacherId, { topic: "Linear Equations" });
    const reloaded = ctx.classification.getClassification(itemId);
    expect(reloaded?.topic).toBe("Linear Equations");
    expect(reloaded?.status).toBe("approved");
    expect(reloaded?.reviewedByTeacherId).toBe(teacherId);
  });

  it("edge — never reviewed: content is excluded from the approved-content pool", async () => {
    const { ctx, schoolId, itemId, teacherId } = await setupWithUpload("# Algebra\n2x + 3 = 11");
    await ctx.classification.classify(itemId, teacherId); // suggested, NOT reviewed
    ctx.content.attestRights(itemId, teacherId);
    // Still suggested-only → not approvable, and absent from the pool.
    expect(() => ctx.content.approveContent(itemId, teacherId)).toThrow(/classification not approved/);
    expect(ctx.content.approvedPool(schoolId)).toHaveLength(0);
  });
});
