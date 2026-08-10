import { NotFoundError } from "../domain/errors";
import type { Lesson, Outcome, Question } from "../domain/content";
import type { AuditRecorder } from "../platform/audit/auditLog";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";

export interface LessonView {
  lesson: Lesson;
  questions: Question[];
  outcomes: { outcome: Outcome; outdated: boolean }[];
}

/**
 * FR-ING-003/004 — link lessons, questions and outcomes; flag outdated outcomes
 * and surface orphaned questions.
 */
export class KnowledgeService {
  constructor(
    private readonly content: ContentStore,
    private readonly audit: AuditRecorder,
  ) {}

  async createOutcome(schoolId: string, code: string, description: string): Promise<Outcome> {
    const outcome: Outcome = { id: newId(), schoolId, code, description, deprecated: false };
    await this.content.insertOutcome(outcome);
    return outcome;
  }

  /** Deprecate an outcome (e.g. a later curriculum revision retires it). */
  async deprecateOutcome(outcomeId: string): Promise<Outcome> {
    const outcome = await this.content.getOutcome(outcomeId);
    if (!outcome) throw new NotFoundError("Outcome not found.");
    const updated = { ...outcome, deprecated: true };
    await this.content.updateOutcome(updated);
    this.audit.append({
      action: "outcome.deprecated",
      actorId: null,
      subjectType: "outcome",
      subjectId: outcomeId,
      metadata: {},
    });
    return updated;
  }

  async createQuestion(schoolId: string, text: string, outcomeIds: string[] = []): Promise<Question> {
    const question: Question = { id: newId(), schoolId, text, outcomeIds };
    await this.content.insertQuestion(question);
    return question;
  }

  /** Link an outcome to a question (used to resolve an orphaned question). */
  async linkQuestionToOutcome(questionId: string, outcomeId: string): Promise<Question> {
    const question = await this.content.getQuestion(questionId);
    if (!question) throw new NotFoundError("Question not found.");
    if (!question.outcomeIds.includes(outcomeId)) question.outcomeIds.push(outcomeId);
    await this.content.updateQuestion(question);
    return question;
  }

  async createLesson(
    schoolId: string,
    title: string,
    questionIds: string[],
    outcomeIds: string[],
  ): Promise<Lesson> {
    const lesson: Lesson = { id: newId(), schoolId, title, questionIds, outcomeIds };
    await this.content.insertLesson(lesson);
    return lesson;
  }

  /** A lesson with its linked questions and outcomes, each navigable, with
   * deprecated outcomes flagged "outdated". */
  async getLessonView(lessonId: string): Promise<LessonView> {
    const lesson = await this.content.getLesson(lessonId);
    if (!lesson) throw new NotFoundError("Lesson not found.");
    const questions: Question[] = [];
    for (const id of lesson.questionIds) {
      const q = await this.content.getQuestion(id);
      if (q) questions.push(q);
    }
    const outcomes: { outcome: Outcome; outdated: boolean }[] = [];
    for (const id of lesson.outcomeIds) {
      const o = await this.content.getOutcome(id);
      if (o) outcomes.push({ outcome: o, outdated: o.deprecated });
    }
    return { lesson, questions, outcomes };
  }

  /** Questions not linked to any outcome — the "needs linking" view. */
  async needsLinking(schoolId: string): Promise<Question[]> {
    return (await this.content.listQuestionsBySchool(schoolId)).filter(
      (q) => q.outcomeIds.length === 0,
    );
  }
}
