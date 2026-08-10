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
import type {
  Credential,
  DataStore,
  OnboardingProgress,
  Session,
} from "../../ports/dataStore";

/**
 * In-memory DataStore. Backs dev and the full test suite. Methods are async to
 * match the port; each returns copies so callers cannot mutate stored state.
 */
export class InMemoryStore implements DataStore {
  private schools = new Map<string, School>();
  private campuses = new Map<string, Campus>();
  private academicYears = new Map<string, AcademicYear>();
  private terms = new Map<string, Term>();
  private classes = new Map<string, ClassRoom>();
  private users = new Map<string, User>();
  private personalData = new Map<string, PersonalData>();
  private memberships = new Map<string, Membership>();
  private invites = new Map<string, Invite>();
  private enrolments = new Map<string, Enrolment>();
  private enrolmentHistory = new Map<string, EnrolmentHistory>();
  private inferenceRecords = new Map<string, InferenceRecord>();
  private credentials = new Map<string, Credential>();
  private sessions = new Map<string, Session>();
  private onboarding = new Map<string, OnboardingProgress>();

  private static clone<T>(v: T): T {
    return structuredClone(v);
  }

  // Schools
  async insertSchool(school: School): Promise<void> {
    this.schools.set(school.id, InMemoryStore.clone(school));
  }
  async getSchool(id: string): Promise<School | undefined> {
    const s = this.schools.get(id);
    return s ? InMemoryStore.clone(s) : undefined;
  }
  async findSchoolByName(name: string): Promise<School | undefined> {
    const norm = name.trim().toLowerCase();
    for (const s of this.schools.values()) {
      if (s.name.trim().toLowerCase() === norm) return InMemoryStore.clone(s);
    }
    return undefined;
  }
  async updateSchool(school: School): Promise<void> {
    this.schools.set(school.id, InMemoryStore.clone(school));
  }

