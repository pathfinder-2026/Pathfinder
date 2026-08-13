import { AuthError, ConflictError, NotFoundError } from "../domain/errors";
import { latestPerPair, masteryLevel } from "../domain/insights";
import { plainTopic } from "../domain/parent";
import { mean } from "../domain/principal";
import {
  proratedCost,
  type CostReport,
  type Licence,
  type ParentReport,
  type SchoolReport,
  type TeacherComment,
  type TeacherGrowthReport,
} from "../domain/reporting";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { AgentStore } from "../ports/agentStore";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { DataStore } from "../ports/dataStore";
import type { ParentStore } from "../ports/parentStore";
import type { ReportingStore } from "../ports/reportingStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_TERM_MIN_DAYS = 42; // < 6 weeks of data => flagged limited/early
const MASTERY = 0.67;

/**
 * Milestone 10 — Reporting (FR-REP-001/002/004). Academic + co-curricular + (where
 * permitted) behavioural data, aggregated into reports. Partial-term data is
 * flagged; empty sections are omitted gracefully; cost reports prorate.
 */
export class ReportingService {
  constructor(
    private readonly reporting: ReportingStore,
    private readonly activity: ActivityStore,
    private readonly assessments: AssessmentStore,
    private readonly agents: AgentStore,
    private readonly parents: ParentStore,
    private readonly store: DataStore,
    private readonly graph: SkillGraphStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async addComment(teacherId: string, schoolId: string, studentId: string, text: string): Promise<TeacherComment> {
    await this.requireRole(teacherId, schoolId, "teacher");
    const comment: TeacherComment = { id: newId(), schoolId, studentId, teacherId, text, createdAt: this.clock.isoNow() };
    await this.reporting.insertComment(comment);
    return comment;
  }

  async addLicence(adminId: string, schoolId: string, input: { seats: number; monthlyRate: number; startDate: string; endDate?: string | null }): Promise<Licence> {
    await this.requireRole(adminId, schoolId, "admin");
    const licence: Licence = { id: newId(), schoolId, seats: input.seats, monthlyRate: input.monthlyRate, startDate: input.startDate, endDate: input.endDate ?? null, createdAt: this.clock.isoNow() };
    await this.reporting.insertLicence(licence);
    return licence;
  }

  /** FR-REP-001 — a class growth report reflecting the term's mastery changes. */
  async teacherGrowthReport(teacherId: string, schoolId: string, classId: string): Promise<TeacherGrowthReport> {
    await this.requireRole(teacherId, schoolId, "teacher");
    const klass = await this.store.getClass(classId);
    if (!klass || klass.schoolId !== schoolId) throw new NotFoundError("Class not found in this school.");
    const studentIds = await this.classStudentIds(schoolId, classId);
    const records = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic && studentIds.has(m.studentId)));

    const byNode = new Map<string, { baselines: number[]; currents: number[] }>();
    for (const r of records) {
      const g = byNode.get(r.nodeId) ?? { baselines: [], currents: [] };
      g.baselines.push(r.history && r.history.length ? r.history[0]! : r.score);
      g.currents.push(r.score);
      byNode.set(r.nodeId, g);
    }
    const growth = [...byNode.entries()].map(([nodeId, g]) => {
      const baseline = round2(mean(g.baselines));
      const current = round2(mean(g.currents));
      return { nodeId, baseline, current, change: round2(current - baseline) };
    });

