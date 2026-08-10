import type { DashboardStore, FocusDismissal, GroupAssignment } from "../../ports/dashboardStore";
import type { GroupType } from "../../domain/insights";
import { iso, type Sql } from "./pgClient";

/** PostgreSQL DashboardStore adapter (ap-southeast-2). */
export class PgDashboardStore implements DashboardStore {
  constructor(private readonly sql: Sql) {}

  async insertDismissal(d: FocusDismissal): Promise<void> {
    await this.sql`insert into focus_dismissals
      (id,school_id,class_id,teacher_id,node_id,below_fraction_at_dismiss,dismissed_at)
      values (${d.id},${d.schoolId},${d.classId},${d.teacherId},${d.nodeId},${d.belowFractionAtDismiss},${d.dismissedAt})`;
  }
  async listDismissals(schoolId: string, classId: string): Promise<FocusDismissal[]> {
    return (
      await this.sql`select * from focus_dismissals where school_id=${schoolId} and class_id=${classId}`
    ).map(mapDismissal);
  }

  async insertAssignment(a: GroupAssignment): Promise<void> {
    await this.sql`insert into group_assignments
      (id,school_id,class_id,teacher_id,group_type,node_id,student_ids,content_id,created_at)
      values (${a.id},${a.schoolId},${a.classId},${a.teacherId},${a.groupType},${a.nodeId},
        ${this.sql.json(a.studentIds)},${a.contentId},${a.createdAt})`;
  }
  async getAssignment(id: string): Promise<GroupAssignment | undefined> {
    const rows = await this.sql`select * from group_assignments where id=${id}`;
    return rows[0] ? mapAssignment(rows[0]) : undefined;
  }
  async listAssignmentsByClass(schoolId: string, classId: string): Promise<GroupAssignment[]> {
    return (
      await this.sql`select * from group_assignments where school_id=${schoolId} and class_id=${classId}`
    ).map(mapAssignment);
  }
}

type Row = Record<string, any>;
function mapDismissal(r: Row): FocusDismissal {
  return {
    id: r.id, schoolId: r.school_id, classId: r.class_id, teacherId: r.teacher_id,
    nodeId: r.node_id, belowFractionAtDismiss: Number(r.below_fraction_at_dismiss),
    dismissedAt: iso(r.dismissed_at),
  };
}
function mapAssignment(r: Row): GroupAssignment {
  return {
    id: r.id, schoolId: r.school_id, classId: r.class_id, teacherId: r.teacher_id,
    groupType: r.group_type as GroupType, nodeId: r.node_id,
    studentIds: r.student_ids as string[], contentId: r.content_id,
    createdAt: iso(r.created_at),
  };
}
