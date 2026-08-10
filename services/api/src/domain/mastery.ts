/**
 * Milestone 4 — synthetic student activity substrate.
 *
 * Mastery/misconception signals the Milestone 5 intelligence layer reads. All
 * records seeded in M4 are `synthetic: true` and quarantined (see the seeder and
 * AccountService quarantine queries).
 */

export type MasteryLevel = "low" | "developing" | "secure";

export interface MasteryRecord {
  id: string;
  studentId: string;
  schoolId: string;
  /** The skill-graph node (skill) this mastery is against. */
  nodeId: string;
  level: MasteryLevel;
  /** 0..1 mastery estimate (the LATEST signal). */
  score: number;
  /** Number of activity data points behind the estimate. */
  dataPoints: number;
  lastActivityAt: string;
  /**
   * Prior mastery scores oldest→newest (excluding the current `score`), from
   * earlier assessments. Lets the dashboard show a TREND rather than only the
   * latest point (FR-TDB-001). Empty/undefined when there is no prior signal.
   */
  history?: number[];
  /**
   * Performance on ASSISTED/scaffolded work, when it diverges from the
   * independent `score`. Lets the adaptive engine reconcile conflicting signals
   * (FR-ADP-001) instead of trusting only the most recent score. Null when there
   * is no distinct assisted signal.
   */
  assistedScore?: number | null;
  synthetic: boolean;
}

/** The mastery band for a 0..1 score. Single source of truth (M4 seed + M5). */
export function masteryLevel(score: number): MasteryLevel {
  if (score < 0.34) return "low";
  if (score < 0.67) return "developing";
  return "secure";
}

export interface MisconceptionSignal {
  id: string;
  studentId: string;
  schoolId: string;
  nodeId: string;
  misconception: string;
  /** Times observed — an escalation signal when it persists. */
  occurrences: number;
  lastSeenAt: string;
  synthetic: boolean;
}

/**
 * Thresholds tuned against synthetic data. RECORDED (not frozen): per the M4
 * quarantine rules they must be re-validated against real data after Milestone 7
 * rather than treated as final.
 */
export interface SyntheticThresholds {
  /** Cohorts of this size or smaller are suppressed (M5 small-cohort suppression). */
  smallCohortMax: number;
  /** Activity older than this many days is "stale" (M5 stale-data flag). */
  stalenessDays: number;
  /** A misconception seen at least this many times is "persistent" (M5 escalation). */
  misconceptionEscalationMin: number;
  /** Fewer than this many data points is "insufficient data" (M5 insufficient-data state). */
  insufficientDataMin: number;
  provisional: true;
  revalidateAfterMilestone: 7;
  note: string;
}

export const SYNTHETIC_THRESHOLDS: SyntheticThresholds = {
  smallCohortMax: 5,
  stalenessDays: 14,
  misconceptionEscalationMin: 3,
  insufficientDataMin: 3,
  provisional: true,
  revalidateAfterMilestone: 7,
  note:
    "Provisional thresholds tuned against synthetic Milestone 4 data. Per the M4 " +
    "quarantine rules these must be re-validated against real student data after " +
    "Milestone 7 — do not treat as final.",
};
