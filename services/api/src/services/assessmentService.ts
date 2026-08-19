import { AuthError, ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { coveredNodeIds } from "../domain/assessment";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentRequest,
  AssessmentVersion,
  AttemptGradingResult,
  GenerationShortfall,
  QuestionType,
} from "../domain/assessment";
import type { NextActionKind } from "../domain/insights";
import { masteryLevel, type MasteryRecord } from "../domain/mastery";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { ContentStore } from "../ports/contentStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { ContentService } from "./contentService";
import { graphOfNode } from "./curriculumScope";
import { GroundingIndex, relevance } from "./grounding";

const VERSION_LABELS = ["A", "B", "C", "D", "E"];
const RESUME_WINDOW_MS = 30 * 60 * 1000;

export type GenerateResult =
  | { status: "generated"; assessmentId: string; questionCount: number; shortfall: GenerationShortfall | null; flags: string[] }
  | { status: "declined"; message: string; pendingContent: { id: string; title: string; status: string }[] }
  | { status: "failed"; reason: string };

interface GroundingUnit {
  contentItemId: string;
  text: string;
  difficulty: string;
  /** How far up the tree the mapping sat: 0 = the concept itself (see GroundingIndex). */
  distance: number;
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
    private readonly activity: ActivityStore,
  ) {}

  /**
   * Generate a DRAFT assessment grounded ONLY in the approved + mapped pool.
   * Never fabricates: when the content can't support the requested count it
   * generates fewer and reports the shortfall. If the AI errors mid-run, no
   * partial draft is saved and the failure is audit-logged.
   */
  async generate(schoolId: string, teacherId: string, request: AssessmentRequest): Promise<GenerateResult> {
    const nodeIds = coveredNodeIds(request);
    // The concepts' labels steer both WHICH sections ground the questions
    // (relevance ranking in collectGrounding) and WHAT each question must
    // assess (the `skill` field in the generation input).
    const skillLabels: string[] = [];
    for (const id of nodeIds) skillLabels.push(await this.nodeLabel(schoolId, id));
    const skill = skillLabels.join(", ");
    const grounding = await this.collectGrounding(schoolId, nodeIds, `${skill} ${request.title}`);

    // Nothing can ground these nodes: decline upfront with an actionable fix
    // path instead of saving a permanent zero-question draft.
    if (grounding.length === 0) {
      return this.declineUngrounded(schoolId, teacherId, request);
    }

    const flags: string[] = [];

    // Say so when nothing is mapped to the concepts themselves and the questions
    // come from material filed higher up the tree (#19's accepted trade-off).
    // The teacher is reviewing a draft grounded more broadly than they may
    // assume, and that is theirs to know before they publish it.
    if (grounding.every((g) => g.distance > 0)) flags.push("grounded_at_broader_level");

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
        ? { requested, generated: toGenerate, reason: "insufficient approved content" }
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
          // The teacher's requested difficulty wins; "mixed" defers to how the
          // material itself is levelled (the mapping's difficulty attribute).
          const difficulty = request.difficulty !== "mixed" ? request.difficulty : unit.difficulty;
          const completion = await this.ai.run(
            {
              purpose: "assessment.generate",
              prompt: `Draft a ${type} question assessing "${skill}", grounded in approved content.`,
              input: { chunk: unit.text, type, skill, difficulty, seed: label },
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
            difficulty,
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

  /**
   * Generate a DRAFT assessment tailored to ONE student's adaptive
   * recommendation (see AdaptiveEngine.nextAction) rather than a whole class.
   * Reuses `generate()` for everything grounding/decline-related — this only
   * decides WHAT to ask for (node, difficulty) and WHY (the rationale), never
   * duplicating question generation itself. `hint` and `escalate` are handed
   * decisions, not assessment needs — declined honestly rather than
   * generating something ungrounded in the recommendation.
   */
  async generateTailored(
    schoolId: string,
    teacherId: string,
    input: { studentId: string; nodeId: string; action: NextActionKind; reason: string },
  ): Promise<GenerateResult | { status: "declined"; message: string }> {
    if (input.action === "hint") {
      return { status: "declined", message: "A hint isn't an assessment — draft a hint or activity via the Teacher Agent instead." };
    }
    if (input.action === "escalate") {
      return { status: "declined", message: "This has been escalated as a persistent misconception — it needs a teaching decision, not another assessment." };
    }

    const targetNodeId = await this.tailoredNodeId(schoolId, input.action, input.nodeId);
    const difficulty = tailoredDifficulty(input.action);
    const rationale = tailoringRationale(input.action, input.reason, difficulty, targetNodeId, input.nodeId);

    const request: AssessmentRequest = {
      // The TARGET node's human label — the title used to print the raw node id
      // ("Tailored remediation — skill-add-fractions"), the same leak the agent
      // drafts had. Falls back to the id only if the node isn't in any graph.
      title: `Tailored ${input.action} — ${await this.nodeLabel(schoolId, targetNodeId)}`,
      nodeId: targetNodeId,
      count: 5,
      difficulty,
      targetStudentId: input.studentId,
      tailoringRationale: rationale,
    };
    return this.generate(schoolId, teacherId, request);
  }

  /** A node's human label, across every signed-off graph; the bare id only as a last resort. */
  private async nodeLabel(schoolId: string, nodeId: string): Promise<string> {
    const version = await graphOfNode(this.graph, schoolId, nodeId);
    if (!version) return nodeId;
    return (await this.graph.getNode(version.id, nodeId))?.label ?? nodeId;
  }

  /** For "extension" (and the related "progression"), the next skill along a prerequisite edge — falls back to the same node if the graph has no follow-on. */
  private async tailoredNodeId(schoolId: string, action: NextActionKind, nodeId: string): Promise<string> {
    if (action !== "extension" && action !== "progression") return nodeId;
    // Follow the prerequisite edge inside the node's OWN graph — the next skill
    // after a Year 7 Science node is never found in the Year 8 Maths graph.
    const version = await graphOfNode(this.graph, schoolId, nodeId);
    if (!version) return nodeId;
    const edges = await this.graph.listEdges(version.id);
    return edges.find((e) => e.from === nodeId)?.to ?? nodeId;
  }

  // ---- teacher authorship: edit, delete, write-your-own (task #6) ----

  /**
   * Edit a question while the assessment is a DRAFT. The edit is the teacher's
   * own wording, recorded as such (teacherEdited) — an edited question is no
   * longer verbatim-grounded, and pretending otherwise would be dishonest.
   * Published assessments are immutable: students never see a moving target.
   */
  async editQuestion(
    assessmentId: string,
    questionId: string,
    teacherId: string,
    changes: { prompt?: string; options?: string[] | null; modelAnswer?: string | null; rubric?: string | null },
  ): Promise<AssessmentQuestion> {
    const a = await this.requireOwnDraft(assessmentId, teacherId);
    const question = await this.store.getQuestion(questionId);
    if (!question || !(await this.belongsTo(question, assessmentId))) throw new NotFoundError("Question not found.");
    if (changes.prompt !== undefined && !changes.prompt.trim()) {
      throw new ValidationError("A question needs a prompt.");
    }
    const updated: AssessmentQuestion = {
      ...question,
      prompt: changes.prompt?.trim() ?? question.prompt,
      options: changes.options !== undefined ? changes.options : question.options,
      modelAnswer: changes.modelAnswer !== undefined ? changes.modelAnswer : question.modelAnswer,
      rubric: changes.rubric !== undefined ? changes.rubric : question.rubric,
      teacherEdited: true,
      reviewed: true, // editing IS reviewing — the teacher has read every word
    };
    await this.store.updateQuestion(updated);
    this.audit.append({
      action: "assessment.question.edited",
      actorId: teacherId,
      subjectType: "assessment",
      subjectId: a.id,
      metadata: { questionId, fields: Object.keys(changes) },
    });
    return updated;
  }

  /** Remove a question from a DRAFT (e.g. the one weak question of three). */
  async removeQuestion(assessmentId: string, questionId: string, teacherId: string): Promise<void> {
    const a = await this.requireOwnDraft(assessmentId, teacherId);
    const question = await this.store.getQuestion(questionId);
    if (!question || !(await this.belongsTo(question, assessmentId))) throw new NotFoundError("Question not found.");
    await this.store.deleteQuestion(questionId);
    this.audit.append({
      action: "assessment.question.removed",
      actorId: teacherId,
      subjectType: "assessment",
      subjectId: a.id,
      metadata: { questionId },
    });
  }

  /**
   * A teacher writes their own assessment from scratch — no AI, no grounding
   * requirement (their own words are the provenance), same review-acknowledge
   * and publish gates as generated drafts so the workflow stays uniform.
   */
  async createManual(
    schoolId: string,
    teacherId: string,
    input: {
      title: string;
      nodeId: string;
      questions: { prompt: string; options?: string[] | null; modelAnswer?: string | null; rubric?: string | null }[];
    },
  ): Promise<{ assessmentId: string; questionCount: number }> {
    if (!input.title.trim()) throw new ValidationError("A title is required.");
    if (!input.questions.length || input.questions.some((q) => !q.prompt.trim())) {
      throw new ValidationError("Every question needs a prompt, and at least one question is required.");
    }
    const now = this.clock.isoNow();
    const assessment: Assessment = {
      id: newId(),
      schoolId,
      teacherId,
      title: input.title.trim(),
      request: { title: input.title.trim(), nodeId: input.nodeId, count: input.questions.length, difficulty: "mixed" },
      status: "draft",
      generationStatus: "generated",
      publishedAt: null,
      scheduledStart: null,
      reviewAcknowledged: false,
      shortfall: null,
      flags: ["teacher_authored"],
      createdAt: now,
    };
    await this.store.insertAssessment(assessment);
    const version: AssessmentVersion = { id: newId(), assessmentId: assessment.id, label: "A", createdAt: now };
    await this.store.insertVersion(version);
    for (const [i, q] of input.questions.entries()) {
      await this.store.insertQuestion({
        id: newId(), versionId: version.id, order: i, type: "short_answer",
        prompt: q.prompt.trim(), options: q.options ?? null,
        modelAnswer: q.modelAnswer ?? null, rubric: q.rubric ?? null,
        difficulty: "developing", groundingContentIds: [],
        reviewed: true, // their own words — written IS reviewed
        teacherAuthored: true,
      });
    }
    this.audit.append({
      action: "assessment.authored",
      actorId: teacherId,
      subjectType: "assessment",
      subjectId: assessment.id,
      metadata: { questions: input.questions.length, nodeId: input.nodeId },
    });
    return { assessmentId: assessment.id, questionCount: input.questions.length };
  }

  /** Draft-only, owned-by-this-teacher gate shared by the authorship actions. */
  private async requireOwnDraft(assessmentId: string, teacherId: string): Promise<Assessment> {
    const a = await this.require(assessmentId);
    if (a.teacherId !== teacherId) throw new AuthError("Not your assessment.");
    if (a.status !== "draft") {
      throw new ConflictError("PUBLISHED_IMMUTABLE", "Unpublish first — a published assessment can't be edited while students may be sitting it.");
    }
    return a;
  }

  private async belongsTo(question: AssessmentQuestion, assessmentId: string): Promise<boolean> {
    return (await this.store.listVersionsByAssessment(assessmentId)).some((v) => v.id === question.versionId);
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
    // The review gates below pass vacuously on zero questions — an empty
    // assessment must never reach students.
    if ((await this.store.listQuestionsByAssessment(assessmentId)).length === 0) {
      throw new ConflictError("EMPTY_ASSESSMENT", "This assessment has no questions, so it can't be published to students.");
    }
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
      gradedScore: null,
      gradedResults: null,
      gradedAt: null,
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

  /**
   * The student submits: final answers are saved, the attempt closes, then
   * every answered question is graded against its model answer/rubric through
   * the single AI service layer (never a hand-rolled guess) and the result
   * feeds ONE mastery data point for the assessment's skill-graph node —
   * without this, Class Insights (heatmap/focus-areas/cohorts/adaptive) has no
   * real signal to work from, ever, regardless of how many students submit.
   * Grading is best-effort: a submit always succeeds even if grading fails: a
   * flaky AI call must never block a student closing their attempt.
   */
  async submitAttempt(attemptId: string, studentId: string, answers: Record<string, string> = {}): Promise<AssessmentAttempt> {
    const attempt = await this.requireAttempt(attemptId);
    if (attempt.studentId !== studentId) throw new NotFoundError("Attempt not found.");
    if (attempt.status === "submitted") return attempt;
    let updated: AssessmentAttempt = {
      ...attempt,
      savedAnswers: { ...attempt.savedAnswers, ...answers },
      lastSavedAt: this.clock.isoNow(),
      status: "submitted",
    };
    await this.store.updateAttempt(updated);
    this.audit.append({ action: "assessment.attempt.submitted", actorId: studentId, subjectType: "assessment", subjectId: attempt.assessmentId, metadata: { attemptId } });

    try {
      const graded = await this.gradeAndRecordMastery(updated);
      if (graded) {
        updated = { ...updated, gradedScore: graded.overallScore, gradedResults: graded.results, gradedAt: this.clock.isoNow() };
        await this.store.updateAttempt(updated);
      }
    } catch (e) {
      this.audit.append({
        action: "assessment.attempt.grading_failed",
        actorId: studentId,
        subjectType: "assessment",
        subjectId: attempt.assessmentId,
        metadata: { attemptId, error: e instanceof Error ? e.message : String(e) },
      });
    }
    return updated;
  }

  /** Attempts a Teacher can review — includes grading, never sent to the student. */
  async listAttempts(assessmentId: string): Promise<AssessmentAttempt[]> {
    return this.store.listAttemptsByAssessment(assessmentId);
  }

  // ---- helpers ----

  /**
   * Grade every answered question through the AI service layer in ONE call,
   * then upsert a real (non-synthetic) MasteryRecord for the assessment's
   * node. Returns null when nothing was answered — no data point either way.
   */
  private async gradeAndRecordMastery(
    attempt: AssessmentAttempt,
  ): Promise<{ overallScore: number; results: AttemptGradingResult[] } | null> {
    const assessment = await this.require(attempt.assessmentId);
    const questions = await this.store.listQuestionsByAssessment(attempt.assessmentId);
    const answered = questions
      .map((q) => ({ q, answer: attempt.savedAnswers[q.id] }))
      .filter((x): x is { q: AssessmentQuestion; answer: string } => !!x.answer && x.answer.trim().length > 0);
    if (answered.length === 0) return null;

    const completion = await this.ai.run(
      {
        purpose: "assessment.grade",
        prompt: `Grade the student's submitted answers for assessment "${assessment.title}".`,
        input: {
          nodeId: assessment.request.nodeId,
          questions: answered.map(({ q, answer }) => ({
            questionId: q.id,
            type: q.type,
            prompt: q.prompt,
            modelAnswer: q.modelAnswer,
            rubric: q.rubric,
            studentAnswer: answer,
          })),
        },
        containsStudentData: true,
      },
      attempt.studentId,
    );
    const parsed = JSON.parse(completion.text) as { results: AttemptGradingResult[]; overallScore: number };
    // Evidence for every concept the assessment covers, not only the first. The
    // score is the same for each, which is coarse — but a test the teacher said
    // spans three concepts IS evidence about all three, and recording it against
    // one of them would silently discard the other two.
    for (const nodeId of coveredNodeIds(assessment.request)) {
      await this.upsertMastery(assessment.schoolId, attempt.studentId, nodeId, parsed.overallScore);
    }
    return parsed;
  }

  /** One mastery record per (student, node) — later submissions update it and push the prior score into history. */
  private async upsertMastery(schoolId: string, studentId: string, nodeId: string, score: number): Promise<void> {
    const existing = (await this.activity.listMasteryByNode(schoolId, nodeId)).find((m) => m.studentId === studentId);
    const now = this.clock.isoNow();
    if (existing) {
      const updated: MasteryRecord = {
        ...existing,
        score,
        level: masteryLevel(score),
        dataPoints: existing.dataPoints + 1,
        lastActivityAt: now,
        history: [...(existing.history ?? []), existing.score],
      };
      await this.activity.updateMastery(updated);
      return;
    }
    const record: MasteryRecord = {
      id: newId(),
      studentId,
      schoolId,
      nodeId,
      level: masteryLevel(score),
      score,
      dataPoints: 1,
      lastActivityAt: now,
      history: [],
      assistedScore: null,
      synthetic: false,
    };
    await this.activity.insertMastery(record);
  }

  /**
   * The honest, actionable refusal when a node has zero grounded material:
   * names any content covering the node that is awaiting (re-)approval so the
   * teacher knows exactly what to fix in Content Studio. Nothing is persisted.
   */
  private async declineUngrounded(
    schoolId: string,
    teacherId: string,
    request: AssessmentRequest,
  ): Promise<GenerateResult> {
    const items = (await this.contentStore.listContentItemsBySchool(schoolId)).filter((i) => !i.archived);
    const unapproved = items.filter(
      (i) => i.governance.status !== "approved" && i.governance.status !== "published",
    );
    // "Covers this skill" means the same here as it does for grounding: filed
    // against the concept OR anywhere above it. Otherwise the refusal would say
    // "nothing is mapped" while the subject-level syllabus sits awaiting approval.
    const index = await this.groundingIndex(schoolId);
    const covering = new Set(coveredNodeIds(request).flatMap((id) => index.chainFor(id)));
    const pendingContent: { id: string; title: string; status: string }[] = [];
    for (const item of unapproved) {
      const mappings = await this.graph.listMappingsByContent(item.id);
      if (mappings.some((m) => covering.has(m.nodeId))) {
        pendingContent.push({ id: item.id, title: item.title, status: item.governance.status });
      }
    }

    const message =
      pendingContent.length > 0
        ? `Can't generate yet — ${pendingContent.map((p) => `“${p.title}”`).join(", ")} cover${pendingContent.length === 1 ? "s" : ""} this skill but ${pendingContent.length === 1 ? "isn't" : "aren't"} approved. Complete the approval steps in Content Studio, then generate again.`
        : unapproved.length > 0
          ? "Can't generate yet — no approved material is mapped to this skill. You have material awaiting approval in Content Studio; approve it and map it to this skill first."
          : "Can't generate yet — no material is mapped to this skill. Upload material in Content Studio, approve it, and map it to this skill first.";

    this.audit.append({
      action: "assessment.generation.declined",
      actorId: teacherId,
      subjectType: "skill_node",
      subjectId: request.nodeId,
      metadata: { pendingContentIds: pendingContent.map((p) => p.id) },
    });
    return { status: "declined", message, pendingContent };
  }

  /**
   * How many questions each skill node can ground right now (one per approved,
   * mapped section) — lets the UI disable empty skills and show capacity
   * BEFORE the teacher fills in the generate form.
   */
  async groundingCapacity(schoolId: string): Promise<Record<string, number>> {
    const index = await this.groundingIndex(schoolId);
    return index.capacity(async (item) =>
      (await this.contentStore.listChunksByVersion(item.currentVersionId)).length,
    );
  }

  private async collectGrounding(schoolId: string, nodeIds: string[], query: string): Promise<GroundingUnit[]> {
    const index = await this.groundingIndex(schoolId);
    const units: GroundingUnit[] = [];
    for (const source of index.sourcesForAny(nodeIds)) {
      const chunks = await this.contentStore.listChunksByVersion(source.item.currentVersionId);
      for (const chunk of [...chunks].sort((a, b) => a.order - b.order)) {
        units.push({
          contentItemId: source.item.id,
          text: `${chunk.heading} ${chunk.text}`,
          difficulty: source.mapping.difficulty,
          distance: source.distance,
        });
      }
    }
    // The sections most relevant to the chosen concepts generate FIRST.
    // Questions are drawn one-per-unit in order, so page order handed a
    // syllabus's front matter to the generator before any subject content —
    // teachers got questions quizzing the copyright notice. Ties keep document
    // order, so material with no keyword overlap degrades to the old behaviour.
    return units
      .map((u, i) => ({ u, i, score: relevance(u.text, query) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.u);
  }

  private async groundingIndex(schoolId: string): Promise<GroundingIndex> {
    return GroundingIndex.build(this.graph, schoolId, await this.content.approvedPool(schoolId));
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

/** Difficulty implied by an adaptive recommendation (hint/escalate never reach here — handled as declines). */
function tailoredDifficulty(action: NextActionKind): "easy" | "mixed" | "hard" {
  if (action === "remediation") return "easy";
  if (action === "extension" || action === "progression") return "hard";
  return "mixed"; // revision, reassessment
}

/**
 * Plainly connects WHY the student needed this (the adaptive engine's own
 * reason) to WHAT that became (the chosen node + difficulty) — never just the
 * two facts stated separately. Shown to the teacher before question content.
 */
function tailoringRationale(
  action: NextActionKind,
  adaptiveReason: string,
  difficulty: "easy" | "mixed" | "hard",
  targetNodeId: string,
  originalNodeId: string,
): string {
  const movedOn = targetNodeId !== originalNodeId;
  const what =
    action === "remediation"
      ? `so this generates ${difficulty}-difficulty questions on the same skill for targeted practice`
      : action === "reassessment"
      ? `so this re-checks the same skill at ${difficulty} difficulty to confirm before progressing, rather than assuming the latest score`
      : action === "extension" || action === "progression"
      ? movedOn
        ? `so this generates ${difficulty}-difficulty questions on the next skill in the sequence, rather than repeating mastered content`
        : `so this generates ${difficulty}-difficulty questions on the same skill (no follow-on skill is mapped in the graph yet), rather than repeating easier content`
      : `so this generates ${difficulty}-difficulty questions on the same skill to consolidate`;
  return `${adaptiveReason} — ${what}.`;
}
