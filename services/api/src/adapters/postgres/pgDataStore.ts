import type {
  AcademicYear,
  Campus,
  ClassRoom,
  Enrolment,
  EnrolmentHistory,
  InferenceRecord,
  Invite,
  Membership,
  PersonalData,
  School,
  Term,
  User,
} from "../../domain/types";
import type { Credential, DataStore, OnboardingProgress, Session } from "../../ports/dataStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL DataStore adapter (Amazon RDS/Aurora, ap-southeast-2). */
export class PgDataStore implements DataStore {
  constructor(private readonly sql: Sql) {}

  // Schools
  async insertSchool(s: School): Promise<void> {
    await this.sql`insert into schools (id,name,settings,config_complete,created_at)
      values (${s.id},${s.name},${this.sql.json(s.settings as never)},${s.configComplete},${s.createdAt})`;
  }
  async getSchool(id: string): Promise<School | undefined> {
    return mapSchool((await this.sql`select * from schools where id=${id}`)[0]);
  }
  async findSchoolByName(name: string): Promise<School | undefined> {
    return mapSchool(
      (await this.sql`select * from schools where lower(btrim(name))=lower(btrim(${name})) limit 1`)[0],
    );
  }
  async updateSchool(s: School): Promise<void> {
    await this.sql`update schools set name=${s.name}, settings=${this.sql.json(s.settings as never)},
      config_complete=${s.configComplete}, created_at=${s.createdAt} where id=${s.id}`;
  }

  // Campuses
  async insertCampus(c: Campus): Promise<void> {
    await this.sql`insert into campuses (id,school_id,name,settings,setup_complete,created_at)
      values (${c.id},${c.schoolId},${c.name},${this.sql.json(c.settings as never)},${c.setupComplete},${c.createdAt})`;
  }
  async getCampus(id: string): Promise<Campus | undefined> {
    return mapCampus((await this.sql`select * from campuses where id=${id}`)[0]);
  }
  async listCampusesBySchool(schoolId: string): Promise<Campus[]> {
    return (await this.sql`select * from campuses where school_id=${schoolId}`).map(mapCampus) as Campus[];
  }
  async updateCampus(c: Campus): Promise<void> {
    await this.sql`update campuses set name=${c.name}, settings=${this.sql.json(c.settings as never)},
      setup_complete=${c.setupComplete} where id=${c.id}`;
  }

  // Academic years & terms
  async insertAcademicYear(y: AcademicYear): Promise<void> {
    await this.sql`insert into academic_years (id,school_id,campus_id,name)
      values (${y.id},${y.schoolId},${y.campusId},${y.name})`;
  }
  async listAcademicYearsBySchool(schoolId: string): Promise<AcademicYear[]> {
    return (await this.sql`select * from academic_years where school_id=${schoolId}`).map(mapYear);
  }
  async insertTerm(t: Term): Promise<void> {
    await this.sql`insert into terms (id,academic_year_id,name,start_date,end_date)
      values (${t.id},${t.academicYearId},${t.name},${t.startDate},${t.endDate})`;
  }
  async listTermsByYear(academicYearId: string): Promise<Term[]> {
    return (await this.sql`select * from terms where academic_year_id=${academicYearId}`).map(mapTerm);
  }

  // Classes
  async insertClass(k: ClassRoom): Promise<void> {
    await this.sql`insert into classes (id,school_id,campus_id,name,created_at)
      values (${k.id},${k.schoolId},${k.campusId},${k.name},${k.createdAt})`;
  }
  async getClass(id: string): Promise<ClassRoom | undefined> {
    return mapClass((await this.sql`select * from classes where id=${id}`)[0]);
  }
  async listClassesBySchool(schoolId: string): Promise<ClassRoom[]> {
    return (await this.sql`select * from classes where school_id=${schoolId}`).map(mapClass) as ClassRoom[];
  }

