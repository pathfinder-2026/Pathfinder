/**
 * Milestone 6 — Teacher Agent domain.
 *
 * A curriculum/lesson-planning assistant grounded in everything built so far. Two
 * non-negotiables from the definition of done run through this file:
 *   1. EVERY suggestion shows its approved-content grounding (FR-TAG-004) — with
 *      no exceptions. A request with no grounding content is DECLINED honestly
 *      rather than answered with an invented, ungrounded plan.
 *   2. Drafts (parent comms, lesson plans, feedback) are never auto-sent; they
 *      persist unsent, and sensitive behavioural/social observations are separated
 *      from academic content and flagged for extra teacher review (Decision 7).
 */

export type AgentSuggestionKind =
  | "unit_sequence"
  | "lesson_plan"
  | "differentiation"
  | "parent_summary"
  | "feedback";

/**
 * A reference to an approved content item a suggestion was grounded in. `title`
 * is snapshotted at creation so the link survives even if the source is later
 * archived or renamed; `archived` is resolved live when the suggestion is viewed.
 */
export interface GroundingRef {
  contentItemId: string;
  title: string;
  archived: boolean;
}

export type SensitiveCategory = "behavioural" | "social";

/** A behavioural/social observation, kept OUT of the academic body and flagged. */
export interface SensitiveSection {
  category: SensitiveCategory;
  text: string;
  flaggedForReview: true;
}

/** An observation a teacher supplies for a parent summary / feedback draft. */
export interface Observation {
  text: string;
  category: "academic" | SensitiveCategory;
}

export interface AgentSuggestion {
  id: string;
  schoolId: string;
  teacherId: string;
  kind: AgentSuggestionKind;
  title: string;
  /** Academic/curriculum body. Sensitive observations are NEVER inlined here. */
  content: string;
  /** FR-TAG-004: always non-empty — a suggestion without grounding is not created. */
  grounding: GroundingRef[];
  /** Behavioural/social material, separated and flagged for extra review. */
  sensitiveSections: SensitiveSection[];
  requiresExtraReview: boolean;
  /** Differentiation: false + a note when not yet personalised to real data. */
  personalised: boolean;
  personalisationNote: string | null;
  /** Drafts persist unsent; there is no path that auto-sends them. */
  sent: boolean;
  sentAt: string | null;
  createdAt: string;
}

/** Generation either produces a grounded suggestion, or declines honestly. */
export type AgentResult =
  | { status: "suggested"; suggestion: AgentSuggestion }
  | { status: "declined"; reason: "no_grounding_content"; message: string };
