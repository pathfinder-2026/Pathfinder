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
  /** 0..1 mastery estimate. */
  score: number;
  /** Number of activity data points behind the estimate. */
  dataPoints: number;
  lastActivityAt: string;
  synthetic: boolean;
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
