import { describe, expect, it } from "vitest";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/** FR-CONT-001 — Upload notes/slides/PDFs/videos/links/etc. */
describe("FR-CONT-001 upload teaching materials", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: multiple files upload at once and appear with the correct file type", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const results = await ctx.content.uploadMany(schoolId, teacherId, [
      { title: "Slides", fileType: "pptx", sizeBytes: 1000, contentHash: testHash("a") },
      { title: "Worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("b") },
      { title: "Notes", fileType: "docx", sizeBytes: 1000, contentHash: testHash("c") },
    ]);
    expect(results.every((r) => r.status === "accepted")).toBe(true);
    const library = await ctx.contentStore.listContentItemsBySchool(schoolId);
    expect(library).toHaveLength(3);
    const types: (string | undefined)[] = [];
    for (const i of library) {
      types.push((await ctx.contentStore.getContentVersion(i.currentVersionId))?.fileType);
    }
    expect(types.sort()).toEqual(["docx", "pdf", "pptx"]);
  });

  it("edge — unsupported file type is rejected listing supported formats", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const result = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Archive",
      fileType: "zip",
      sizeBytes: 1000,
      contentHash: testHash("zip"),
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_file_type");
    expect(result.message).toMatch(/Supported formats:/);
    expect(await ctx.contentStore.listContentItemsBySchool(schoolId)).toHaveLength(0);
  });

  it("edge — oversized file stops early with a clear size-limit message", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const result = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Huge lecture video",
      fileType: "mp4",
      sizeBytes: 800 * 1024 * 1024, // over the 500MB video limit
      contentHash: testHash("vid"),
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason).toBe("oversized");
    expect(result.message).toMatch(/limit/);
  });

  it("edge — duplicate upload completes but is flagged a likely duplicate", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const hash = testHash("dup");
    await ctx.content.uploadOne(schoolId, teacherId, { title: "Worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: hash });
    const second = await ctx.content.uploadOne(schoolId, teacherId, { title: "Worksheet (again)", fileType: "pdf", sizeBytes: 1000, contentHash: hash });
    expect(second.status).toBe("accepted");
    if (second.status !== "accepted") throw new Error("unreachable");
    expect(second.flags).toContain("likely_duplicate");
    expect(second.duplicateOfId).toBeDefined();
  });

  it("edge (NEW v1.4) — a file failing the security scan is rejected, quarantined and logged", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const result = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Suspicious.pdf",
      fileType: "pdf",
      sizeBytes: 1000,
      contentHash: testHash("mal"),
      source: { malware: true },
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason).toBe("quarantined");
    // The event is logged in the audit trail.
    expect(ctx.audit.find((e) => e.action === "content.upload.quarantined")).toHaveLength(1);
    // Nothing infected enters the library.
    expect(await ctx.contentStore.listContentItemsBySchool(schoolId)).toHaveLength(0);
  });

  it("edge (NEW v1.4) — third-party copyright: unattested content is excluded from the approved pool", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const up = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Textbook excerpt",
      fileType: "pdf",
      sizeBytes: 1000,
      contentHash: testHash("cpr"),
      source: { text: "# Algebra\n2x + 3 = 11" },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
    await ctx.ingestion.ingest(item.currentVersionId, teacherId);
    await ctx.classification.classify(up.contentItemId, teacherId);
    await ctx.classification.approveClassification(up.contentItemId, teacherId);
    // Rights NOT attested → cannot approve into the pool, and pool excludes it.
    await expect(ctx.content.approveContent(up.contentItemId, teacherId)).rejects.toThrow(/rights not attested/);
    expect(await ctx.content.approvedPool(schoolId)).toHaveLength(0);

    // After attesting, it can be approved and enters the pool.
    await ctx.content.attestRights(up.contentItemId, teacherId);
    await ctx.content.approveContent(up.contentItemId, teacherId);
    expect((await ctx.content.approvedPool(schoolId)).map((i) => i.id)).toContain(up.contentItemId);
  });
});
