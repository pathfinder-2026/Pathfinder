/**
 * Milestone 5a — Teacher-facing intelligence domain.
 *
 * The dashboard, class-focus, cohort and adaptive layers all read the Milestone 4
 * mastery/misconception substrate and turn it into Teacher-facing signals. Two
 * rules run through everything here (Foundational Decision 7, plan §5a):
 *   1. Every suggestion is a DRAFT requiring an explicit teacher action — nothing
 *      is ever auto-assigned to a student.
 *   2. Signals reflect the TREND and the whole picture, never a single latest
 *      data point in isolation.
 */

import type { MasteryLevel, MasteryRecord } from "./mastery";
import { masteryLevel, SYNTHETIC_THRESHOLDS } from "./mastery";

/**
 * Analysis thresholds for the intelligence layer. Like the M4 tuning thresholds
 * these are PROVISIONAL — tuned against synthetic data, to be re-validated
 * against real student data after Milestone 7 (they inherit the M4 staleness /
 * insufficient-data cut-offs so there is one source of truth).
 */
export interface DashboardThresholds {
  /** score ≥ this is "secure"/mastered; below it is "below mastery". */
  masteryScore: number;
  /** score < this flags a student for intervention (needs help). */
  interventionScore: number;
  /** A skill is a class focus area when ≥ this fraction are below mastery. */
  focusAreaFraction: number;
  /** A score drop of ≥ this from the earliest signal is a downward trend. */
  trendDelta: number;
  /** A dismissed focus area reappears if the below-mastery fraction worsens by ≥ this. */
  worsenReappearDelta: number;
  /** A mastered skill not practised in this many days is due for spaced revision. */
  spacedRevisionDays: number;
  stalenessDays: number;
  insufficientDataMin: number;
  provisional: true;
  revalidateAfterMilestone: 7;
}

export const DASHBOARD_THRESHOLDS: DashboardThresholds = {
  masteryScore: 0.67,
  interventionScore: 0.34,
  focusAreaFraction: 0.5,
  trendDelta: 0.15,
  worsenReappearDelta: 0.15,
  spacedRevisionDays: SYNTHETIC_THRESHOLDS.stalenessDays,
  stalenessDays: SYNTHETIC_THRESHOLDS.stalenessDays,
  insufficientDataMin: SYNTHETIC_THRESHOLDS.insufficientDataMin,
  provisional: true,
  revalidateAfterMilestone: 7,
};

export type TrendDirection = "up" | "down" | "flat";

/**
 * How much evidence sits behind a mastery estimate. ONE rule, shared by every
 * surface, because they used to disagree: the heatmap rendered a single-point
 * estimate as "no data" while the adaptive engine confidently recommended
 * remediation from that very record, and the growth report showed it as
 * 0% → 0%. A dashboard must not argue with itself.
 *
 *  - "none"        no record at all — genuinely nothing to say
 *  - "early"       a real signal, but below the trust threshold: show it, caveat it
 *  - "established" enough data points to stand on
 */
export type EvidenceStrength = "none" | "early" | "established";

export function evidenceStrength(dataPoints: number, t = DASHBOARD_THRESHOLDS): EvidenceStrength {
  if (dataPoints <= 0) return "none";
  return dataPoints < t.insufficientDataMin ? "early" : "established";
}

/** The one phrase for thin evidence; null when there is nothing to caveat. */
export function evidenceNote(dataPoints: number, t = DASHBOARD_THRESHOLDS): string | null {
  if (evidenceStrength(dataPoints, t) !== "early") return null;
  return `Early signal — ${dataPoints} data point${dataPoints === 1 ? "" : "s"} so far`;
}

/** One cell of the mastery heatmap: a (student, skill) mastery estimate. */
export interface MasteryCell {
  studentId: string;
  nodeId: string;
  level: MasteryLevel;
  score: number;
  trend: TrendDirection;
  dataPoints: number;
  /** Too few data points behind the estimate to trust it (FR-TDB-001 edge). */
  insufficientData: boolean;
  /** Shared thin-data rule — "early" still shows the score, caveated. */
  evidence: EvidenceStrength;
  /** The signal is older than the staleness window. */
  stale: boolean;
}

