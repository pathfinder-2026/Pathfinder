/**
 * Milestone 8 — Parent Dashboard domain (FR-PAR-001/003/004/005/006).
 *
 * Three rules run through everything here:
 *   1. VERIFICATION-BEFORE-DATA is absolute: no student data is shown for a link
 *      that isn't verified, and a parent only ever sees their own verified child
 *      (never another student, never merged across their children).
 *   2. Summaries are PLAIN-LANGUAGE — raw internal labels (node ids, curriculum
 *      codes) are translated to everyday topic words.
 *   3. Summaries are NEVER DIAGNOSTIC — observational wording only, never clinical
 *      or diagnostic phrasing (this is easy to violate through careless copy, so
 *      it is enforced in code and tested specifically).
 *
 * Synthetic students hold no PII and have no parent link, so they can never appear
 * on a parent surface (M4 quarantine). AI *claims* about a student still pass the
 * approvable-state gate (`canSurfaceToStakeholder`) before reaching a parent.
 */

export interface ParentChildLink {
  id: string;
  schoolId: string;
  parentId: string;
  studentId: string;
  relationship: string;
  /** No student data is shown until this is true (FR-PAR-003). */
  verified: boolean;
  verifiedAt: string | null;
  /** Last weekly-digest send time — drives the consolidated cadence (FR-PAR-004). */
  lastDigestAt: string | null;
  createdAt: string;
}

export interface ParentSummary {
  childName: string | null;
  /** False → the plain "no recent activity" state (never stale data without context). */
  hasRecentActivity: boolean;
  strengths: string[];
  focusAreas: string[];
  recentActivity: string[];
  /** Plain-language, observational, non-diagnostic prose. */
  summaryText: string;
  period: string;
}

/**
 * Clinical / diagnostic vocabulary a parent-facing summary must never use. The
 * summary describes what was OBSERVED ("has found X challenging"), never a label.
 */
export const DIAGNOSTIC_TERMS = [
  "dyslexia", "dyslexic", "dyscalculia", "adhd", "add", "autism", "autistic",
  "disorder", "diagnosis", "diagnose", "diagnosed", "deficit", "disability",
  "disabled", "syndrome", "clinical", "special needs", "learning disability",
  "impairment", "impaired", "condition", "patholog",
];

/** True if any diagnostic/clinical term appears (word-ish, case-insensitive). */
export function containsDiagnosticLanguage(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  return DIAGNOSTIC_TERMS.some((term) => t.includes(` ${term}`) || t.includes(`${term} `) || t.includes(` ${term} `));
}

/**
 * Translate a raw skill-graph label/code into an everyday topic word for parents.
 * Drops curriculum codes (e.g. "MA4-ALG") and verbose stems, keeping a short,
 * lowercase topic — never a node id.
 */
export function plainTopic(label: string): string {
  const withoutCode = label.replace(/\b[A-Z]{2,}\d[\w-]*\b/g, "").trim();
  const cleaned = withoutCode || label;
  // Prefer a recognisable content noun if present, else a short label.
  const lower = cleaned.toLowerCase();
  for (const topic of ["fraction", "integer", "algebra", "equation", "area", "data", "percentage", "decimal"]) {
    if (lower.includes(topic)) return topic + (topic.endsWith("s") ? "" : "s");
  }
  return lower.split(/\s+/).slice(0, 4).join(" ");
}
