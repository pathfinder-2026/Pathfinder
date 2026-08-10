import type { MasteryRecord, MisconceptionSignal } from "../../domain/mastery";
import type { ActivityStore } from "../../ports/activityStore";
import { iso, type Sql } from "./pgClient";

/** PostgreSQL ActivityStore adapter (ap-southeast-2). */
export class PgActivityStore implements ActivityStore {
  constructor(private readonly sql: Sql) {}

  async insertMastery(r: MasteryRecord): Promise<void> {
    await this.sql`insert into mastery_records
      (id,student_id,school_id,node_id,level,score,data_points,last_activity_at,history,assisted_score,synthetic)
      values (${r.id},${r.studentId},${r.schoolId},${r.nodeId},${r.level},${r.score},${r.dataPoints},${r.lastActivityAt},
        ${r.history && r.history.length ? this.sql.json(r.history) : null},${r.assistedScore ?? null},${r.synthetic})`;
  }
  async listMasteryBySchool(schoolId: string): Promise<MasteryRecord[]> {
    return (await this.sql`select * from mastery_records where school_id=${schoolId}`).map(mapMastery);
  }
  async listMasteryByNode(schoolId: string, nodeId: string): Promise<MasteryRecord[]> {
    return (await this.sql`select * from mastery_records where school_id=${schoolId} and node_id=${nodeId}`).map(mapMastery);
  }

  async insertMisconception(s: MisconceptionSignal): Promise<void> {
    await this.sql`insert into misconception_signals
      (id,student_id,school_id,node_id,misconception,occurrences,last_seen_at,synthetic)
      values (${s.id},${s.studentId},${s.schoolId},${s.nodeId},${s.misconception},${s.occurrences},${s.lastSeenAt},${s.synthetic})`;
  }
  async listMisconceptionsBySchool(schoolId: string): Promise<MisconceptionSignal[]> {
    return (await this.sql`select * from misconception_signals where school_id=${schoolId}`).map(mapMisc);
  }

  async deleteByStudent(studentId: string): Promise<void> {
    await this.sql`delete from mastery_records where student_id=${studentId}`;
    await this.sql`delete from misconception_signals where student_id=${studentId}`;
  }
}

type Row = Record<string, any>;
function mapMastery(r: Row): MasteryRecord {
  return {
    id: r.id, studentId: r.student_id, schoolId: r.school_id, nodeId: r.node_id,
    level: r.level, score: Number(r.score), dataPoints: Number(r.data_points),
    lastActivityAt: iso(r.last_activity_at),
    history: r.history ? (r.history as number[]) : [],
    assistedScore: r.assisted_score === null || r.assisted_score === undefined ? null : Number(r.assisted_score),
    synthetic: r.synthetic,
  };
}
function mapMisc(r: Row): MisconceptionSignal {
  return {
    id: r.id, studentId: r.student_id, schoolId: r.school_id, nodeId: r.node_id,
    misconception: r.misconception, occurrences: Number(r.occurrences),
    lastSeenAt: iso(r.last_seen_at), synthetic: r.synthetic,
  };
}
