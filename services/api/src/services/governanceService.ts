import { ConflictError, NotFoundError } from "../domain/errors";
import { defaultSchoolPolicy } from "../domain/principal";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { ActivityStore } from "../ports/activityStore";
import type { DataStore } from "../ports/dataStore";
import type { ReportingStore } from "../ports/reportingStore";
import type { WorkspaceStore } from "../ports/workspaceStore";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EraseResult {
  erased: boolean;
  requiresConfirmation?: boolean;
  /** What an erasure would affect — shown to the Admin before they confirm. */
  affected?: { activeEnrolment: boolean; tasks: number };
}

/**
 * Milestone 11 — governance operations (FR-GOV-003 retention, FR-GOV-006
 * data-subject access/export/erasure).
 *
 * Erasure removes PII (personal_data) while the id-only, hash-chained audit rows
 * persist unchanged — so audited facts remain and the chain stays verifiable
 * without retaining PII (Decision 6). The retention job deletes aged data and logs
 * its OWN deletions to the append-only audit (Decision 3).
 */
export class GovernanceService {
  constructor(
    private readonly store: DataStore,
    private readonly workspace: WorkspaceStore,
    private readonly reporting: ReportingStore,
    private readonly activity: ActivityStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  // ---- FR-GOV-003 — retention ----

  async configureRetention(adminId: string, schoolId: string, days: number): Promise<void> {
    await this.requireAdmin(adminId, schoolId);
    if (!(days > 0)) throw new ConflictError("INVALID_RETENTION", "Retention must be a positive number of days.");
    const policy = { ...(await this.policy(schoolId)), retentionDays: days, updatedAt: this.clock.isoNow() };
    await this.store.saveSchoolPolicy(policy);
    this.audit.append({ action: "retention.configured", actorId: adminId, subjectType: "school", subjectId: schoolId, metadata: { days } });
  }

  /**
   * Run the retention job: delete data older than the configured period and LOG
   * the deletion itself (Decision 3). Applied to Ask-for-Help transcripts here.
   */
  async runRetention(schoolId: string, asOfIso?: string): Promise<{ deleted: number }> {
    const policy = await this.policy(schoolId);
    if (policy.retentionDays === null) return { deleted: 0 };
    const asOf = asOfIso ? new Date(asOfIso).getTime() : this.clock.now().getTime();
    const cutoff = new Date(asOf - policy.retentionDays * DAY_MS).toISOString();
    const deleted = await this.workspace.deleteHelpMessagesBefore(cutoff);
    // The deletion is itself logged to the append-only audit.
    this.audit.append({ action: "retention.deleted", actorId: null, subjectType: "school", subjectId: schoolId, metadata: { deleted, cutoff, kind: "help_messages" } });
    return { deleted };
  }

  // ---- FR-GOV-006 — data-subject access / export / erasure ----

  /** A complete, human-readable export of one student's personal data + records. */
  async exportStudent(adminId: string, schoolId: string, studentId: string): Promise<Record<string, unknown>> {
    await this.requireAdmin(adminId, schoolId);
    const personalData = await this.store.getPersonalData(studentId);
    const memberships = (await this.store.listMembershipsByUser(studentId)).map((m) => ({ role: m.role, classId: m.classId }));
    const mastery = (await this.activity.listMasteryBySchool(schoolId)).filter((r) => r.studentId === studentId).map((r) => ({ nodeId: r.nodeId, score: r.score, level: r.level }));
    const tasks = (await this.workspace.listTasksByStudent(studentId)).map((t) => ({ title: t.title, type: t.type, status: t.status, dueDate: t.dueDate }));
    const coCurricular = (await this.reporting.listCoCurricularByStudent(studentId)).map((r) => ({ domain: r.domain, skill: r.skill, level: r.level }));
    const behavioural = (await this.reporting.listObservationsByStudent(studentId)).map((o) => ({ category: o.category, note: o.note }));
    this.audit.append({ action: "datasubject.exported", actorId: adminId, subjectType: "user", subjectId: studentId, metadata: {} });
    return { studentId, personalData: personalData ?? null, memberships, mastery, tasks, coCurricular, behavioural };
  }

  /**
   * Erase a student's PII platform-wide. Active records require an explicit
   * confirm; PII-only erasure is the default (never destructive record deletion).
   * The immutable audited facts remain and the hash chain is preserved.
   */
  async eraseStudent(adminId: string, schoolId: string, studentId: string, opts: { confirm?: boolean } = {}): Promise<EraseResult> {
    await this.requireAdmin(adminId, schoolId);
    const user = await this.store.getUser(studentId);
    if (!user) throw new NotFoundError("Student not found.");

    const activeEnrolment = Boolean(await this.store.getActiveEnrolmentForStudent(studentId));
    const taskCount = (await this.workspace.listTasksByStudent(studentId)).length;
    if ((activeEnrolment || taskCount > 0) && !opts.confirm) {
      return { erased: false, requiresConfirmation: true, affected: { activeEnrolment, tasks: taskCount } };
    }

    await this.store.deletePersonalData(studentId); // remove the person (PII)
    await this.store.updateUser({ ...user, status: "erased" });
    // The erasure is logged (Decision 3). Audit rows reference the id only, so the
    // hash chain remains verifiable and no PII is retained.
    this.audit.append({ action: "datasubject.erased", actorId: adminId, subjectType: "user", subjectId: studentId, metadata: { piiRemoved: true } });
    return { erased: true };
  }

  // ---- helpers ----

  private async policy(schoolId: string) {
    return (await this.store.getSchoolPolicy(schoolId)) ?? defaultSchoolPolicy(schoolId);
  }

  private async requireAdmin(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "admin")) {
      throw new ConflictError("NOT_AN_ADMIN", "Only a School Admin may run governance operations.");
    }
  }
}
