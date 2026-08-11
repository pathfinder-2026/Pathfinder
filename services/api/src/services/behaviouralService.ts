import { ConflictError, ValidationError } from "../domain/errors";
import { defaultSchoolPolicy } from "../domain/principal";
import {
  BEHAVIOURAL_CATEGORIES,
  type BehaviouralAggregate,
  type BehaviouralCategory,
  type BehaviouralObservation,
  type BehaviouralVisibility,
} from "../domain/reporting";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";
import type { ReportingStore } from "../ports/reportingStore";

export interface BehaviouralView {
  visibility: BehaviouralVisibility;
  /** Note text — only for viewers permitted to see notes (author Teacher / Admin). */
  notes: BehaviouralObservation[];
  /** Category counts — for aggregate-only viewers (Principal). */
  aggregate: BehaviouralAggregate[];
}

/**
 * Milestone 10 — FR-BSS-001/002. Teacher-authored behavioural/social observations,
 * in a data model SEPARATE from academic mastery. The v1.3 MVP default:
 *   - the four named categories ONLY;
 *   - NO AI inference — there is no code path that auto-scores a trait;
 *   - collection is DISABLED until the school configures its parental-consent
 *     mechanism (a per-school policy sign-off gate);
 *   - visibility per persona: author Teacher + Admin see notes, Principal sees an
 *     aggregate only, Parent is hidden until the school enables it.
 */
export class BehaviouralService {
  constructor(
    private readonly reporting: ReportingStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** The parental-consent mechanism sign-off that lets collection go live. */
  async configureConsent(adminId: string, schoolId: string): Promise<void> {
    await this.requireRole(adminId, schoolId, "admin");
    const policy = { ...(await this.policy(schoolId)), behaviouralConsentConfigured: true, updatedAt: this.clock.isoNow() };
    await this.store.saveSchoolPolicy(policy);
    this.audit.append({ action: "behavioural.consent.configured", actorId: adminId, subjectType: "school", subjectId: schoolId, metadata: {} });
  }

  /** The school explicitly enables (or disables) Parent visibility of behavioural data. */
  async setParentVisibility(adminId: string, schoolId: string, visible: boolean): Promise<void> {
    await this.requireRole(adminId, schoolId, "admin");
    const policy = { ...(await this.policy(schoolId)), behaviouralParentVisible: visible, updatedAt: this.clock.isoNow() };
    await this.store.saveSchoolPolicy(policy);
  }

  /**
   * Record a teacher-authored observation. Blocked until consent is configured;
   * restricted to the four categories; never carries an AI-inferred score.
   */
  async recordObservation(teacherId: string, schoolId: string, input: { studentId: string; category: BehaviouralCategory; note: string }): Promise<BehaviouralObservation> {
    await this.requireRole(teacherId, schoolId, "teacher");
    const policy = await this.policy(schoolId);
    if (!policy.behaviouralConsentConfigured) {
      throw new ConflictError("CONSENT_NOT_CONFIGURED", "Behavioural/social collection is disabled until the school configures its parental-consent mechanism.");
    }
    if (!BEHAVIOURAL_CATEGORIES.includes(input.category)) {
      throw new ValidationError(`Category must be one of: ${BEHAVIOURAL_CATEGORIES.join(", ")}.`);
    }
    if (!input.note.trim()) throw new ValidationError("A teacher-authored observation note is required.");

    const observation: BehaviouralObservation = {
      id: newId(), schoolId, studentId: input.studentId, category: input.category, note: input.note,
      authorTeacherId: teacherId, createdAt: this.clock.isoNow(),
    };
    await this.reporting.insertObservation(observation);
    this.audit.append({ action: "behavioural.observed", actorId: teacherId, subjectType: "student", subjectId: input.studentId, metadata: { category: input.category } });
    return observation;
  }

  /**
   * Blocked by design (FR-BSS-002): the MVP never auto-scores a character trait
   * from observation data. There is no inference pathway — this exists only to make
   * the guarantee explicit and testable.
   */
  async autoScore(): Promise<never> {
    throw new ConflictError("BEHAVIOURAL_INFERENCE_BLOCKED", "No AI-generated behavioural inference in the MVP — only direct teacher-authored observations are stored and shown.");
  }

  /** Per-persona view of a student's behavioural data (the v1.3 default matrix). */
  async observationsFor(viewerId: string, schoolId: string, studentId: string): Promise<BehaviouralView> {
    const roles = (await this.store.listMembershipsByUser(viewerId)).filter((m) => m.schoolId === schoolId).map((m) => m.role);
    const all = await this.reporting.listObservationsByStudent(studentId);
    const aggregate = aggregateBy(all);

    if (roles.includes("admin")) return { visibility: "notes", notes: all, aggregate };
    if (roles.includes("teacher")) {
      const own = all.filter((o) => o.authorTeacherId === viewerId);
      return { visibility: "notes", notes: own, aggregate: aggregateBy(own) };
    }
    if (roles.includes("principal")) return { visibility: "aggregate", notes: [], aggregate };
    if (roles.includes("parent")) {
      const policy = await this.policy(schoolId);
      return policy.behaviouralParentVisible
        ? { visibility: "aggregate", notes: [], aggregate }
        : { visibility: "hidden", notes: [], aggregate: [] };
    }
    return { visibility: "hidden", notes: [], aggregate: [] };
  }

  // ---- helpers ----

  private async policy(schoolId: string) {
    return (await this.store.getSchoolPolicy(schoolId)) ?? defaultSchoolPolicy(schoolId);
  }

  private async requireRole(actorId: string, schoolId: string, role: "admin" | "teacher"): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === role)) {
      throw new ConflictError(role === "admin" ? "NOT_AN_ADMIN" : "NOT_A_TEACHER", `Only a ${role} may perform this action.`);
    }
  }
}

function aggregateBy(observations: BehaviouralObservation[]): BehaviouralAggregate[] {
  const counts = new Map<BehaviouralCategory, number>();
  for (const o of observations) counts.set(o.category, (counts.get(o.category) ?? 0) + 1);
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}
