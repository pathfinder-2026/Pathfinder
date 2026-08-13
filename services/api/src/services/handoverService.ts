import { ConflictError, NotFoundError } from "../domain/errors";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { DataStore } from "../ports/dataStore";
import type { WorkspaceStore } from "../ports/workspaceStore";

export interface HandoverResult {
  classId: string | null;
  tasksTransferred: number;
  helpSessionsTransferred: number;
}

/**
 * Teacher-absence cover (an FR-ADM-002 extension, owner-requested 2026-08-13).
 *
 * When a teacher is absent, an Admin hands their class over to a covering
 * teacher. DELIBERATELY NOT login sharing: sharing credentials would corrupt
 * the audit trail's actor attribution (Decision 3) and the safeguarding /
 * transcript governance that hangs off it. Instead, the covering teacher gets
 * everything through their OWN login:
 *   - the class membership moves (dashboard, insights, cohorts, year-group
 *     calendar all key off membership.classId);
 *   - the absent teacher's assigned tasks transfer, so overdue alerts route to
 *     the covering teacher;
 *   - Ask-for-Help sessions transfer WITH their tasks, so the covering teacher
 *     becomes the assigning teacher the M7/M9 transcript rule points at — the
 *     rule itself stays intact (one assigning teacher, never a broadened read).
 * The handover is a single audited action (ids only).
 */
export class HandoverService {
  constructor(
    private readonly store: DataStore,
    private readonly workspace: WorkspaceStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async coverClass(adminId: string, schoolId: string, fromTeacherId: string, toTeacherId: string): Promise<HandoverResult> {
    await this.requireAdmin(adminId, schoolId);
    if (fromTeacherId === toTeacherId) {
      throw new ConflictError("SAME_TEACHER", "Choose a different covering teacher.");
    }
    const memberships = await this.store.listMembershipsBySchool(schoolId);
    const from = memberships.find((m) => m.userId === fromTeacherId && m.role === "teacher");
    const to = memberships.find((m) => m.userId === toTeacherId && m.role === "teacher");
    if (!from) throw new NotFoundError("The absent teacher was not found in this school.");
    if (!to) throw new NotFoundError("The covering teacher was not found in this school.");

    // 1. The class moves to the covering teacher (and off the absent one, so
    //    dashboards don't show two owners; reversible via the People screen).
    const classId = from.classId ?? null;
    if (classId) {
      await this.store.updateMembership({ ...to, classId });
      await this.store.updateMembership({ ...from, classId: null });
    }

    // 2. Tasks the absent teacher assigned transfer, and each task's help
    //    session transfers with it — ownership moves, the transcript rule holds.
    let tasksTransferred = 0;
    let helpSessionsTransferred = 0;
    for (const task of await this.workspace.listTasksByTeacher(fromTeacherId)) {
      if (task.schoolId !== schoolId) continue;
      await this.workspace.updateTask({ ...task, teacherId: toTeacherId });
      tasksTransferred += 1;
      const session = await this.workspace.findHelpSession(task.studentId, task.id);
      if (session) {
        await this.workspace.updateHelpSession({ ...session, teacherId: toTeacherId });
        helpSessionsTransferred += 1;
      }
    }

    this.audit.append({
      action: "class.handover",
      actorId: adminId,
      subjectType: "class",
      subjectId: classId ?? "none",
      metadata: { fromTeacherId, toTeacherId, tasksTransferred, helpSessionsTransferred, at: this.clock.isoNow() },
    });
    return { classId, tasksTransferred, helpSessionsTransferred };
  }

  private async requireAdmin(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "admin")) {
      throw new ConflictError("NOT_AN_ADMIN", "Only a School Admin may hand a class over.");
    }
  }
}
