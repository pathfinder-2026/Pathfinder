import { ConflictError, NotFoundError } from "../domain/errors";
import { latestPerPair, masteryLevel } from "../domain/insights";
import {
  mean,
  PRINCIPAL_THRESHOLDS,
  type ClassDrillView,
  type ClassMasterySummary,
  type PrincipalAlert,
  type SchoolMasteryOverview,
  type SchoolPolicy,
  type SchoolTeacherReport,
  type StudentDrillView,
  type TeacherMetrics,
} from "../domain/principal";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { ActivityStore } from "../ports/activityStore";
import type { AgentStore } from "../ports/agentStore";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { DataStore } from "../ports/dataStore";
import type { WorkspaceStore } from "../ports/workspaceStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const MASTERY = 0.67;

export interface PrincipalExport {
  teacherReport: SchoolTeacherReport;
  masteryOverview: SchoolMasteryOverview;
}

/**
 * Milestone 9 — Principal Dashboard (FR-PDB-001..006). Whole-school, single-campus.
 *
 * PRIVACY INVARIANT (non-negotiable DoD): this service NEVER reads Ask-for-Help
 * transcripts. It does not call any help-session/help-message method, and no value
 * it returns carries transcript content — not the dashboard, not a drill-down, not
 * an alert, not an export. A dual-role Principal-Teacher can still read transcripts
 * for their OWN classes, but only via their Teacher capacity (AskForHelpService),
 * never through any surface here.
 */
export class PrincipalDashboardService {
  private readonly t = PRINCIPAL_THRESHOLDS;

  constructor(
    private readonly store: DataStore,
    private readonly activity: ActivityStore,
    private readonly assessments: AssessmentStore,
    private readonly agents: AgentStore,
    /** Used for TASKS ONLY — never the help-session/help-message methods. */
    private readonly workspace: WorkspaceStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  // ---- FR-PDB-001 — teacher metrics ----

  async teacherReport(principalId: string, schoolId: string): Promise<SchoolTeacherReport> {
    await this.requirePrincipal(principalId, schoolId);
    const now = this.clock.now().getTime();
    const teacherIds = [...new Set(
      (await this.store.listMembershipsBySchool(schoolId)).filter((m) => m.role === "teacher").map((m) => m.userId),
    )];

    const teachers: TeacherMetrics[] = [];
    const coverageAll = new Set<string>();
    for (const teacherId of teacherIds) {
      const assessments = await this.assessments.listAssessmentsByTeacher(teacherId);
      const authored = assessments.length;
      const published = assessments.filter((a) => a.status === "published").length;
      const drafts = await this.agents.listSuggestionsByTeacher(teacherId);
      const edited = drafts.filter((d) => d.edited).length;
      const tasks = await this.workspace.listTasksByTeacher(teacherId);

      const nodes = new Set<string>();
      for (const a of assessments) if (a.request.nodeId) nodes.add(a.request.nodeId);
      for (const tk of tasks) if (tk.nodeId) nodes.add(tk.nodeId);
      nodes.forEach((n) => coverageAll.add(n));

      const engagement = authored + drafts.length + tasks.length;
      const user = await this.store.getUser(teacherId);
      const windowDays = user ? Math.max(0, Math.round((now - new Date(user.createdAt).getTime()) / DAY_MS)) : 9999;
      const newTeacher = windowDays <= this.t.newTeacherDays;
      const pd = await this.store.getPersonalData(teacherId);

      teachers.push({
        teacherId, name: pd ? `${pd.firstName} ${pd.lastName}` : null,
        coverage: nodes.size, assessmentsAuthored: authored, assessmentsPublished: published,
        aiApprovalRate: authored ? published / authored : 0,
        aiDrafts: drafts.length, aiDraftsEdited: edited, editRate: drafts.length ? edited / drafts.length : 0,
        engagement, workload: tasks.length + authored,
        newTeacher, windowDays,
        // A brand-new teacher is contextualised (shorter window), never flagged as
        // a low-engagement outlier or compared unfairly (FR-PDB-001 edge).
        lowEngagementOutlier: engagement <= this.t.lowEngagementMax && !newTeacher,
      });
    }

    const policy = await this.policy(schoolId);
    return {
      teachers,
      schoolWide: {
        teacherCount: teachers.length,
        avgEngagement: mean(teachers.map((t) => t.engagement)),
        avgAiApprovalRate: mean(teachers.map((t) => t.aiApprovalRate)),
        coverage: coverageAll.size,
      },
      // FR-PDB-006 — the teacher-to-teacher comparison view only exists when policy allows.
      comparison: policy.teacherComparisonEnabled
        ? { ranking: [...teachers].sort((a, b) => b.engagement - a.engagement).map((t) => ({ teacherId: t.teacherId, name: t.name, engagement: t.engagement })) }
        : null,
    };
  }

  // ---- FR-PDB-002 — school-wide mastery / risk ----

  async masteryOverview(principalId: string, schoolId: string): Promise<SchoolMasteryOverview> {
    await this.requirePrincipal(principalId, schoolId);
    const classes = await this.store.listClassesBySchool(schoolId);
    const records = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic));

