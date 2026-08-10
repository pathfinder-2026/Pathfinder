import { NotFoundError } from "../domain/errors";
import type { Chunk, Concept, IngestionStatus } from "../domain/content";
import { TERMINAL_INGESTION } from "../domain/content";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";
import type { StoragePort } from "../ports/storagePort";
import type { TextExtractorPort } from "../ports/textExtractorPort";

export interface IngestionOutcome {
  status: IngestionStatus;
  chunks: Chunk[];
  concepts: Concept[];
  /** Wall-clock milliseconds for the ingest (NFR-PERF-001 observability). */
  elapsedMs: number;
}

/**
 * FR-ING-001/002 — extract text/structure and generate concept-level chunks.
 * Ingestion ALWAYS resolves to a terminal status (ingested / needs_ocr /
 * failed) — never left "processing" (NFR-PERF-001: no silent spinner).
 */
export class IngestionService {
  constructor(
    private readonly content: ContentStore,
    private readonly storage: StoragePort,
    private readonly extractor: TextExtractorPort,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async ingest(versionId: string, actorId: string | null = null): Promise<IngestionOutcome> {
    const start = this.clock.now().getTime();
    const version = await this.content.getContentVersion(versionId);
    if (!version) throw new NotFoundError("Content version not found.");

    await this.content.updateContentVersion({ ...version, ingestionStatus: "processing" });

    const stored = this.storage.get(version.storageKey);
    let status: IngestionStatus;
    const chunks: Chunk[] = [];
    const concepts: Concept[] = [];

    if (!stored) {
      status = "failed";
    } else {
      const extraction = this.extractor.extract(stored);
      if (extraction.kind === "error") {
        status = "failed";
      } else if (extraction.kind === "no_text") {
        status = "needs_ocr"; // scanned/image-only — flag for OCR, never empty chunks
      } else {
        let index = 0;
        for (const section of extraction.sections) {
          const chunk: Chunk = {
            id: newId(),
            contentVersionId: versionId,
            heading: section.heading,
            text: section.text,
            order: index++,
          };
          await this.content.insertChunk(chunk);
          chunks.push(chunk);
        }
        // Concepts: distinct section headings (deterministic; no LLM call).
        for (const name of new Set(extraction.sections.map((s) => s.heading))) {
          const concept: Concept = { id: newId(), contentVersionId: versionId, name };
          await this.content.insertConcept(concept);
          concepts.push(concept);
        }
        status = "ingested";
      }
    }

    await this.content.updateContentVersion({ ...version, ingestionStatus: status });
    this.audit.append({
      action: `content.ingest.${status}`,
      actorId,
      subjectType: "content",
      subjectId: version.contentItemId,
      metadata: { versionId, chunks: chunks.length, concepts: concepts.length },
    });

    // Invariant: ingestion must always land on a terminal status.
    if (!TERMINAL_INGESTION.has(status)) {
      throw new Error(`Ingestion resolved to non-terminal status "${status}"`);
    }
    return { status, chunks, concepts, elapsedMs: this.clock.now().getTime() - start };
  }
}
