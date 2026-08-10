import { describe, expect, it } from "vitest";
import { TERMINAL_INGESTION, type IngestionStatus } from "../src/domain/content";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";
import type { AppContext } from "../src/context";

/**
 * NFR-PERF-001 (M1 slice): uploads must always resolve to a status rather than
 * hanging — no silent spinner. Ingestion always reaches a terminal state, fast.
 */
describe("NFR-PERF-001 ingestion always resolves to a terminal status", () => {
  function ingestSource(ctx: AppContext, schoolId: string, teacherId: string, source: { text?: string; scanned?: boolean; corrupt?: boolean }) {
    const up = ctx.content.uploadOne(schoolId, teacherId, {
      title: "Doc", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("perf"), source,
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    return ctx.ingestion.ingest(ctx.contentStore.getContentItem(up.contentItemId)!.currentVersionId, teacherId);
  }

  it("every ingestion input lands on a terminal status well within target", () => {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const t = teacher.user.id;

    const cases: Array<{ text?: string; scanned?: boolean; corrupt?: boolean }> = [
      { text: "# H\nbody text here" },
      { scanned: true },
      { corrupt: true },
    ];
    const NFR_UPLOAD_STATUS_TARGET_MS = 5000;
    for (const source of cases) {
      const result = ingestSource(ctx, school.id, t, source);
      const status: IngestionStatus = result.status;
      expect(TERMINAL_INGESTION.has(status)).toBe(true); // never left "processing"
      expect(result.elapsedMs).toBeLessThan(NFR_UPLOAD_STATUS_TARGET_MS);
    }
  });
});
