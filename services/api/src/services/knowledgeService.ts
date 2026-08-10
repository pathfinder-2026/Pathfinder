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

  createOutcome(schoolId: string, code: string, description: string): Outcome {
    const outcome: Outcome = { id: newId(), schoolId, code, description, deprecated: false };
    this.content.insertOutcome(outcome);
    return outcome;
  }

  /** Deprecate an outcome (e.g. a later curriculum revision retires it). */
  deprecateOutcome(outcomeId: string): Outcome {
    const outcome = this.content.getOutcome(outcomeId);
    if (!outcome) throw new NotFoundError("Outcome not found.");
    const updated = { ...outcome, deprecated: true };
    this.content.updateOutcome(updated);
    this.audit.append({
      action: "outcome.deprecated",
      actorId: null,
      subjectType: "outcome",
      subjectId: outcomeId,
      metadata: {},
    });
    return updated;
  }

  createQuestion(schoolId: string, text: string, outcomeIds: string[] = []): Question {
    const question: Question = { id: newId(), schoolId, text, outcomeIds };
    this.content.insertQuestion(question);
    return question;
  }

  /** Link an outcome to a question (used to resolve an orphaned question). */
  linkQuestionToOutcome(questionId: string, outcomeId: string): Question {
    const question = this.content.getQuestion(questionId);
    if (!question) throw new NotFoundError("Question not found.");
    if (!question.outcomeIds.includes(outcomeId)) question.outcomeIds.push(outcomeId);
    this.content.updateQuestion(question);
    return question;
  }

  createLesson(
    schoolId: string,
    title: string,
    questionIds: string[],
    outcomeIds: string[],
  ): Lesson {
    const lesson: Lesson = { id: newId(), schoolId, title, questionIds, outcomeIds };
    this.content.insertLesson(lesson);
    return lesson;
  }

  /** A lesson with its linked questions and outcomes, each navigable, with
   * deprecated outcomes flagged "outdated". */
  getLessonView(lessonId: string): LessonView {
    const lesson = this.content.getLesson(lessonId);
    if (!lesson) throw new NotFoundError("Lesson not found.");
    const questions = lesson.questionIds
      .map((id) => this.content.getQuestion(id))
      .filter((q): q is Question => Boolean(q));
    const outcomes = lesson.outcomeIds
      .map((id) => this.content.getOutcome(id))
      .filter((o): o is Outcome => Boolean(o))
      .map((outcome) => ({ outcome, outdated: outcome.deprecated }));
    return { lesson, questions, outcomes };
  }

  /** Questions not linked to any outcome — the "needs linking" view. */
  needsLinking(schoolId: string): Question[] {
    return this.content
      .listQuestionsBySchool(schoolId)
      .filter((q) => q.outcomeIds.length === 0);
  }
}