  // Campuses
  async insertCampus(campus: Campus): Promise<void> {
    this.campuses.set(campus.id, InMemoryStore.clone(campus));
  }
  async getCampus(id: string): Promise<Campus | undefined> {
    const c = this.campuses.get(id);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  async listCampusesBySchool(schoolId: string): Promise<Campus[]> {
    return [...this.campuses.values()]
      .filter((c) => c.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  async updateCampus(campus: Campus): Promise<void> {
    this.campuses.set(campus.id, InMemoryStore.clone(campus));
  }

  // Academic years & terms
  async insertAcademicYear(year: AcademicYear): Promise<void> {
    this.academicYears.set(year.id, InMemoryStore.clone(year));
  }
  async listAcademicYearsBySchool(schoolId: string): Promise<AcademicYear[]> {
    return [...this.academicYears.values()]
      .filter((y) => y.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  async insertTerm(term: Term): Promise<void> {
    this.terms.set(term.id, InMemoryStore.clone(term));
  }
  async listTermsByYear(academicYearId: string): Promise<Term[]> {
    return [...this.terms.values()]
      .filter((t) => t.academicYearId === academicYearId)
      .map(InMemoryStore.clone);
  }

  // Classes
  async insertClass(klass: ClassRoom): Promise<void> {
    this.classes.set(klass.id, InMemoryStore.clone(klass));
  }
  async getClass(id: string): Promise<ClassRoom | undefined> {
    const c = this.classes.get(id);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  async listClassesBySchool(schoolId: string): Promise<ClassRoom[]> {
    return [...this.classes.values()]
      .filter((c) => c.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }

  // Users & PII
  async insertUser(user: User): Promise<void> {
    this.users.set(user.id, InMemoryStore.clone(user));
  }
  async getUser(id: string): Promise<User | undefined> {
    const u = this.users.get(id);
    return u ? InMemoryStore.clone(u) : undefined;
  }
  async updateUser(user: User): Promise<void> {
    this.users.set(user.id, InMemoryStore.clone(user));
  }
  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }
  async listUsersBySchool(schoolId: string): Promise<User[]> {
    return [...this.users.values()]
      .filter((u) => u.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  async upsertPersonalData(data: PersonalData): Promise<void> {
    this.personalData.set(data.userId, InMemoryStore.clone(data));
  }
  async getPersonalData(userId: string): Promise<PersonalData | undefined> {
    const d = this.personalData.get(userId);
    return d ? InMemoryStore.clone(d) : undefined;
  }
  async deletePersonalData(userId: string): Promise<void> {
    this.personalData.delete(userId);
  }
  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const norm = email.trim().toLowerCase();
    for (const d of this.personalData.values()) {
      if (d.email.trim().toLowerCase() === norm) return d.userId;
    }
    return undefined;
  }

  // Memberships
  async insertMembership(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, InMemoryStore.clone(membership));
  }
  async getMembership(id: string): Promise<Membership | undefined> {
    const m = this.memberships.get(id);
    return m ? InMemoryStore.clone(m) : undefined;
  }
  async listMembershipsByUser(userId: string): Promise<Membership[]> {
    return [...this.memberships.values()]
      .filter((m) => m.userId === userId)
      .map(InMemoryStore.clone);
  }
  async listMembershipsBySchool(schoolId: string): Promise<Membership[]> {
    return [...this.memberships.values()]
      .filter((m) => m.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  async updateMembership(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, InMemoryStore.clone(membership));
  }
  async deleteMembership(id: string): Promise<void> {
    this.memberships.delete(id);
  }

  // Invites
  async insertInvite(invite: Invite): Promise<void> {
    this.invites.set(invite.id, InMemoryStore.clone(invite));
  }
  async getInviteByToken(token: string): Promise<Invite | undefined> {
    for (const i of this.invites.values()) {
      if (i.token === token) return InMemoryStore.clone(i);
    }
    return undefined;
  }
  async updateInvite(invite: Invite): Promise<void> {
    this.invites.set(invite.id, InMemoryStore.clone(invite));
  }
  async listInvitesBySchool(schoolId: string): Promise<Invite[]> {
    return [...this.invites.values()]
      .filter((i) => i.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }

  // Enrolments
  async insertEnrolment(enrolment: Enrolment): Promise<void> {
    this.enrolments.set(enrolment.id, InMemoryStore.clone(enrolment));
  }
  async getActiveEnrolmentForStudent(studentId: string): Promise<Enrolment | undefined> {
    for (const e of this.enrolments.values()) {
      if (e.studentId === studentId && e.active) return InMemoryStore.clone(e);
    }
    return undefined;
  }
  async updateEnrolment(enrolment: Enrolment): Promise<void> {
    this.enrolments.set(enrolment.id, InMemoryStore.clone(enrolment));
  }
  async deleteEnrolmentsByStudent(studentId: string): Promise<void> {
    for (const [id, e] of this.enrolments) if (e.studentId === studentId) this.enrolments.delete(id);
  }
  async insertEnrolmentHistory(history: EnrolmentHistory): Promise<void> {
    this.enrolmentHistory.set(history.id, InMemoryStore.clone(history));
  }
  async listEnrolmentHistoryByTeacher(teacherId: string): Promise<EnrolmentHistory[]> {
    return [...this.enrolmentHistory.values()]
      .filter((h) => h.teacherId === teacherId)
      .map(InMemoryStore.clone);
  }
  async listEnrolmentHistoryByStudent(studentId: string): Promise<EnrolmentHistory[]> {
    return [...this.enrolmentHistory.values()]
      .filter((h) => h.studentId === studentId)
      .map(InMemoryStore.clone);
  }

  // Inference records
  async insertInferenceRecord(record: InferenceRecord): Promise<void> {
    this.inferenceRecords.set(record.id, InMemoryStore.clone(record));
  }
  async getInferenceRecord(id: string): Promise<InferenceRecord | undefined> {
    const r = this.inferenceRecords.get(id);
    return r ? InMemoryStore.clone(r) : undefined;
  }
  async listInferenceRecordsByStudent(studentId: string): Promise<InferenceRecord[]> {
    return [...this.inferenceRecords.values()]
      .filter((r) => r.studentId === studentId)
      .map(InMemoryStore.clone);
  }

  // Auth
  async setCredential(credential: Credential): Promise<void> {
    this.credentials.set(credential.userId, InMemoryStore.clone(credential));
  }
  async getCredential(userId: string): Promise<Credential | undefined> {
    const c = this.credentials.get(userId);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  async insertSession(session: Session): Promise<void> {
    this.sessions.set(session.token, InMemoryStore.clone(session));
  }
  async getSession(token: string): Promise<Session | undefined> {
    const s = this.sessions.get(token);
    return s ? InMemoryStore.clone(s) : undefined;
  }

  // Onboarding
  async getOnboarding(schoolId: string): Promise<OnboardingProgress | undefined> {
    const o = this.onboarding.get(schoolId);
    return o ? InMemoryStore.clone(o) : undefined;
  }
  async saveOnboarding(progress: OnboardingProgress): Promise<void> {
    this.onboarding.set(progress.schoolId, InMemoryStore.clone(progress));
  }
}
