import { NotFoundError } from "../domain/errors";
import type { Classification } from "../domain/content";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";
import type { StoragePort } from "../ports/storagePort";

/** Confidence below this is surfaced as low-confidence (FR-CONT-002). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * FR-CONT-002 — AI-suggested classification. Every classification runs through
 * the single AI service layer (which enforces residency and audits the call).
 * Suggestions start "suggested" and are excluded from the approved pool until a
 * Teacher approves or edits them.
 */
export class ClassificationService {
  constructor(
    private readonly content: ContentStore,
    private readonly storage: StoragePort,
    private readonly ai: AiServiceLayer,
    private readonly audit: AuditRecorder,
  ) {}

  async classify(contentItemId: string, actorId: string | null = null): Promise<Classification> {
    const item = await this.content.getContentItem(contentItemId);
    if (!item) throw new NotFoundError("Content item not found.");
    const version = await this.content.getContentVersion(item.currentVersionId);
    const text = version ? this.storage.get(version.storageKey)?.text ?? "" : "";

    // The ONLY path to an LLM — the service layer guards residency and audits.
    const completion = await this.ai.run(
      {
        purpose: "content.classify",
        prompt: `Classify this teaching material by subject, year, topic, outcome and difficulty:\n\n${text}`,
        input: { text },
        containsStudentData: true,
      },
      actorId,
    );

    const parsed = parseClassification(completion.text);
    const classification: Classification = {
      id: newId(),
      contentItemId,
      subject: parsed.subject,
      year: parsed.year,
      topic: parsed.topic,
      outcome: parsed.outcome,
      difficulty: parsed.difficulty,
      confidence: parsed.confidence,
      lowConfidence: parsed.confidence < LOW_CONFIDENCE_THRESHOLD,
      status: "suggested",
      reviewedByTeacherId: null,
    };
    await this.content.upsertClassification(classification);
    this.audit.append({
      action: "content.classified",
      actorId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { confidence: classification.confidence, lowConfidence: classification.lowConfidence },
    });
    return classification;
  }

  /** A Teacher edits the suggestion; the correction is stored as approved. */
  async editClassification(
    contentItemId: string,
    teacherId: string,
    changes: Partial<Pick<Classification, "subject" | "year" | "topic" | "outcome" | "difficulty">>,
  ): Promise<Classification> {
    const current = await this.content.getClassificationByItem(contentItemId);
    if (!current) throw new NotFoundError("No classification to edit.");
    const updated: Classification = {
      ...current,
      ...changes,
      status: "approved",
      reviewedByTeacherId: teacherId,
    };
    await this.content.upsertClassification(updated);
    this.audit.append({
      action: "content.classification.edited",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { fields: Object.keys(changes) },
    });
    return updated;
  }

  /** A Teacher accepts the suggestion as-is. */
  async approveClassification(contentItemId: string, teacherId: string): Promise<Classification> {
    const current = await this.content.getClassificationByItem(contentItemId);
    if (!current) throw new NotFoundError("No classification to approve.");
    const updated: Classification = { ...current, status: "approved", reviewedByTeacherId: teacherId };
    await this.content.upsertClassification(updated);
    this.audit.append({
      action: "content.classification.approved",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: {},
    });
    return updated;
  }

  getClassification(contentItemId: string): Promise<Classification | undefined> {
    return this.content.getClassificationByItem(contentItemId);
  }
}

interface ParsedClassification {
  subject: string;
  year: number;
  topic: string;
  outcome: string;
  difficulty: string;
  confidence: number;
}

function parseClassification(text: string): ParsedClassification {
  try {
    const raw = JSON.parse(text) as Partial<ParsedClassification>;
    return {
      subject: raw.subject ?? "Unknown",
      year: typeof raw.year === "number" ? raw.year : 0,
      topic: raw.topic ?? "Unclassified",
      outcome: raw.outcome ?? "UNMAPPED",
      difficulty: raw.difficulty ?? "medium",
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    };
  } catch {
    // A non-JSON model response is treated as a zero-confidence suggestion.
    return { subject: "Unknown", year: 0, topic: "Unclassified", outcome: "UNMAPPED", difficulty: "medium", confidence: 0 };
  }
}
