import type {
  BehaviouralCategory,
  BehaviouralObservation,
  CoCurricularDomain,
  CoCurricularRecord,
  Licence,
  TeacherComment,
} from "../../domain/reporting";
import type { ReportingStore } from "../../ports/reportingStore";
import { iso, type Sql } from "./pgClient";

/** PostgreSQL ReportingStore adapter (ap-southeast-2). */
export class PgReportingStore implements ReportingStore {
  constructor(private readonly sql: Sql) {}

  async insertObservation(o: BehaviouralObservation): Promise<void> {
    await this.sql`insert into behavioural_observations (id,school_id,student_id,category,note,author_teacher_id,created_at)
      values (${o.id},${o.schoolId},${o.studentId},${o.category},${o.note},${o.authorTeacherId},${o.createdAt})`;
  }
  async listObservationsByStudent(studentId: string): Promise<BehaviouralObservation[]> {
    return (await this.sql`select * from behavioural_observations where student_id=${studentId}`).map(mapObs);
  }
  async listObservationsBySchool(schoolId: string): Promise<BehaviouralObservation[]> {
    return (await this.sql`select * from behavioural_observations where school_id=${schoolId}`).map(mapObs);
  }

  async insertCoCurricular(r: CoCurricularRecord): Promise<void> {
    await this.sql`insert into cocurricular_records (id,school_id,student_id,domain,skill,level,teacher_id,created_at)
      values (${r.id},${r.schoolId},${r.studentId},${r.domain},${r.skill},${r.level},${r.teacherId},${r.createdAt})`;
  }
  async listCoCurricularByStudent(studentId: string): Promise<CoCurricularRecord[]> {
    return (await this.sql`select * from cocurricular_records where student_id=${studentId}`).map(mapCoCurr);
  }

  async insertComment(c: TeacherComment): Promise<void> {
    await this.sql`insert into teacher_comments (id,school_id,student_id,teacher_id,text,created_at)
      values (${c.id},${c.schoolId},${c.studentId},${c.teacherId},${c.text},${c.createdAt})`;
  }
  async listCommentsByStudent(studentId: string): Promise<TeacherComment[]> {
    return (await this.sql`select * from teacher_comments where student_id=${studentId}`).map(mapComment);
  }

  async insertLicence(l: Licence): Promise<void> {
    await this.sql`insert into licences (id,school_id,seats,monthly_rate,start_date,end_date,created_at)
      values (${l.id},${l.schoolId},${l.seats},${l.monthlyRate},${l.startDate},${l.endDate},${l.createdAt})`;
  }
  async listLicencesBySchool(schoolId: string): Promise<Licence[]> {
    return (await this.sql`select * from licences where school_id=${schoolId}`).map(mapLicence);
  }
}

type Row = Record<string, any>;
function mapObs(r: Row): BehaviouralObservation {
  return { id: r.id, schoolId: r.school_id, studentId: r.student_id, category: r.category as BehaviouralCategory, note: r.note, authorTeacherId: r.author_teacher_id, createdAt: iso(r.created_at) };
}
function mapCoCurr(r: Row): CoCurricularRecord {
  return { id: r.id, schoolId: r.school_id, studentId: r.student_id, domain: r.domain as CoCurricularDomain, skill: r.skill, level: r.level, teacherId: r.teacher_id, createdAt: iso(r.created_at) };
}
function mapComment(r: Row): TeacherComment {
  return { id: r.id, schoolId: r.school_id, studentId: r.student_id, teacherId: r.teacher_id, text: r.text, createdAt: iso(r.created_at) };
}
function mapLicence(r: Row): Licence {
  return { id: r.id, schoolId: r.school_id, seats: Number(r.seats), monthlyRate: Number(r.monthly_rate), startDate: dateStr(r.start_date), endDate: r.end_date ? dateStr(r.end_date) : null, createdAt: iso(r.created_at) };
}
function dateStr(v: Date | string): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
