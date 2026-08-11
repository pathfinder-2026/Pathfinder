/**
 * Milestone 10 — Reporting domain (FR-REP-001/002/004, FR-CAP-002, FR-BSS-001/002).
 *
 * Three separate data models, kept distinct everywhere they appear:
 *   - academic mastery (existing);
 *   - CO-CURRICULAR capability (sport/arts/music) in its own SIMPLER structure —
 *     free-text skill + level, NOT the academic skill graph;
 *   - BEHAVIOURAL/SOCIAL observations — the four v1.3 categories only, teacher-
 *     authored notes, with NO AI inference (blocked by design).
 * Reports aggregate these; empty sections are omitted gracefully; partial-term data
 * is flagged; and cost reports prorate a partial month.
 */

// ---- co-curricular capability (FR-CAP-002) ----

export type CoCurricularDomain = "sport" | "arts" | "music";

export interface CoCurricularRecord {
  id: string;
  schoolId: string;
  studentId: string;
  domain: CoCurricularDomain;
  /** Free-text skill (e.g. "violin - grade 3"); deliberately NOT a skill-graph node. */
  skill: string;
  level: string;
  teacherId: string;
  createdAt: string;
}

// ---- behavioural / social observations (FR-BSS-001/002) ----

/** The v1.3 MVP taxonomy — these four categories ONLY. */
export const BEHAVIOURAL_CATEGORIES = ["collaboration", "communication", "resilience", "participation"] as const;
export type BehaviouralCategory = (typeof BEHAVIOURAL_CATEGORIES)[number];

/**
 * A teacher-authored observational note. There is deliberately NO score/inference
 * field — behavioural traits are never auto-scored by AI in the MVP.
 */
export interface BehaviouralObservation {
  id: string;
  schoolId: string;
  studentId: string;
  category: BehaviouralCategory;
  note: string;
  authorTeacherId: string;
  createdAt: string;
}

/** How a viewer may see behavioural data (per-persona, per the v1.3 default matrix). */
export type BehaviouralVisibility = "notes" | "aggregate" | "hidden";

export interface BehaviouralAggregate {
  category: BehaviouralCategory;
  count: number;
}

// ---- teacher comments (FR-REP-004) ----

export interface TeacherComment {
  id: string;
  schoolId: string;
  studentId: string;
  teacherId: string;
  text: string;
  createdAt: string;
}

// ---- licences / cost (FR-REP-002) ----

export interface Licence {
  id: string;
  schoolId: string;
  seats: number;
  monthlyRate: number;
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string | null;
  createdAt: string;
}

// ---- report views ----

export interface TeacherGrowthReport {
  classId: string;
  className: string;
  /** Per-skill mastery change across the reporting window. */
  growth: { nodeId: string; baseline: number; current: number; change: number }[];
  /** True when the data window is too short to be full-term (stated on the report). */
  limited: boolean;
  note: string | null;
}

export interface SchoolReport {
  schoolId: string;
  performance: { avgScore: number; classCount: number; atRiskCount: number };
  coverage: number;
  usage: { assessmentsGenerated: number; agentDrafts: number };
  cost: CostReport;
}

export interface CostReport {
  month: string; // YYYY-MM
  lines: { licenceId: string; seats: number; monthlyRate: number; proratedCost: number; prorated: boolean }[];
  total: number;
}

export interface ParentReport {
  studentId: string;
  childName: string | null;
  strengths: string[];
  focusAreas: string[];
  /** Omitted (empty) rather than a broken placeholder when the teacher wrote none. */
  teacherComments: string[];
  coCurricular: { domain: CoCurricularDomain; skill: string; level: string }[];
}

// ---- pure helpers ----

/** Days in a calendar month (monthIso = "YYYY-MM"). */
export function daysInMonth(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/**
 * Prorate a licence's monthly cost for `month`: full rate if active the whole
 * month, otherwise rate * (active days / days in month).
 */
export function proratedCost(licence: Licence, monthIso: string): { cost: number; prorated: boolean } {
  const total = daysInMonth(monthIso);
  const monthStart = `${monthIso}-01`;
  const monthEnd = `${monthIso}-${String(total).padStart(2, "0")}`;
  const start = licence.startDate > monthStart ? licence.startDate : monthStart;
  const end = licence.endDate && licence.endDate < monthEnd ? licence.endDate : monthEnd;
  if (start > monthEnd || end < monthStart) return { cost: 0, prorated: true };
  const activeDays = Math.round((Date.parse(end) - Date.parse(start)) / (24 * 60 * 60 * 1000)) + 1;
  const prorated = activeDays < total;
  const cost = Math.round(licence.monthlyRate * (activeDays / total) * 100) / 100;
  return { cost, prorated };
}
