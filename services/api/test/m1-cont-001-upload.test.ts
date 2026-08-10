import { describe, expect, it } from "vitest";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/** FR-CONT-001 — Upload notes/slides/PDFs/videos/links/etc. */
describe("FR-CONT-001 upload teaching materials", () => {
  function setup() {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: multiple files upload at once and appear with the correct file type", () => {
    const { ctx, schoolId, teacherId } = setup();
    const results = ctx.content.uploadMany(schoolId, teacherId, [
      { title: "Slides", fileType: "pptx", sizeBytes: 1000, contentHash: testHash("a") },
      { title: "Worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("b") },
      { title: "Notes", fileType: "docx", sizeBytes: 1000, contentHash: testHash("c") },
    ]);
    expect(results.every((r) => r.status === "accepted")).toBe(true);
    const library = ctx.contentStore.listContentItemsBySchool(schoolId);
    expect(library).toHaveLength(3);
    const types = library
      .map((i) => ctx.contentStore.getContentVersion(i.currentVersionId)?.fileType)
      .sort();
    expect(types).toEqual(["docx", "pdf", "pptx"]);
  });

  it("edge — unsupported file type is rejected listing supported formats", () => {
    const { ctx, schoolId, teacherId } = setup();
    const result = ctx.content.uploadOne(schoolId, teacherId, {
      title: "Archive",
      fileType: "zip",
      sizeBytes: 1000,
      contentHash: testHash("zip"),
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_file_type");
    expect(result.message).toMatch(/Supported formats:/);
    expect(ctx.contentStore.listContentItemsBySchool(schoolId)).toHaveLength(0);
  });

  it("edge — oversized file stops early with a clear size-limit message", () => {
    const { ctx, schoolId, teacherId } = setup();
    const result = ctx.content.uploadOne(schoolId, teacherId, {
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

  it("edge — duplicate upload completes but is flagged a likely duplicate", () => {
    const { ctx, schoolId, teacherId } = setup();
    const hash = testHash("dup");
    ctx.content.uploadOne(schoolId, teacherId, { title: "Worksheet", fileType: "pdf", sizeBytes: 1000, contentHash: hash });
    const second = ctx.content.uploadOne(schoolId, teacherId, { title: "Worksheet (again)", fileType: "pdf", sizeBytes: 1000, contentHash: hash });
    expect(second.status).toBe("accepted");
    if (second.status !== "accepted") throw new Error("unreachable");
    expect(second.flags).toContain("likely_duplicate");
    expect(second.duplicateOfId).toBeDefined();
  });

  it("edge (NEW v1.4) — a file failing the security scan is rejected, quarantined and logged", () => {
    const { ctx, schoolId, teacherId } = setup();
    const result = ctx.content.uploadOne(schoolId, teacherId, {
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
    expect(ctx.contentStore.listContentItemsBySchool(schoolId)).toHaveLength(0);
  });

  it("edge (NEW v1.4) — third-party copyright: unattested content is excluded from the approved pool", async () => {
    const { ctx, schoolId, teacherId } = setup();
    const up = ctx.content.uploadOne(schoolId, teacherId, {
      title: "Textbook excerpt",
      fileType: "pdf",
      sizeBytes: 1000,
      contentHash: testHash("cpr"),
      source: { text: "# Algebra\n2x + 3 = 11" },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = ctx.contentStore.getContentItem(up.contentItemId)!;
    ctx.ingestion.ingest(item.currentVersionId, teacherId);
    await ctx.classification.classify(up.contentItemId, teacherId);
    ctx.classification.approveClassification(up.contentItemId, teacherId);
    // Rights NOT attested → cannot approve into the pool, and pool excludes it.
    expect(() => ctx.content.approveContent(up.contentItemId, teacherId)).toThrow(/rights not attested/);
    expect(ctx.content.approvedPool(schoolId)).toHaveLength(0);

    // After attesting, it can be approved and enters the pool.
    ctx.content.attestRights(up.contentItemId, teacherId);
    ctx.content.approveContent(up.contentItemId, teacherId);
    expect(ctx.content.approvedPool(schoolId).map((i) => i.id)).toContain(up.contentItemId);
  });
});
