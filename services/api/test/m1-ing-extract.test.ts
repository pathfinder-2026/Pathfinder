import { describe, expect, it } from "vitest";
import { TERMINAL_INGESTION } from "../src/domain/content";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";
import type { AppContext } from "../src/context";

/** FR-ING-001/002 — extract text/structure; generate concepts and chunks. */
describe("FR-ING-001/002 ingestion", () => {
  function upload(ctx: AppContext, schoolId: string, teacherId: string, source: { text?: string; scanned?: boolean; corrupt?: boolean }) {
    const up = ctx.content.uploadOne(schoolId, teacherId, {
      title: "Doc", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("ing"), source,
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    return ctx.contentStore.getContentItem(up.contentItemId)!.currentVersionId;
  }

  function setup() {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  it("happy path: a text-based PDF yields headings/paragraphs and concept-level chunks", () => {
    const { ctx, schoolId, teacherId } = setup();
    const versionId = upload(ctx, schoolId, teacherId, {
      text: "# Fractions\nAdd 1/2 and 1/3.\n# Decimals\nConvert 1/4 to a decimal.",
    });
    const result = ctx.ingestion.ingest(versionId, teacherId);
    expect(result.status).toBe("ingested");
    expect(result.chunks.map((c) => c.heading)).toEqual(["Fractions", "Decimals"]);
    expect(result.concepts.map((c) => c.name).sort()).toEqual(["Decimals", "Fractions"]);
    expect(ctx.contentStore.getContentVersion(versionId)?.ingestionStatus).toBe("ingested");
  });

  it("edge — a scanned PDF with no selectable text is flagged for OCR, not silently empty", () => {
    const { ctx, schoolId, teacherId } = setup();
    const versionId = upload(ctx, schoolId, teacherId, { scanned: true });
    const result = ctx.ingestion.ingest(versionId, teacherId);
    expect(result.status).toBe("needs_ocr");
    expect(result.chunks).toHaveLength(0); // flagged, not empty-chunked as "done"
    expect(TERMINAL_INGESTION.has(result.status)).toBe(true);
  });

  it("edge — a corrupted file resolves to a clear ingestion-failed status (never stuck processing)", () => {
    const { ctx, schoolId, teacherId } = setup();
    const versionId = upload(ctx, schoolId, teacherId, { corrupt: true });
    const result = ctx.ingestion.ingest(versionId, teacherId);
    expect(result.status).toBe("failed");
    // Terminal status, so the Teacher can re-upload rather than watch a spinner forever.
    expect(ctx.contentStore.getContentVersion(versionId)?.ingestionStatus).toBe("failed");
    expect(TERMINAL_INGESTION.has(result.status)).toBe(true);
  });
});