    // Limited/early when the data window is shorter than a full term.
    const now = this.clock.now().getTime();
    const earliest = records.length ? Math.min(...records.map((r) => new Date(r.lastActivityAt).getTime())) : now;
    const spanDays = (now - earliest) / DAY_MS;
    const limited = records.length > 0 && spanDays < FULL_TERM_MIN_DAYS;
    return {
      classId, className: klass.name, growth, limited,
      note: limited ? "Based on limited/early data (less than a full term) — interpret with caution." : null,
    };
  }

  /** FR-REP-002 — the whole-school report, aggregating all classes in THIS school. */
  async schoolReport(principalId: string, schoolId: string, monthIso: string): Promise<SchoolReport> {
    // School-level only (FR-REP-002). Principals read it for oversight; Admins
    // read it too because the prorated cost line is theirs to reconcile (ADM-9).
    await this.requireOneOf(principalId, schoolId, ["principal", "admin"]);
    const classes = await this.store.listClassesBySchool(schoolId);
    const records = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic));

    let atRisk = 0;
    const classAvgs: number[] = [];
    for (const klass of classes) {
      const ids = await this.classStudentIds(schoolId, klass.id);
      const recs = records.filter((r) => ids.has(r.studentId));
      if (recs.length === 0) continue;
      classAvgs.push(mean(recs.map((r) => r.score)));
      atRisk += new Set(recs.filter((r) => r.score < 0.34).map((r) => r.studentId)).size;
    }

    const teacherIds = [...new Set((await this.store.listMembershipsBySchool(schoolId)).filter((m) => m.role === "teacher").map((m) => m.userId))];
    let assessmentsGenerated = 0;
    for (const t of teacherIds) assessmentsGenerated += (await this.assessments.listAssessmentsByTeacher(t)).length;
    const agentDrafts = (await this.agents.listSuggestionsBySchool(schoolId)).length;

    return {
      schoolId,
      performance: { avgScore: round2(mean(classAvgs)), classCount: classAvgs.length, atRiskCount: atRisk },
      coverage: new Set(records.map((r) => r.nodeId)).size,
      usage: { assessmentsGenerated, agentDrafts },
      cost: await this.costReport(schoolId, monthIso),
    };
  }

  /** FR-REP-002 edge — prorated cost for a partial month. */
  async costReport(schoolId: string, monthIso: string): Promise<CostReport> {
    const licences = await this.reporting.listLicencesBySchool(schoolId);
    const lines = licences.map((l) => {
      const { cost, prorated } = proratedCost(l, monthIso);
      return { licenceId: l.id, seats: l.seats, monthlyRate: l.monthlyRate, proratedCost: cost, prorated };
    });
    return { month: monthIso, lines, total: round2(lines.reduce((a, l) => a + l.proratedCost, 0)) };
  }

  /** FR-REP-004 — the parent's term report for a VERIFIED child. */
  async parentReport(parentId: string, schoolId: string, studentId: string): Promise<ParentReport> {
    const link = await this.parents.findLink(parentId, studentId);
    if (!link || !link.verified) throw new AuthError("No verified relationship to this student.");

    const labels = await this.nodeLabels(schoolId);
    const mastery = latestPerPair((await this.activity.listMasteryBySchool(schoolId)).filter((m) => !m.synthetic && m.studentId === studentId));
    const strengths = dedupe(mastery.filter((m) => m.score >= MASTERY).map((m) => plainTopic(labels.get(m.nodeId) ?? m.nodeId)));
    const focusAreas = dedupe(mastery.filter((m) => m.score < MASTERY).map((m) => plainTopic(labels.get(m.nodeId) ?? m.nodeId)));
    // Empty sections are omitted gracefully (empty arrays), never a broken placeholder.
    const teacherComments = (await this.reporting.listCommentsByStudent(studentId)).map((c) => c.text);
    const coCurricular = (await this.reporting.listCoCurricularByStudent(studentId)).map((r) => ({ domain: r.domain, skill: r.skill, level: r.level }));
    const childName = (await this.store.getPersonalData(studentId))?.firstName ?? null;

    return { studentId, childName, strengths, focusAreas, teacherComments, coCurricular };
  }

  // ---- helpers ----

  private async nodeLabels(schoolId: string): Promise<Map<string, string>> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    const version = await this.graph.latestSignedOffVersion(config?.curriculum ?? "NSW");
    const map = new Map<string, string>();
    if (!version) return map;
    for (const n of await this.graph.listNodes(version.id)) map.set(n.id, n.label);
    return map;
  }

  private async classStudentIds(schoolId: string, classId: string): Promise<Set<string>> {
    return new Set((await this.store.listMembershipsBySchool(schoolId)).filter((m) => m.role === "student" && m.classId === classId).map((m) => m.userId));
  }

  private async requireRole(actorId: string, schoolId: string, role: "admin" | "teacher" | "principal"): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === role)) {
      throw new ConflictError(`NOT_A_${role.toUpperCase()}`, `Only a ${role} may perform this action.`);
    }
  }

  private async requireOneOf(actorId: string, schoolId: string, roles: ("admin" | "teacher" | "principal")[]): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && roles.includes(m.role as never))) {
      throw new ConflictError("ROLE_REQUIRED", `Only ${roles.join(" or ")} may perform this action.`);
    }
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function dedupe(items: string[]): string[] { return [...new Set(items.filter(Boolean))]; }
