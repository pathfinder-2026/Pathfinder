/**
 * Milestone 3 — Assessment Builder domain.
 *
 * All generated output stays in DRAFT until a teacher reviews and publishes it
 * (FR-ASM-004 / Foundational Decision 7). Generation is grounded ONLY in the
 * approved + mapped content pool — never fabricated — and every AI call runs
 * through the single AI service layer (Decision 2), audited (Decision 3).
 */

export type QuestionType =
  | "multiple_choice"
  | "short_answer"
  | "numerical"
  | "extended_response"
  | "scenario";

export const QUESTION_TYPES: QuestionType[] = [
  "multiple_choice",
  "short_answer",
  "numerical",
  "extended_response",
  "scenario",
];

export type AssessmentStatus = "draft" | "published";
export type GenerationStatus = "generated" | "failed";

export interface AssessmentQuestion {
  id: string;
  versionId: string;
  order: number;
  type: QuestionType;
  prompt: string;
  options: string[] | null; // multiple_choice only
  modelAnswer: string | null;
  rubric: string | null; // extended_response gets a rubric
  difficulty: string;
  /** The approved content items this question is grounded in. */
  groundingContentIds: string[];
  reviewed: boolean;
}

export interface AssessmentVersion {
  id: string;
  assessmentId: string;
  label: string; // "A", "B", ...
  createdAt: string;
}

export interface GenerationShortfall {
  requested: number;
  generated: number;
  reason: string;
}

export interface Assessment {
  id: string;
  schoolId: string;
  teacherId: string;
  title: string;
  /** The plain-language request + parameters. */
  request: AssessmentRequest;
  status: AssessmentStatus;
  generationStatus: GenerationStatus;
  publishedAt: string | null;
  /** When the assessment is scheduled to start (governs reversible unpublish). */
  scheduledStart: string | null;
  reviewAcknowledged: boolean;
  shortfall: GenerationShortfall | null;
  flags: string[];
  createdAt: string;
}

export interface TypeRequest {
  type: QuestionType;
  count: number;
}

export interface AssessmentRequest {
  title: string;
  /** The skill-graph node to ground generation on. */
  nodeId: string;
  count: number;
  difficulty: "easy" | "mixed" | "hard";
  typeMix?: TypeRequest[];
  versions?: number;
  /**
   * Set only by AssessmentService.generateTailored — this draft was shaped
   * for ONE student (from the adaptive engine's recommendation), not the
   * whole class. Stored on the request (persisted as part of the existing
   * `request` jsonb column — no schema change) rather than as a top-level
   * Assessment field, since it's a property of what was asked for, same as
   * every other generation parameter here.
   */
  targetStudentId?: string | null;
  /**
   * Plain-language explanation connecting the adaptive recommendation to the
   * generation parameters actually chosen (e.g. "independent work strong,
   * assisted work weak, so this confirms mastery at the same difficulty
   * before progressing"). Shown to the teacher on the review screen BEFORE
   * question content — it's what they're actually approving.
   */
  tailoringRationale?: string | null;
  scheduledStart?: string;
}

export type AttemptStatus = "in_progress" | "submitted";

export interface AssessmentAttempt {
  id: string;
  assessmentId: string;
  studentId: string;
  status: AttemptStatus;
  /** Answers saved so far (last save point). */
  savedAnswers: Record<string, string>;
  lastSavedAt: string;
  /** True when connectivity was lost mid-attempt (visible to the Teacher). */
  interrupted: boolean;
  /** Latest time the student may resume after an interruption. */
  resumeDeadline: string;
  createdAt: string;
}
