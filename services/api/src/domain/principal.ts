/**
 * Milestone 9 — Principal Dashboard domain (FR-PDB-001..006).
 *
 * A whole-school view scoped to ONE school. Two rules run through everything:
 *   1. Ask-for-Help transcripts are UNREACHABLE from every principal-facing surface
 *      (dashboard, drill-down, alerts, exports). This is enforced structurally:
 *      PrincipalService never reads the help store, and no type here carries
 *      transcript/message content.
 *   2. No cross-campus comparison (single school, single campus at a time) — the
 *      interface does not offer it (out of MVP scope).
 * Sensitive comparison views (teacher-to-teacher) are gated by school policy.
 */

export interface SchoolPolicy {
  schoolId: string;
  /** FR-PDB-006: teacher-to-teacher comparison is disabled unless the school enables it. */
  teacherComparisonEnabled: boolean;
  /** M10 FR-BSS: behavioural/social collection is off until parental consent is configured. */
  behaviouralConsentConfigured: boolean;
  /** M10 FR-BSS: behavioural notes stay hidden from Parents until the school enables it. */
  behaviouralParentVisible: boolean;
  updatedAt: string | null;
}

/** A SchoolPolicy with all gates at their safe defaults (off). */
export function defaultSchoolPolicy(schoolId: string): SchoolPolicy {
  return { schoolId, teacherComparisonEnabled: false, behaviouralConsentConfigured: false, behaviouralParentVisible: false, updatedAt: null };
}

export interface TeacherMetrics {
  teacherId: string;
  name: string | null;
  /** Distinct skills the teacher has authored assessments/tasks for. */
  coverage: number;
  assessmentsAuthored: number;
  assessmentsPublished: number;
  /** Published / authored — how often AI-drafted assessments are approved. */
  aiApprovalRate: number;
  aiDrafts: number;
  aiDraftsEdited: number;
  /** Edited / drafts — how often AI drafts are changed before use. */
  editRate: number;
  engagement: number;
  workload: number;
  /** True while the teacher is within the shorter new-joiner window. */
  newTeacher: boolean;
  windowDays: number;
  /** Flagged distinctly (not blended into the average) — never for new teachers. */
  lowEngagementOutlier: boolean;
}

export interface TeacherComparison {
  /** Teachers ranked by engagement — a sensitive view, only when policy allows. */
  ranking: { teacherId: string; name: string | null; engagement: number }[];
}

export interface SchoolTeacherReport {
  teachers: TeacherMetrics[];
  schoolWide: { teacherCount: number; avgEngagement: number; avgAiApprovalRate: number; coverage: number };
  /** null when the school disables teacher-to-teacher comparison (FR-PDB-006). */
  comparison: TeacherComparison | null;
}

export interface ClassMasterySummary {
  classId: string;
  name: string;
  studentCount: number;
  avgScore: number;
  belowMasteryFraction: number;
  atRiskCount: number;
  /** Highlighted rather than smoothed into the school average. */
  outlier: boolean;
}

export interface SchoolMasteryOverview {
  classes: ClassMasterySummary[];
  schoolWide: { avgScore: number; atRiskCount: number; classCount: number };
}

/** Class drill — aggregated per-student mastery. NEVER any tutor transcript. */
export interface ClassDrillView {
  classId: string;
  name: string;
  students: { studentId: string; name: string | null; avgScore: number; atRisk: boolean }[];
}

/** Student drill — the deepest level. Deliberately carries NO Ask-for-Help content. */
export interface StudentDrillView {
  studentId: string;
  name: string | null;
  avgScore: number;
  skills: { nodeId: string; score: number; level: string }[];
  tasksCompleted: number;
  /** Structural marker: transcripts are excluded even at the deepest drill level. */
  askForHelpExcluded: true;
}

export type PrincipalAlertKind = "mastery_drop" | "engagement_drop" | "coverage_gap";

export interface PrincipalAlert {
  kind: PrincipalAlertKind;
  classId: string;
  message: string;
  delta: number;
}

export interface PrincipalThresholds {
  /** Engagement at or below this flags a low-activity outlier (non-new teachers). */
  lowEngagementMax: number;
  /** A teacher joined within this many days is shown in a shorter window. */
  newTeacherDays: number;
  /** A class this far below the school average is an outlier. */
  classOutlierDelta: number;
  /** A week-over-week mastery drop at least this large raises an alert. */
  masteryDropAlertDelta: number;
  provisional: true;
  revalidateAfterMilestone: 7;
}

export const PRINCIPAL_THRESHOLDS: PrincipalThresholds = {
  lowEngagementMax: 2,
  newTeacherDays: 30,
  classOutlierDelta: 0.15,
  masteryDropAlertDelta: 0.15,
  provisional: true,
  revalidateAfterMilestone: 7,
};

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