  // Users & PII
  async insertUser(u: User): Promise<void> {
    await this.sql`insert into users (id,school_id,status,synthetic,created_at)
      values (${u.id},${u.schoolId},${u.status},${u.synthetic},${u.createdAt})`;
  }
  async getUser(id: string): Promise<User | undefined> {
    return mapUser((await this.sql`select * from users where id=${id}`)[0]);
  }
  async updateUser(u: User): Promise<void> {
    await this.sql`update users set status=${u.status} where id=${u.id}`;
  }
  async deleteUser(id: string): Promise<void> {
    await this.sql`delete from users where id=${id}`;
  }
  async listUsersBySchool(schoolId: string): Promise<User[]> {
    return (await this.sql`select * from users where school_id=${schoolId}`).map(mapUser) as User[];
  }
  async upsertPersonalData(d: PersonalData): Promise<void> {
    await this.sql`insert into personal_data (user_id,email,first_name,last_name)
      values (${d.userId},${d.email},${d.firstName},${d.lastName})
      on conflict (user_id) do update set email=${d.email}, first_name=${d.firstName}, last_name=${d.lastName}`;
  }
  async getPersonalData(userId: string): Promise<PersonalData | undefined> {
    return mapPersonal((await this.sql`select * from personal_data where user_id=${userId}`)[0]);
  }
  async deletePersonalData(userId: string): Promise<void> {
    await this.sql`delete from personal_data where user_id=${userId}`;
  }
  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const r = (await this.sql`select user_id from personal_data where lower(btrim(email))=lower(btrim(${email})) limit 1`)[0];
    return r ? (r.user_id as string) : undefined;
  }

  // Memberships
  async insertMembership(m: Membership): Promise<void> {
    await this.sql`insert into memberships (id,user_id,school_id,role,campus_id,class_id,department)
      values (${m.id},${m.userId},${m.schoolId},${m.role},${m.campusId},${m.classId},${m.department ?? null})`;
  }
  async getMembership(id: string): Promise<Membership | undefined> {
    return mapMembership((await this.sql`select * from memberships where id=${id}`)[0]);
  }
  async listMembershipsByUser(userId: string): Promise<Membership[]> {
    return (await this.sql`select * from memberships where user_id=${userId}`).map(mapMembership) as Membership[];
  }
  async listMembershipsBySchool(schoolId: string): Promise<Membership[]> {
    return (await this.sql`select * from memberships where school_id=${schoolId}`).map(mapMembership) as Membership[];
  }
  async updateMembership(m: Membership): Promise<void> {
    await this.sql`update memberships set role=${m.role}, campus_id=${m.campusId},
      class_id=${m.classId}, department=${m.department ?? null} where id=${m.id}`;
  }
  async deleteMembership(id: string): Promise<void> {
    await this.sql`delete from memberships where id=${id}`;
  }

  // Invites
  async insertInvite(i: Invite): Promise<void> {
    await this.sql`insert into invites (id,school_id,role,token,user_id,status,created_at)
      values (${i.id},${i.schoolId},${i.role},${i.token},${i.userId},${i.status},${i.createdAt})`;
  }
  async getInviteByToken(token: string): Promise<Invite | undefined> {
    return mapInvite((await this.sql`select * from invites where token=${token}`)[0]);
  }
  async updateInvite(i: Invite): Promise<void> {
    await this.sql`update invites set status=${i.status} where id=${i.id}`;
  }
  async listInvitesBySchool(schoolId: string): Promise<Invite[]> {
    return (await this.sql`select * from invites where school_id=${schoolId}`).map(mapInvite) as Invite[];
  }

  // Enrolments
  async insertEnrolment(e: Enrolment): Promise<void> {
    await this.sql`insert into enrolments (id,student_id,class_id,school_id,active)
      values (${e.id},${e.studentId},${e.classId},${e.schoolId},${e.active})`;
  }
  async getActiveEnrolmentForStudent(studentId: string): Promise<Enrolment | undefined> {
    return mapEnrolment(
      (await this.sql`select * from enrolments where student_id=${studentId} and active=true limit 1`)[0],
    );
  }
  async updateEnrolment(e: Enrolment): Promise<void> {
    await this.sql`update enrolments set class_id=${e.classId}, active=${e.active} where id=${e.id}`;
  }
  async deleteEnrolmentsByStudent(studentId: string): Promise<void> {
    await this.sql`delete from enrolments where student_id=${studentId}`;
  }
  async insertEnrolmentHistory(h: EnrolmentHistory): Promise<void> {
    await this.sql`insert into enrolment_history (id,student_id,class_id,teacher_id,ended_at)
      values (${h.id},${h.studentId},${h.classId},${h.teacherId},${h.endedAt})`;
  }
  async listEnrolmentHistoryByTeacher(teacherId: string): Promise<EnrolmentHistory[]> {
    return (await this.sql`select * from enrolment_history where teacher_id=${teacherId}`).map(mapHistory);
  }
  async listEnrolmentHistoryByStudent(studentId: string): Promise<EnrolmentHistory[]> {
    return (await this.sql`select * from enrolment_history where student_id=${studentId}`).map(mapHistory);
  }

  // Inference records
  async insertInferenceRecord(r: InferenceRecord): Promise<void> {
    await this.sql`insert into inference_records (id,student_id,school_id,kind,claim,approval_state,created_at)
      values (${r.id},${r.studentId},${r.schoolId},${r.kind},${r.claim},${r.approvalState},${r.createdAt})`;
  }
  async getInferenceRecord(id: string): Promise<InferenceRecord | undefined> {
    return mapInference((await this.sql`select * from inference_records where id=${id}`)[0]);
  }
  async listInferenceRecordsByStudent(studentId: string): Promise<InferenceRecord[]> {
    return (await this.sql`select * from inference_records where student_id=${studentId}`).map(mapInference) as InferenceRecord[];
  }

  // Auth
  async setCredential(c: Credential): Promise<void> {
    await this.sql`insert into credentials (user_id,hash,salt) values (${c.userId},${c.hash},${c.salt})
      on conflict (user_id) do update set hash=${c.hash}, salt=${c.salt}`;
  }
  async getCredential(userId: string): Promise<Credential | undefined> {
    const r = (await this.sql`select * from credentials where user_id=${userId}`)[0];
    return r ? { userId: r.user_id, hash: r.hash, salt: r.salt } : undefined;
  }
  async insertSession(s: Session): Promise<void> {
    await this.sql`insert into sessions (token,user_id,created_at) values (${s.token},${s.userId},${s.createdAt})`;
  }
  async getSession(token: string): Promise<Session | undefined> {
    const r = (await this.sql`select * from sessions where token=${token}`)[0];
    return r ? { token: r.token, userId: r.user_id, createdAt: iso(r.created_at) } : undefined;
  }

  // Onboarding
  async getOnboarding(schoolId: string): Promise<OnboardingProgress | undefined> {
    const r = (await this.sql`select * from onboarding_progress where school_id=${schoolId}`)[0];
    return r
      ? { schoolId: r.school_id, completedSteps: r.completed_steps, workspaceEntered: r.workspace_entered }
      : undefined;
  }
  async saveOnboarding(p: OnboardingProgress): Promise<void> {
    await this.sql`insert into onboarding_progress (school_id,completed_steps,workspace_entered)
      values (${p.schoolId},${this.sql.json(p.completedSteps)},${p.workspaceEntered})
      on conflict (school_id) do update set completed_steps=${this.sql.json(p.completedSteps)},
        workspace_entered=${p.workspaceEntered}`;
  }
}

