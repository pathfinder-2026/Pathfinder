/**
 * Milestone 5b — Peer Benchmarking, Peer Review & Peer Testing.
 *
 * KEY GOVERNANCE DIFFERENCE (plan §5a key design decision): computed peer results
 * follow **publish-or-withhold**, NOT the edit-then-approve pattern used elsewhere.
 * This is a genuinely separate code path:
 *   - Computed figures are immutable — there is no "edit result" operation.
 *   - The only decisions on results are PUBLISH or WITHHOLD (default: withheld).
 *   - Results are NEVER auto-released to students on any timer.
 *   - A genuine correction (e.g. a grading error) goes through a separate,
 *     LOGGED correction path — never a silent edit of the computed data.
 *   - Student-facing signals are softened + non-ranked (above/at/below cohort
 *     average), never an explicit rank or a raw comparison to named peers.
 * These map to the fixed `locked-computed` governance token (Decision 5).
 */

export type AnonymityLevel = "named" | "anonymous";

export type PeerTestStatus = "draft" | "scheduled" | "launched" | "closed" | "cancelled";

/** Default is `withheld`: nothing reaches students without an explicit decision. */
export type BenchmarkPublishState = "withheld" | "published";

export type PeerBand = "above" | "at" | "below";

export type ReviewModerationState = "pending" | "approved" | "rejected";

export interface Accommodation {
  studentId: string;
  kind: string;
}

export interface PeerTest {
  id: string;
  schoolId: string;
  teacherId: string;
  title: string;
  /** Skill-graph node the peer test grounds on (approved content). */
  nodeId: string;
  questionCount: number;
  rubric: string | null;
  /** Cohort membership; LOCKED at launch. */
  cohort: string[];
  anonymity: AnonymityLevel;
  accommodations: Accommodation[];
  status: PeerTestStatus;
  /** Publish/withhold decision on the COMPUTED benchmark. Defaults to withheld. */
  benchmarkPublish: BenchmarkPublishState;
  scheduledStart: string | null;
  launchedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  /** Surfaced tensions/shortfalls (never silently applied). */
  warnings: string[];
  createdAt: string;
}

export interface PeerTestSubmission {
  id: string;
  peerTestId: string;
  studentId: string;
  /** The graded result (0..1). Immutable — corrections go through PeerCorrection. */
  score: number;
  submittedAt: string;
}

/** The separate, LOGGED correction path — never a silent edit of computed data. */
export interface PeerCorrection {
  id: string;
  peerTestId: string;
  studentId: string;
  previousScore: number;
  correctedScore: number;
  reason: string;
  correctedBy: string;
  at: string;
}

export interface PeerReview {
  id: string;
  schoolId: string;
  peerTestId: string;
  /** Stored for audit; NEVER surfaced to the reviewed student (anonymised). */
  reviewerId: string;
  targetStudentId: string;
  /** Peer-authored — a teacher may reject/hide it but never rewrite it. */
  text: string;
  moderationState: ReviewModerationState;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
}

/** A peer test placed on a student's dashboard/calendar (created at launch). */
export interface PeerPlacement {
  id: string;
  peerTestId: string;
  studentId: string;
  placedAt: string;
}

// ---- computed (never stored) ----

export interface StudentBenchmark {
  studentId: string;
  score: number;
  /** Mid-rank percentile within the cohort (0..100). Teacher-facing only. */
  percentile: number;
  band: PeerBand;
}

export interface CohortBenchmark {
  peerTestId: string;
  cohortSize: number;
  completed: number;
  total: number;
  /** True when the cohort is too small to compare meaningfully/anonymously. */
  suppressed: boolean;
  suppressionReason: string | null;
  publishState: BenchmarkPublishState;
  /** Full per-student figures — TEACHER-FACING only. Empty when suppressed. */
  students: StudentBenchmark[];
}

/** What a student may see — softened, non-ranked, and only once published. */
export interface SoftenedSignal {
  visible: boolean;
  signal: PeerBand | null;
  message: string;
}

export interface PeerThresholds {
  /** Cohorts smaller than this are suppressed and carry an anonymity risk. */
  minCohort: number;
  provisional: true;
  revalidateAfterMilestone: 7;
}

/** Provisional — re-validate against real data after Milestone 7 (v1.3 rule). */
export const PEER_THRESHOLDS: PeerThresholds = {
  minCohort: 5,
  provisional: true,
  revalidateAfterMilestone: 7,
};

// ---- pure helpers ----

/**
 * Compute the cohort benchmark from per-student scores. Suppressed (no figures)
 * when the cohort is below the minimum — small groups weaken both anonymity and
 * statistical reliability.
 */
export function computeBenchmark(
  peerTestId: string,
  scores: { studentId: string; score: number }[],
  total: number,
  publishState: BenchmarkPublishState,
  t: PeerThresholds = PEER_THRESHOLDS,
): CohortBenchmark {
  const cohortSize = scores.length;
  if (cohortSize > 0 && cohortSize < t.minCohort) {
    return {
      peerTestId, cohortSize, completed: cohortSize, total,
      suppressed: true,
      suppressionReason: `Cohort of ${cohortSize} is below the minimum of ${t.minCohort} — suppressed as statistically unreliable, and small groups weaken anonymity.`,
      publishState, students: [],
    };
  }
  const mean = cohortSize ? scores.reduce((s, r) => s + r.score, 0) / cohortSize : 0;
  const eps = 0.02;
  const students: StudentBenchmark[] = scores.map((r) => {
    const below = scores.filter((o) => o.score < r.score).length;
    const equal = scores.filter((o) => o.score === r.score).length;
    const percentile = cohortSize ? Math.round(((below + 0.5 * equal) / cohortSize) * 100) : 0;
    const band: PeerBand = r.score > mean + eps ? "above" : r.score < mean - eps ? "below" : "at";
    return { studentId: r.studentId, score: r.score, percentile, band };
  });
  return {
    peerTestId, cohortSize, completed: cohortSize, total,
    suppressed: false, suppressionReason: null, publishState, students,
  };
}

/** The softened, non-ranked signal a student may see — only when published. */
export function softenedSignalFor(benchmark: CohortBenchmark, studentId: string): SoftenedSignal {
  if (benchmark.publishState !== "published") {
    return { visible: false, signal: null, message: "Your teacher hasn’t released cohort comparisons." };
  }
  if (benchmark.suppressed) {
    return { visible: false, signal: null, message: "Cohort too small to compare." };
  }
  const me = benchmark.students.find((s) => s.studentId === studentId);
  if (!me) return { visible: false, signal: null, message: "No result for you in this cohort." };
  const phrase = me.band === "above" ? "above" : me.band === "below" ? "below" : "at";
  // Non-ranked, no raw figures, no named peers.
  return { visible: true, signal: me.band, message: `You’re ${phrase} the cohort average.` };
}

/** Small cohorts risk de-anonymising reviewers / accommodated students. */
export function anonymityRisk(cohortSize: number, t: PeerThresholds = PEER_THRESHOLDS): boolean {
  return cohortSize > 0 && cohortSize < t.minCohort;
}