    const summaries: ClassMasterySummary[] = [];
    for (const klass of classes) {
      const studentIds = await this.classStudentIds(schoolId, klass.id);
      const recs = records.filter((r) => studentIds.has(r.studentId));
      if (recs.length === 0) continue;
      const avg = mean(recs.map((r) => r.score));
      const below = recs.filter((r) => r.score < MASTERY).length / recs.length;
      const atRisk = new Set(recs.filter((r) => r.score < 0.34).map((r) => r.studentId)).size;
      summaries.push({ classId: klass.id, name: klass.name, studentCount: studentIds.size, avgScore: avg, belowMasteryFraction: below, atRiskCount: atRisk, outlier: false });
    }

    const schoolAvg = mean(summaries.map((s) => s.avgScore));
    for (const s of summaries) s.outlier = s.avgScore <= schoolAvg - this.t.classOutlierDelta;
    return { classes: summaries, schoolWide: { avgScore: schoolAvg, atRiskCount: summaries.reduce((a, s) => a + s.atRiskCount, 0), classCount: summaries.length } };
  }

  // ---- FR-PDB-003 — drill-down (school -> class -> student) ----

  async drillClass(principalId: string, schoolId: string, classId: string): Promise<ClassDrillView> {
    await this.requirePrincipal(principalId, schoolId);
    const klass = await this.store.getClass(classId);
    if (!klass || klass.schoolId !== schoolId) throw new NotFoundError("Class not found in this school.");
    const studentIds = await this.classStudentIds(schoolId, classId);
    const records = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic && studentIds.has(m.studentId)));
    const students = [];
    for (const studentId of studentIds) {
      const recs = records.filter((r) => r.studentId === studentId);
      const avg = mean(recs.map((r) => r.score));
      students.push({ studentId, name: await this.name(studentId), avgScore: avg, atRisk: recs.some((r) => r.score < 0.34) });
    }
    return { classId, name: klass.name, students };
  }

  async drillStudent(principalId: string, schoolId: string, studentId: string): Promise<StudentDrillView> {
    await this.requirePrincipal(principalId, schoolId);
    const records = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic && m.studentId === studentId));
    const tasksCompleted = (await this.workspace.listTasksByStudent(studentId)).filter((tk) => tk.status === "completed").length;
    return {
      studentId, name: await this.name(studentId),
      avgScore: mean(records.map((r) => r.score)),
      skills: records.map((r) => ({ nodeId: r.nodeId, score: r.score, level: masteryLevel(r.score) })),
      tasksCompleted,
      // Ask-for-Help transcripts are excluded even at the deepest drill level.
      askForHelpExcluded: true,
    };
  }

  /** FR-PDB-003 edge — cross-campus comparison is out of MVP scope; not offered. */
  async compareCampuses(principalId: string, schoolId: string): Promise<never> {
    await this.requirePrincipal(principalId, schoolId);
    throw new ConflictError("OUT_OF_MVP_SCOPE", "Cross-campus comparison is out of MVP scope.");
  }

  // ---- FR-PDB-004 — alerts ----

  async detectAlerts(principalId: string, schoolId: string, opts: { breakWindow?: { start: string; end: string } } = {}): Promise<PrincipalAlert[]> {
    await this.requirePrincipal(principalId, schoolId);
    const nowIso = this.clock.isoNow();
    // Expected seasonal dip: if "now" is inside a configured break, do not flag.
    if (opts.breakWindow && nowIso >= opts.breakWindow.start && nowIso <= opts.breakWindow.end) return [];

    const classes = await this.store.listClassesBySchool(schoolId);
    const records = (await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic);
    const alerts: PrincipalAlert[] = [];
    for (const klass of classes) {
      const studentIds = await this.classStudentIds(schoolId, klass.id);
      const recs = records.filter((r) => studentIds.has(r.studentId));
      if (recs.length === 0) continue;
      // Baseline = earliest signal in each record's history; current = latest score.
      const baseline = mean(recs.map((r) => (r.history && r.history.length ? r.history[0]! : r.score)));
      const current = mean(recs.map((r) => r.score));
      const delta = baseline - current;
      // Only meaningful drops surface — small fluctuations are noise (no alert fatigue).
      if (delta >= this.t.masteryDropAlertDelta) {
        alerts.push({ kind: "mastery_drop", classId: klass.id, message: `${klass.name} mastery dropped sharply this period.`, delta: round2(delta) });
      }
    }
    return alerts;
  }

  // ---- FR-PDB-005 — export (never any transcript) ----

  async exportReport(principalId: string, schoolId: string): Promise<PrincipalExport> {
    await this.requirePrincipal(principalId, schoolId);
    // Composed only of aggregated teacher + mastery data — structurally no transcripts.
    return {
      teacherReport: await this.teacherReport(principalId, schoolId),
      masteryOverview: await this.masteryOverview(principalId, schoolId),
    };
  }

  // ---- FR-PDB-006 — policy ----

  async setPolicy(adminId: string, schoolId: string, input: { teacherComparisonEnabled: boolean }): Promise<SchoolPolicy> {
    await this.requireAdmin(adminId, schoolId);
    const policy: SchoolPolicy = { schoolId, teacherComparisonEnabled: input.teacherComparisonEnabled, updatedAt: this.clock.isoNow() };
    await this.store.saveSchoolPolicy(policy);
    this.audit.append({ action: "principal.policy.set", actorId: adminId, subjectType: "school", subjectId: schoolId, metadata: { teacherComparisonEnabled: input.teacherComparisonEnabled } });
    return policy;
  }

  // ---- helpers ----

  private async policy(schoolId: string): Promise<SchoolPolicy> {
    return (await this.store.getSchoolPolicy(schoolId)) ?? { schoolId, teacherComparisonEnabled: false, updatedAt: null };
  }

  private async classStudentIds(schoolId: string, classId: string): Promise<Set<string>> {
    return new Set(
      (await this.store.listMembershipsBySchool(schoolId)).filter((m) => m.role === "student" && m.classId === classId).map((m) => m.userId),
    );
  }

  private async name(userId: string): Promise<string | null> {
    const pd = await this.store.getPersonalData(userId);
    return pd ? `${pd.firstName} ${pd.lastName}` : null;
  }

  private async requirePrincipal(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "principal")) {
      throw new ConflictError("NOT_A_PRINCIPAL", "Only a Principal may view the school dashboard.");
    }
  }

  private async requireAdmin(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "admin")) {
      throw new ConflictError("NOT_AN_ADMIN", "Only a School Admin may set school policy.");
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