// ---- row mappers ----
type Row = Record<string, any> | undefined;

function mapSchool(r: Row): School | undefined {
  return r && { id: r.id, name: r.name, settings: r.settings, configComplete: r.config_complete, createdAt: iso(r.created_at) };
}
function mapCampus(r: Row): Campus | undefined {
  return r && { id: r.id, schoolId: r.school_id, name: r.name, settings: r.settings, setupComplete: r.setup_complete, createdAt: iso(r.created_at) };
}
function mapYear(r: Row): AcademicYear {
  return { id: r!.id, schoolId: r!.school_id, campusId: r!.campus_id, name: r!.name };
}
function mapTerm(r: Row): Term {
  return { id: r!.id, academicYearId: r!.academic_year_id, name: r!.name, startDate: asDate(r!.start_date), endDate: asDate(r!.end_date) };
}
function mapClass(r: Row): ClassRoom | undefined {
  return r && { id: r.id, schoolId: r.school_id, campusId: r.campus_id, name: r.name, createdAt: iso(r.created_at) };
}
function mapUser(r: Row): User | undefined {
  return r && { id: r.id, schoolId: r.school_id, status: r.status, synthetic: r.synthetic, createdAt: iso(r.created_at) };
}
function mapPersonal(r: Row): PersonalData | undefined {
  return r && { userId: r.user_id, email: r.email, firstName: r.first_name, lastName: r.last_name };
}
function mapMembership(r: Row): Membership | undefined {
  return r && { id: r.id, userId: r.user_id, schoolId: r.school_id, role: r.role, campusId: r.campus_id, classId: r.class_id, department: r.department };
}
function mapInvite(r: Row): Invite | undefined {
  return r && { id: r.id, schoolId: r.school_id, role: r.role, token: r.token, userId: r.user_id, status: r.status, createdAt: iso(r.created_at) };
}
function mapEnrolment(r: Row): Enrolment | undefined {
  return r && { id: r.id, studentId: r.student_id, classId: r.class_id, schoolId: r.school_id, active: r.active };
}
function mapHistory(r: Row): EnrolmentHistory {
  return { id: r!.id, studentId: r!.student_id, classId: r!.class_id, teacherId: r!.teacher_id, endedAt: iso(r!.ended_at) };
}
function mapInference(r: Row): InferenceRecord | undefined {
  return r && { id: r.id, studentId: r.student_id, schoolId: r.school_id, kind: r.kind, claim: r.claim, approvalState: r.approval_state, createdAt: iso(r.created_at) };
}
function asDate(v: Date | string): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