export type FlagKind = "intervention" | "extension";

/** A student flagged as needing help (intervention) or challenge (extension). */
export interface StudentFlag {
  studentId: string;
  nodeId: string;
  kind: FlagKind;
}

export interface Heatmap {
  /** False → the "not enough data yet" state (never a blank/misleading grid). */
  enoughData: boolean;
  students: string[];
  skills: string[];
  cells: MasteryCell[];
  flags: StudentFlag[];
}

/** A class-level focus area: a skill most of the class is weak on (FR-TDB-002). */
export interface FocusArea {
  nodeId: string;
  belowCount: number;
  total: number;
  belowFraction: number;
  /** Approved+mapped material a Teacher could reteach from (may be empty). */
  suggestedContentIds: string[];
  /** True when no approved content addresses the gap → invite manual creation. */
  contentGap: boolean;
}

export type GroupType =
  | "support"
  | "misconception"
  | "extension"
  | "review"
  | "peer-learning";

/** A suggested student grouping. Always editable before the Teacher assigns work. */
export interface GroupSuggestion {
  id: string;
  type: GroupType;
  /** The skill the grouping is about, when applicable. */
  nodeId: string | null;
  label: string;
  studentIds: string[];
  /** "stale" → built from data older than the staleness window (FR-COH edge). */
  basis: "current" | "stale";
  staleNote: string | null;
}

export type NextActionKind =
  | "progression"
  | "extension"
  | "revision"
  | "hint"
  | "remediation"
  | "reassessment"
  | "escalate";

/** The adaptive engine's recommended next action for one (student, skill). */
export interface NextAction {
  studentId: string;
  nodeId: string;
  action: NextActionKind;
  reason: string;
  /** True when the engine handed the decision to the Teacher rather than looping. */
  escalated: boolean;
  /** Evidence behind the recommendation — same rule the heatmap renders. */
  evidence: EvidenceStrength;
}

/** A spaced-revision reminder — deferred while a student is mid-assessment. */
export interface RevisionReminder {
  studentId: string;
  nodeId: string;
  deferred: boolean;
  reason: string | null;
}

// ---- pure helpers ----

/** Whether a score is below the mastery threshold. */
export function belowMastery(score: number, t = DASHBOARD_THRESHOLDS): boolean {
  return score < t.masteryScore;
}

/**
 * Trend from a record's history to its latest score. Uses the EARLIEST prior
 * signal as the baseline so a genuine decline shows even when the latest single
 * point looks acceptable (FR-TDB-001).
 */
export function trendOf(record: MasteryRecord, t = DASHBOARD_THRESHOLDS): TrendDirection {
  const history = record.history ?? [];
  if (history.length === 0) return "flat";
  const baseline = history[0]!;
  if (record.score <= baseline - t.trendDelta) return "down";
  if (record.score >= baseline + t.trendDelta) return "up";
  return "flat";
}

/** Days between two ISO instants. */
export function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000);
}

export function isStale(record: MasteryRecord, nowIso: string, t = DASHBOARD_THRESHOLDS): boolean {
  return daysBetween(record.lastActivityAt, nowIso) > t.stalenessDays;
}

/**
 * Collapse many mastery records to ONE per (student, skill): the latest by
 * activity time. The intelligence layer reasons over current state, and this
 * keeps a single cell per pair even if several snapshots exist.
 */
export function latestPerPair(records: MasteryRecord[]): MasteryRecord[] {
  const byPair = new Map<string, MasteryRecord>();
  for (const r of records) {
    const key = `${r.studentId}::${r.nodeId}`;
    const existing = byPair.get(key);
    if (!existing || new Date(r.lastActivityAt).getTime() > new Date(existing.lastActivityAt).getTime()) {
      byPair.set(key, r);
    }
  }
  return [...byPair.values()];
}

export { masteryLevel };
