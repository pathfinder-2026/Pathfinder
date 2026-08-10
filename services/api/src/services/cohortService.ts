import { ConflictError } from "../domain/errors";
import {
  DASHBOARD_THRESHOLDS,
  belowMastery,
  isStale,
  latestPerPair,
  type GroupSuggestion,
  type GroupType,
} from "../domain/insights";
import type { MasteryRecord, MisconceptionSignal } from "../domain/mastery";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { DashboardStore, GroupAssignment } from "../ports/dashboardStore";
import type { DataStore } from "../ports/dataStore";

export interface AssignWorkInput {
  type: GroupType;
  nodeId: string | null;
  /** The FINAL membership (Teacher may have removed students before assigning). */
  studentIds: string[];
  contentId?: string | null;
}

/**
 * Milestone 5a — FR-COH-001 / FR-COH-002. Suggests student groupings from the
 * mastery/misconception data (support, misconception, extension, review,
 * peer-learning), all editable before the Teacher assigns work. A student can
 * legitimately appear in more than one suggestion — the Teacher chooses which
 * (or both) to act on; the system never forces one.
 */
export class CohortService {
  private readonly t = DASHBOARD_THRESHOLDS;

  constructor(
    private readonly activity: ActivityStore,
    private readonly dashboards: DashboardStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** FR-COH-001 — suggested groups; each carries a stale-data label when applicable. */
  async suggestGroups(schoolId: string, classId: string): Promise<GroupSuggestion[]> {
    const studentIds = await this.classStudentIds(schoolId, classId);
    const inClass = new Set(studentIds);
    const records = latestPerPair(
      (await this.activity.listMasteryBySchool(schoolId)).filter((r) => inClass.has(r.studentId)),
    );
    const misconceptions = (await this.activity.listMisconceptionsBySchool(schoolId)).filter((m) =>
      inClass.has(m.studentId),
    );
    const nowIso = this.clock.isoNow();
    const groups: GroupSuggestion[] = [];

    // Per-student aggregate (average of latest scores) for support/extension.
    const byStudent = new Map<string, MasteryRecord[]>();
    for (const r of records) {
      if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
      byStudent.get(r.studentId)!.push(r);
    }
    const avg = (recs: MasteryRecord[]) => recs.reduce((s, r) => s + r.score, 0) / recs.length;

    // The class's weakest skill anchors the support / peer-learning groups.
    const focusNode = this.weakestSkill(records);

    // 1. Misconception groups — students sharing the same misconception on a skill.
    const miscKey = (m: MisconceptionSignal) => `${m.nodeId}::${m.misconception}`;
    const miscGroups = new Map<string, MisconceptionSignal[]>();
    for (const m of misconceptions) {
      if (!miscGroups.has(miscKey(m))) miscGroups.set(miscKey(m), []);
      miscGroups.get(miscKey(m))!.push(m);
    }
    for (const [, members] of miscGroups) {
      if (members.length < 2) continue;
      groups.push(
        this.make("misconception", members[0]!.nodeId, members.map((m) => m.studentId), members.map((m) => m.lastSeenAt), nowIso),
      );
    }

    // 2. Support — students below intervention on the class's weakest skill.
    if (focusNode) {
      const weak = records.filter((r) => r.nodeId === focusNode && r.score < this.t.interventionScore);
      if (weak.length >= 2) {
        groups.push(this.make("support", focusNode, weak.map((r) => r.studentId), weak.map((r) => r.lastActivityAt), nowIso));
      }
    }

    // 3. Extension — students secure across their work, ready for challenge.
    const extension = [...byStudent.entries()].filter(([, recs]) => avg(recs) >= this.t.masteryScore).map(([id]) => id);
    if (extension.length >= 1) {
      const at = extension.flatMap((id) => byStudent.get(id)!.map((r) => r.lastActivityAt));
      groups.push(this.make("extension", null, extension, at, nowIso));
    }

    // 4. Peer-learning — students secure on the weakest class skill can peer-teach
    //    the peers who struggle with it. A secure-overall student here also fits
    //    "extension" → the Teacher sees both and chooses (FR-COH-001 edge).
    if (focusNode) {
      const tutors = records
        .filter((r) => r.nodeId === focusNode && !belowMastery(r.score, this.t))
        .map((r) => r.studentId);
      if (tutors.length >= 1) {
        const at = records.filter((r) => r.nodeId === focusNode && tutors.includes(r.studentId)).map((r) => r.lastActivityAt);
        groups.push(this.make("peer-learning", focusNode, tutors, at, nowIso));
      }
    }

    // 5. Review — students whose signals are stale and should be re-checked.
    const staleStudents = [...byStudent.entries()]
      .filter(([, recs]) => recs.every((r) => isStale(r, nowIso, this.t)))
      .map(([id]) => id);
    if (staleStudents.length >= 1) {
      const at = staleStudents.flatMap((id) => byStudent.get(id)!.map((r) => r.lastActivityAt));
      groups.push(this.make("review", null, staleStudents, at, nowIso));
    }

    return groups;
  }

  /**
   * FR-COH-002 — the Teacher assigns work to a group. The membership passed is
   * final: any students the Teacher removed simply aren't included, so only the
   * remaining students receive the assignment.
   */
  async assignWork(
    teacherId: string, schoolId: string, classId: string, input: AssignWorkInput,
  ): Promise<GroupAssignment> {
    await this.requireTeacher(teacherId, schoolId);
    if (input.studentIds.length === 0) {
      throw new ConflictError("EMPTY_GROUP", "Cannot assign work to an empty group.");
    }
    const assignment: GroupAssignment = {
      id: newId(), schoolId, classId, teacherId,
      groupType: input.type, nodeId: input.nodeId,
      studentIds: [...input.studentIds], contentId: input.contentId ?? null,
      createdAt: this.clock.isoNow(),
    };
    await this.dashboards.insertAssignment(assignment);
    this.audit.append({
      action: "cohort.work.assigned",
      actorId: teacherId, subjectType: "class", subjectId: classId,
      metadata: { type: input.type, nodeId: input.nodeId, students: assignment.studentIds.length },
    });
    return assignment;
  }

  // ---- helpers ----

  private make(
    type: GroupType, nodeId: string | null, studentIds: string[], activityTimes: string[], nowIso: string,
  ): GroupSuggestion {
    const uniqueStudents = [...new Set(studentIds)];
    const allStale = activityTimes.length > 0 && activityTimes.every(
      (at) => (new Date(nowIso).getTime() - new Date(at).getTime()) / (24 * 60 * 60 * 1000) > this.t.stalenessDays,
    );
    return {
      id: newId(),
      type,
      nodeId,
      label: LABELS[type],
      studentIds: uniqueStudents,
      basis: allStale ? "stale" : "current",
      staleNote: allStale
        ? "Based on data older than the staleness window — confirm it's still accurate before assigning."
        : null,
    };
  }

  private weakestSkill(records: MasteryRecord[]): string | null {
    const byNode = new Map<string, MasteryRecord[]>();
    for (const r of records) {
      if (!byNode.has(r.nodeId)) byNode.set(r.nodeId, []);
      byNode.get(r.nodeId)!.push(r);
    }
    let worst: string | null = null;
    let worstFraction = -1;
    for (const [nodeId, recs] of byNode) {
      if (recs.length < this.t.insufficientDataMin + 2) continue;
      const below = recs.filter((r) => belowMastery(r.score, this.t)).length / recs.length;
      if (below > worstFraction) { worstFraction = below; worst = nodeId; }
    }
    return worst;
  }

  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may assign group work.");
    }
  }

  private async classStudentIds(schoolId: string, classId: string): Promise<string[]> {
    return (await this.store.listMembershipsBySchool(schoolId))
      .filter((m) => m.role === "student" && m.classId === classId)
      .map((m) => m.userId);
  }
}

const LABELS: Record<GroupType, string> = {
  support: "Support",
  misconception: "Shared misconception",
  extension: "Extension",
  review: "Review (re-check)",
  "peer-learning": "Peer learning",
};
