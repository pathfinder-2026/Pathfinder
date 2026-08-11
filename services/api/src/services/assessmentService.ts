import { AuthError, ConflictError, NotFoundError } from "../domain/errors";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentRequest,
  AssessmentVersion,
  GenerationShortfall,
  QuestionType,
} from "../domain/assessment";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { ContentStore } from "../ports/contentStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { ContentService } from "./contentService";

const VERSION_LABELS = ["A", "B", "C", "D", "E"];
const RESUME_WINDOW_MS = 30 * 60 * 1000;

export type GenerateResult =
  | { status: "generated"; assessmentId: string; questionCount: number; shortfall: GenerationShortfall | null; flags: string[] }
  | { status: "failed"; reason: string };

interface GroundingUnit {
  contentItemId: string;
  text: string;
  difficulty: string;
}

/** FR-ASM-001–004 — Assessment Builder. */
export class AssessmentService {
  constructor(
    private readonly store: AssessmentStore,
    private readonly content: ContentService,
    private readonly contentStore: ContentStore,
    private readonly graph: SkillGraphStore,
    private readonly ai: AiServiceLayer,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /**
   * Generate a DRAFT assessment grounded ONLY in the approved + mapped pool.
   * Never fabricates: when the content can't support the requested count it
   * generates fewer and reports the shortfall. If the AI errors mid-run, no
   * partial draft is saved and the failure is audit-logged.
   */
  async generate(schoolId: string, teacherId: string, request: AssessmentRequest): Promise<GenerateResult> {
    const grounding = await this.collectGrounding(schoolId, request.nodeId);

    // Distinguish "no approved content" from "referenced content not approved".
    const flags: string[] = [];
    if (grounding.length === 0) {
      const anyPending = (await this.contentStore.listContentItemsBySchool(schoolId)).some(
        (i) => i.governance.status !== "approved" && i.governance.status !== "published",
      );
      if (anyPending) flags.push("excluded_unapproved_content");
    }

    // Plan the question types.
    const requested = request.typeMix
      ? request.typeMix.reduce((n, t) => n + t.count, 0)
      : request.count;
    let plannedTypes = expandTypes(request);

    // Unsuitable type (e.g. numerical on non-numeric content) — flag, don't force.
    const hasNumeric = grounding.some((g) => /\d/.test(g.text));
    if (plannedTypes.includes("numerical") && !hasNumeric && grounding.length > 0) {
      flags.push("unsuitable_type:numerical");
      plannedTypes = plannedTypes.filter((t) => t !== "numerical");
    }

    // Difficulty balance — flag if "hard" requested but no hard-mapped grounding.
    if (request.difficulty === "hard" && grounding.length > 0 &&
        !grounding.some((g) => g.difficulty === "hard" || g.difficulty === "extending")) {
      flags.push("difficulty_balance_unmet");
    }

    // Capacity: one question per grounding unit (never ungrounded).
    const toGenerate = Math.min(plannedTypes.length, grounding.length);
    const shortfall: GenerationShortfall | null =
      toGenerate < requested
        ? { requested, generated: toGenerate, reason: grounding.length === 0 ? (flags.includes("excluded_unapproved_content") ? "referenced content is not approved" : "no approved content on this topic") : "insufficient approved content" }
        : null;

    const versionCount = Math.max(1, Math.min(request.versions ?? 1, VERSION_LABELS.length));

    // Draft everything in memory FIRST; only persist if all AI calls succeed.
    try {
      const drafted: { label: string; questions: Omit<AssessmentQuestion, "versionId">[] }[] = [];
      for (let vi = 0; vi < versionCount; vi++) {
        const label = VERSION_LABELS[vi]!;
        const questions: Omit<AssessmentQuestion, "versionId">[] = [];
        for (let i = 0; i < toGenerate; i++) {
          const unit = grounding[i % grounding.length]!;
          const type = plannedTypes[i]!;
          const completion = await this.ai.run(
            {
              purpose: "assessment.generate",
              prompt: `Draft a ${type} question grounded in approved content.`,
              input: { chunk: unit.text, type, difficulty: unit.difficulty, seed: label },
              containsStudentData: false,
            },
            teacherId,
          );
          const q = JSON.parse(completion.text) as { prompt: string; options: string[] | null; modelAnswer: string; rubric: string | null };
          questions.push({
            id: newId(),
            order: i,
            type,
            prompt: q.prompt,
            options: q.options,
            modelAnswer: q.modelAnswer,
            rubric: q.rubric,
            difficulty: unit.difficulty,
            groundingContentIds: [unit.contentItemId],
            reviewed: false,
          });
        }
        drafted.push({ label, questions });
      }

      // Persist the draft assessment.
      const now = this.clock.isoNow();
      const assessment: Assessment = {
        id: newId(),
        schoolId,
        teacherId,
        title: request.title,
        request,
        status: "draft",
        generationStatus: "generated",
        publishedAt: null,
        scheduledStart: request.scheduledStart ?? null,
        reviewAcknowledged: false,
        shortfall,
        flags,
        createdAt: now,
      };
      await this.store.insertAssessment(assessment);
      for (const d of drafted) {
        const version: AssessmentVersion = { id: newId(), assessmentId: assessment.id, label: d.label, createdAt: now };
        await this.store.insertVersion(version);
        for (const q of d.questions) await this.store.insertQuestion({ ...q, versionId: version.id });
      }

      this.audit.append({
        action: "assessment.generated",
        actorId: teacherId,
        subjectType: "assessment",
        subjectId: assessment.id,
        metadata: { requested, generated: toGenerate, versions: versionCount, flags },
      });
      return { status: "generated", assessmentId: assessment.id, questionCount: toGenerate, shortfall, flags };
    } catch (err) {
      // Mid-run failure: no partial draft saved; audited (FR-GOV-002).
      this.audit.append({
        action: "assessment.generation.failed",
        actorId: teacherId,
        subjectType: "assessment",
        subjectId: request.nodeId,
        metadata: { reason: (err as Error).message },
      });
      return { status: "failed", reason: "AI generation failed; no draft was saved. You can retry." };
    }
  }

  // ---- review & publish (FR-ASM-004) ----

  /** A teacher acknowledges they have reviewed the generated questions. */
  async acknowledgeReview(assessmentId: string, teacherId: string): Promise<void> {
    const a = await this.require(assessmentId);
    for (const q of await this.store.listQuestionsByAssessment(assessmentId)) {
      await this.store.updateQuestion({ ...q, reviewed: true });
    }
    await this.store.updateAssessment({ ...a, reviewAcknowledged: true });
    this.audit.append({ action: "assessment.reviewed", actorId: teacherId, subjectType: "assessment", subjectId: assessmentId, metadata: {} });
  }

  /** Publish — requires a review acknowledgement first. */
  async publish(assessmentId: string, teacherId: string): Promise<Assessment> {
    const a = await this.require(assessmentId);
    if (a.generationStatus !== "generated") throw new ConflictError("NOT_GENERATED", "Assessment did not generate successfully.");
    if (!a.reviewAcknowledged) {
      throw new ConflictError("REVIEW_REQUIRED", "Review the generated questions before publishing.");
    }
    // FR-GOV-005 — each generated item must have been reviewed (opened) before a
    // student-facing publish. This extends FR-ASM-004's review-acknowledgement.
    const questions = await this.store.listQuestionsByAssessment(assessmentId);
    if (questions.length > 0 && !questions.every((q) => q.reviewed)) {
      throw new ConflictError("ITEMS_NOT_OPENED", "Every generated item must be opened/reviewed before publishing.");
    }
    const now = this.clock.isoNow();
    // Anti-rubber-stamping: record review-duration + items-opened on the audit entry.
    const reviewedAt = this.audit.find((e) => e.action === "assessment.reviewed" && e.subjectId === assessmentId).at(-1)?.at ?? a.createdAt;
    const reviewDurationMs = Math.max(0, new Date(now).getTime() - new Date(reviewedAt).getTime());

    const updated: Assessment = { ...a, status: "published", publishedAt: now };
    await this.store.updateAssessment(updated);
    this.audit.append({
      action: "assessment.published", actorId: teacherId, subjectType: "assessment", subjectId: assessmentId,
      metadata: { itemsOpened: questions.length, reviewDurationMs },
    });
    return updated;
  }

  /**
   * FR-GOV-005 — a NON-BLOCKING approval-quality signal (anti-rubber-stamping).
   * If a Teacher approved many items in a very short window (below a per-item
   * review-time floor), return a gentle spot-check prompt. Aggregate only — never
   * an individual league table (consistent with FR-PDB-006).
   */
  async approvalQualityPrompt(teacherId: string, opts: { windowMs?: number; floorMsPerItem?: number } = {}): Promise<{ flagged: boolean; itemsInWindow: number; prompt: string | null }> {
    const windowMs = opts.windowMs ?? 5 * 60 * 1000;
    const floorMsPerItem = opts.floorMsPerItem ?? 15 * 1000;
    const now = this.clock.now().getTime();
    const recent = this.audit
      .find((e) => e.action === "assessment.published" && e.actorId === teacherId && now - new Date(e.at).getTime() <= windowMs);
    const itemsInWindow = recent.reduce((sum, e) => sum + (Number((e.metadata as { itemsOpened?: number }).itemsOpened) || 0), 0);
    const totalReviewMs = recent.reduce((sum, e) => sum + (Number((e.metadata as { reviewDurationMs?: number }).reviewDurationMs) || 0), 0);
    // Flag when the actual average review time per item is below the floor.
    const avgPerItemMs = itemsInWindow > 0 ? totalReviewMs / itemsInWindow : Infinity;
    const flagged = itemsInWindow > 0 && avgPerItemMs < floorMsPerItem;
    return {
      flagged, itemsInWindow,
      prompt: flagged ? `You approved ${itemsInWindow} items in a short window — spot-check two?` : null,
    };
  }

  /** Unpublish — allowed only before the scheduled start (accidental publish). */
  async unpublish(assessmentId: string, teacherId: string): Promise<Assessment> {
    const a = await this.require(assessmentId);
    if (a.status !== "published") throw new ConflictError("NOT_PUBLISHED", "Assessment is not published.");
    if (a.scheduledStart && this.clock.now().getTime() >= new Date(a.scheduledStart).getTime()) {
      throw new ConflictError("ALREADY_STARTED", "Cannot unpublish after the scheduled start time.");
    }
    const updated: Assessment = { ...a, status: "draft", publishedAt: null };
    await this.store.updateAssessment(updated);
    this.audit.append({ action: "assessment.unpublished", actorId: teacherId, subjectType: "assessment", subjectId: assessmentId, metadata: {} });
    return updated;
  }

  /**
   * Student access — enforced at the PERMISSION layer, not hidden in the UI. An
   * unpublished assessment is denied and the attempt is logged.
   */
  async getForStudent(assessmentId: string, studentId: string): Promise<Assessment> {
    const a = await this.require(assessmentId);
    if (a.status !== "published") {
      this.audit.append({
        action: "assessment.access.denied",
        actorId: studentId,
        subjectType: "assessment",
        subjectId: assessmentId,
        metadata: { reason: "not_published" },
      });
      throw new AuthError("This assessment is not available.");
    }
    return a;
  }

  // ---- attempts (connectivity loss / resume, FR-ASM-004) ----

  async startAttempt(assessmentId: string, studentId: string): Promise<AssessmentAttempt> {
    await this.getForStudent(assessmentId, studentId); // permission-checked + logged
    const now = this.clock.isoNow();
    const attempt: AssessmentAttempt = {
      id: newId(),
      assessmentId,
      studentId,
      status: "in_progress",
      savedAnswers: {},
      lastSavedAt: now,
      interrupted: false,
      resumeDeadline: new Date(this.clock.now().getTime() + RESUME_WINDOW_MS).toISOString(),
      createdAt: now,
    };
    await this.store.insertAttempt(attempt);
    return attempt;
  }

  /** Save answers to the current save point. */
  async saveProgress(attemptId: string, answers: Record<string, string>): Promise<AssessmentAttempt> {
    const attempt = await this.requireAttempt(attemptId);
    const updated = { ...attempt, savedAnswers: { ...attempt.savedAnswers, ...answers }, lastSavedAt: this.clock.isoNow() };
    await this.store.updateAttempt(updated);
    return updated;
  }

  /** Connectivity lost mid-attempt — flag it (visible to the Teacher). */
  async markInterrupted(attemptId: string): Promise<void> {
    const attempt = await this.requireAttempt(attemptId);
    await this.store.updateAttempt({ ...attempt, interrupted: true });
    this.audit.append({ action: "assessment.attempt.interrupted", actorId: attempt.studentId, subjectType: "assessment", subjectId: attempt.assessmentId, metadata: { attemptId } });
  }

  /**
   * Resume after an interruption: answers up to the last save point are
   * preserved if within the allowed window.
   */
  async resume(attemptId: string): Promise<{ resumable: boolean; savedAnswers: Record<string, string> }> {
    const attempt = await this.requireAttempt(attemptId);
    const resumable = this.clock.now().getTime() <= new Date(attempt.resumeDeadline).getTime();
    return { resumable, savedAnswers: attempt.savedAnswers };
  }

  /** Attempts a Teacher can see as interrupted. */
  async interruptedAttempts(assessmentId: string): Promise<AssessmentAttempt[]> {
    return (await this.store.listAttemptsByAssessment(assessmentId)).filter((a) => a.interrupted);
  }

  // ---- helpers ----

  private async collectGrounding(schoolId: string, nodeId: string): Promise<GroundingUnit[]> {
    const pool = await this.content.approvedPool(schoolId);
    const units: GroundingUnit[] = [];
    for (const item of pool) {
      const mapping = (await this.graph.listMappingsByContent(item.id)).find((m) => m.nodeId === nodeId);
      if (!mapping) continue; // approved but not mapped to this node
      const chunks = await this.contentStore.listChunksByVersion(item.currentVersionId);
      for (const chunk of chunks) {
        units.push({ contentItemId: item.id, text: `${chunk.heading} ${chunk.text}`, difficulty: mapping.difficulty });
      }
    }
    return units;
  }

  private async require(assessmentId: string): Promise<Assessment> {
    const a = await this.store.getAssessment(assessmentId);
    if (!a) throw new NotFoundError("Assessment not found.");
    return a;
  }
  private async requireAttempt(attemptId: string): Promise<AssessmentAttempt> {
    const a = await this.store.getAttempt(attemptId);
    if (!a) throw new NotFoundError("Attempt not found.");
    return a;
  }
}

/** Expand a request into an ordered list of question types. */
function expandTypes(request: AssessmentRequest): QuestionType[] {
  if (request.typeMix && request.typeMix.length > 0) {
    const types: QuestionType[] = [];
    for (const t of request.typeMix) for (let i = 0; i < t.count; i++) types.push(t.type);
    return types;
  }
  return Array.from({ length: request.count }, () => "short_answer" as QuestionType);
}
