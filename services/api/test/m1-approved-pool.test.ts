import { describe, expect, it } from "vitest";
import {
  makeApprovedContent,
  makeHarness,
  makeTeacher,
  seedSchoolWithAdmin,
  testHash,
} from "./helpers";

/**
 * The teacher-approval gate is load-bearing: the approved pool is the ONLY set
 * downstream features read, and pending/unreviewed/unattested/un-ingested/
 * archived content must never appear in it. (Milestone 1 definition of done.)
 */
describe("M1 approved-content pool gate", () => {
  it("a fully approved item appears; pending variants never do", async () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const t = teacher.user.id;

    // 1) Fully approved → in the pool.
    const approvedId = await makeApprovedContent(ctx, school.id, t, { title: "Approved" });

    // 2) Uploaded only (no ingest/classify/approve/attest) → excluded.
    const rawUpload = ctx.content.uploadOne(school.id, t, {
      title: "Raw", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("raw"), source: { text: "# X\nhi" },
    });
    if (rawUpload.status !== "accepted") throw new Error("unreachable");

    // 3) Ingested + classified but NOT approved → excluded.
    const partial = ctx.content.uploadOne(school.id, t, {
      title: "Partial", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("partial"), source: { text: "# Algebra\n2x=4" },
    });
    if (partial.status !== "accepted") throw new Error("unreachable");
    ctx.ingestion.ingest(ctx.contentStore.getContentItem(partial.contentItemId)!.currentVersionId, t);
    await ctx.classification.classify(partial.contentItemId, t); // suggested only
    ctx.content.attestRights(partial.contentItemId, t);

    const pool = ctx.content.approvedPool(school.id).map((i) => i.id);
    expect(pool).toContain(approvedId);
    expect(pool).not.toContain(rawUpload.contentItemId);
    expect(pool).not.toContain(partial.contentItemId);
    expect(pool).toHaveLength(1);
  });

  it("archiving an approved item removes it from the pool", async () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const id = await makeApprovedContent(ctx, school.id, teacher.user.id);
    expect(ctx.content.approvedPool(school.id).map((i) => i.id)).toContain(id);

    ctx.content.archive(id, teacher.user.id, { confirm: true });
    expect(ctx.content.approvedPool(school.id)).toHaveLength(0);
  });

  it("adding a new version returns an approved item to draft (out of the pool until re-approved)", async () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const id = await makeApprovedContent(ctx, school.id, teacher.user.id);
    expect(ctx.content.approvedPool(school.id)).toHaveLength(1);

    ctx.content.addVersion(id, teacher.user.id, { title: "rev", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("rev") });
    expect(ctx.content.approvedPool(school.id)).toHaveLength(0);
  });
});
