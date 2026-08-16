import { ConflictError } from "../domain/errors";
import {
  DASHBOARD_THRESHOLDS,
  belowMastery,
  evidenceStrength,
  isStale,
  latestPerPair,
  masteryLevel,
  trendOf,
  type FocusArea,
  type Heatmap,
  type MasteryCell,
  type StudentFlag,
} from "../domain/insights";
import type { MasteryRecord } from "../domain/mastery";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { DashboardStore, GroupAssignment } from "../ports/dashboardStore";
import type { DataStore } from "../ports/dataStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { ContentService } from "./contentService";
import { signedOffGraphs } from "./curriculumScope";

/**
 * Milestone 5a — FR-TDB-001 / FR-CAP-001 (mastery heatmap + flags) and FR-TDB-002
 * (class-level focus-area suggestions). Every output is a Teacher-facing DRAFT:
 * focus material is only ever assigned by an explicit teacher action, and the
 * platform blocks any auto-assign attempt by design (Foundational Decision 7).
 */
export class TeacherDashboardService {
  private readonly t = DASHBOARD_THRESHOLDS;

  constructor(
    private readonly activity: ActivityStore,
    private readonly dashboards: DashboardStore,
    private readonly graph: SkillGraphStore,
    private readonly content: ContentService,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** FR-TDB-001 — per-student, per-skill mastery heatmap with intervention/extension flags. */
  async heatmap(schoolId: string, classId: string): Promise<Heatmap> {
    const students = await this.classStudentIds(schoolId, classId);
    const records = latestPerPair(await this.classMastery(schoolId, students));
    const nowIso = this.clock.isoNow();

    // Edge — insufficient data: a class with no completed work gets a clear
    // "not enough data yet" state, never a blank or misleading heatmap.
    if (records.length === 0) {
      return { enoughData: false, students, skills: [], cells: [], flags: [] };
    }

    const cells: MasteryCell[] = records.map((r) => ({
      studentId: r.studentId,
      nodeId: r.nodeId,
      level: masteryLevel(r.score),
      score: r.score,
      trend: trendOf(r, this.t), // trend, not just the latest point (FR-TDB-001 edge)
      dataPoints: r.dataPoints,
      insufficientData: r.dataPoints < this.t.insufficientDataMin,
      evidence: evidenceStrength(r.dataPoints, this.t),
      stale: isStale(r, nowIso, this.t),
    }));

    const flags: StudentFlag[] = [];
    for (const c of cells) {
      if (c.insufficientData) continue; // don't flag on an untrustworthy signal
      if (c.score < this.t.interventionScore) {
        flags.push({ studentId: c.studentId, nodeId: c.nodeId, kind: "intervention" });
      } else if (!belowMastery(c.score, this.t)) {
        flags.push({ studentId: c.studentId, nodeId: c.nodeId, kind: "extension" });
      }
    }

    const skills = [...new Set(cells.map((c) => c.nodeId))];
    return { enoughData: true, students, skills, cells, flags };
  }

  /**
   * FR-TDB-002 — skills the class collectively needs more instruction on, each
   * with suggested approved material (or a content-gap prompt). Suggestions the
   * Teacher dismissed stay hidden until the data significantly worsens again.
   */
  async classFocusAreas(schoolId: string, classId: string): Promise<FocusArea[]> {
    const students = await this.classStudentIds(schoolId, classId);
    const records = latestPerPair(await this.classMastery(schoolId, students));

    const byNode = new Map<string, MasteryRecord[]>();
    for (const r of records) {
      if (!byNode.has(r.nodeId)) byNode.set(r.nodeId, []);
      byNode.get(r.nodeId)!.push(r);
    }

    const dismissals = await this.dashboards.listDismissals(schoolId, classId);
    const suggested = await this.approvedMaterialByNode(schoolId);
    const areas: FocusArea[] = [];

    for (const [nodeId, recs] of byNode) {
      const total = recs.length;
      // A class-level signal needs a real cohort, not a handful of students.
      if (total < this.t.insufficientDataMin + 2) continue;
      const belowCount = recs.filter((r) => belowMastery(r.score, this.t)).length;
      const belowFraction = belowCount / total;
      if (belowFraction < this.t.focusAreaFraction) continue;

      // Dismissed → suppress unless the below-mastery fraction has worsened by
      // at least the reappearance delta since the Teacher dismissed it.
      const dismissed = dismissals.find((d) => d.nodeId === nodeId);
      if (dismissed && belowFraction < dismissed.belowFractionAtDismiss + this.t.worsenReappearDelta) {
        continue;
      }

      const contentIds = suggested.get(nodeId) ?? [];
      areas.push({
        nodeId,
        belowCount,
        total,
        belowFraction,
        suggestedContentIds: contentIds,
        contentGap: contentIds.length === 0,
      });
    }
    return areas.sort((a, b) => b.belowFraction - a.belowFraction);
  }

  /** Record that a Teacher dismissed a focus-area suggestion (reappearance basis). */
  async dismissFocusArea(teacherId: string, schoolId: string, classId: string, nodeId: string): Promise<void> {
    const students = await this.classStudentIds(schoolId, classId);
    const recs = latestPerPair(await this.classMastery(schoolId, students)).filter((r) => r.nodeId === nodeId);
    const belowFraction = recs.length ? recs.filter((r) => belowMastery(r.score, this.t)).length / recs.length : 0;
    await this.dashboards.insertDismissal({
      id: newId(), schoolId, classId, teacherId, nodeId,
      belowFractionAtDismiss: belowFraction, dismissedAt: this.clock.isoNow(),
    });
    this.audit.append({
      action: "dashboard.focus.dismissed",
      actorId: teacherId, subjectType: "class", subjectId: classId,
      metadata: { nodeId, belowFraction },
    });
  }

  /**
   * FR-TDB-002 (auto-assign blocked) — assigning focus material to a class ALWAYS
   * requires an explicit teacher action. A call with no real Teacher actor (an
   * automated/future feature) is blocked at the platform level, by design.
   */
  async assignFocusMaterial(
    actorId: string, schoolId: string, classId: string, nodeId: string, contentId: string,
  ): Promise<GroupAssignment> {
    await this.requireTeacher(actorId, schoolId);
    const studentIds = await this.classStudentIds(schoolId, classId);
    const assignment: GroupAssignment = {
      id: newId(), schoolId, classId, teacherId: actorId,
      groupType: "support", nodeId, studentIds, contentId,
      createdAt: this.clock.isoNow(),
    };
    await this.dashboards.insertAssignment(assignment);
    this.audit.append({
      action: "dashboard.focus.assigned",
      actorId, subjectType: "class", subjectId: classId,
      metadata: { nodeId, contentId, students: studentIds.length },
    });
    return assignment;
  }

  // ---- helpers ----

  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    const isTeacher = memberships.some((m) => m.schoolId === schoolId && m.role === "teacher");
    if (!isTeacher) {
      throw new ConflictError(
        "AUTO_ASSIGN_BLOCKED",
        "Assigning suggested material requires an explicit teacher action — auto-assign is blocked by design.",
      );
    }
  }

  private async classStudentIds(schoolId: string, classId: string): Promise<string[]> {
    return (await this.store.listMembershipsBySchool(schoolId))
      .filter((m) => m.role === "student" && m.classId === classId)
      .map((m) => m.userId);
  }

  private async classMastery(schoolId: string, studentIds: string[]): Promise<MasteryRecord[]> {
    const inClass = new Set(studentIds);
    return (await this.activity.listMasteryBySchool(schoolId)).filter((r) => inClass.has(r.studentId));
  }

  /** node → approved content item ids mapped to it (the reteach candidates). */
  private async approvedMaterialByNode(schoolId: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    // Spans every signed-off graph: a class's reteach material lives in its own
    // subject's graph, so one version's mappings would miss all the others.
    for (const version of await signedOffGraphs(this.graph, schoolId)) {
      for (const mapping of await this.graph.listMappingsByVersion(version.id)) {
        if (!(await this.content.isInApprovedPool(mapping.contentItemId))) continue;
        if (!out.has(mapping.nodeId)) out.set(mapping.nodeId, []);
        const list = out.get(mapping.nodeId)!;
        if (!list.includes(mapping.contentItemId)) list.push(mapping.contentItemId);
      }
    }
    return out;
  }
}
