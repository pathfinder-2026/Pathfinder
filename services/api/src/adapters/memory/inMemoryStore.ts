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
 * In-memory DataStore. Backs dev and the full Milestone 0 test suite. Every
 * method returns copies so callers cannot mutate stored state by reference.
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
  insertSchool(school: School): void {
    this.schools.set(school.id, InMemoryStore.clone(school));
  }
  getSchool(id: string): School | undefined {
    const s = this.schools.get(id);
    return s ? InMemoryStore.clone(s) : undefined;
  }
  findSchoolByName(name: string): School | undefined {
    const norm = name.trim().toLowerCase();
    for (const s of this.schools.values()) {
      if (s.name.trim().toLowerCase() === norm) return InMemoryStore.clone(s);
    }
    return undefined;
  }
  updateSchool(school: School): void {
    this.schools.set(school.id, InMemoryStore.clone(school));
  }

  // Campuses
  insertCampus(campus: Campus): void {
    this.campuses.set(campus.id, InMemoryStore.clone(campus));
  }
  getCampus(id: string): Campus | undefined {
    const c = this.campuses.get(id);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  listCampusesBySchool(schoolId: string): Campus[] {
    return [...this.campuses.values()]
      .filter((c) => c.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  updateCampus(campus: Campus): void {
    this.campuses.set(campus.id, InMemoryStore.clone(campus));
  }

  // Academic years & terms
  insertAcademicYear(year: AcademicYear): void {
    this.academicYears.set(year.id, InMemoryStore.clone(year));
  }
  listAcademicYearsBySchool(schoolId: string): AcademicYear[] {
    return [...this.academicYears.values()]
      .filter((y) => y.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  insertTerm(term: Term): void {
    this.terms.set(term.id, InMemoryStore.clone(term));
  }
  listTermsByYear(academicYearId: string): Term[] {
    return [...this.terms.values()]
      .filter((t) => t.academicYearId === academicYearId)
      .map(InMemoryStore.clone);
  }

  // Classes
  insertClass(klass: ClassRoom): void {
    this.classes.set(klass.id, InMemoryStore.clone(klass));
  }
  getClass(id: string): ClassRoom | undefined {
    const c = this.classes.get(id);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  listClassesBySchool(schoolId: string): ClassRoom[] {
    return [...this.classes.values()]
      .filter((c) => c.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }

  // Users & PII
  insertUser(user: User): void {
    this.users.set(user.id, InMemoryStore.clone(user));
  }
  getUser(id: string): User | undefined {
    const u = this.users.get(id);
    return u ? InMemoryStore.clone(u) : undefined;
  }
  updateUser(user: User): void {
    this.users.set(user.id, InMemoryStore.clone(user));
  }
  listUsersBySchool(schoolId: string): User[] {
    return [...this.users.values()]
      .filter((u) => u.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  upsertPersonalData(data: PersonalData): void {
    this.personalData.set(data.userId, InMemoryStore.clone(data));
  }
  getPersonalData(userId: string): PersonalData | undefined {
    const d = this.personalData.get(userId);
    return d ? InMemoryStore.clone(d) : undefined;
  }
  deletePersonalData(userId: string): void {
    this.personalData.delete(userId);
  }
  findUserIdByEmail(email: string): string | undefined {
    const norm = email.trim().toLowerCase();
    for (const d of this.personalData.values()) {
      if (d.email.trim().toLowerCase() === norm) return d.userId;
    }
    return undefined;
  }

  // Memberships
  insertMembership(membership: Membership): void {
    this.memberships.set(membership.id, InMemoryStore.clone(membership));
  }
  getMembership(id: string): Membership | undefined {
    const m = this.memberships.get(id);
    return m ? InMemoryStore.clone(m) : undefined;
  }
  listMembershipsByUser(userId: string): Membership[] {
    return [...this.memberships.values()]
      .filter((m) => m.userId === userId)
      .map(InMemoryStore.clone);
  }
  listMembershipsBySchool(schoolId: string): Membership[] {
    return [...this.memberships.values()]
      .filter((m) => m.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }
  updateMembership(membership: Membership): void {
    this.memberships.set(membership.id, InMemoryStore.clone(membership));
  }
  deleteMembership(id: string): void {
    this.memberships.delete(id);
  }

  // Invites
  insertInvite(invite: Invite): void {
    this.invites.set(invite.id, InMemoryStore.clone(invite));
  }
  getInviteByToken(token: string): Invite | undefined {
    for (const i of this.invites.values()) {
      if (i.token === token) return InMemoryStore.clone(i);
    }
    return undefined;
  }
  updateInvite(invite: Invite): void {
    this.invites.set(invite.id, InMemoryStore.clone(invite));
  }
  listInvitesBySchool(schoolId: string): Invite[] {
    return [...this.invites.values()]
      .filter((i) => i.schoolId === schoolId)
      .map(InMemoryStore.clone);
  }

  // Enrolments
  insertEnrolment(enrolment: Enrolment): void {
    this.enrolments.set(enrolment.id, InMemoryStore.clone(enrolment));
  }
  getActiveEnrolmentForStudent(studentId: string): Enrolment | undefined {
    for (const e of this.enrolments.values()) {
      if (e.studentId === studentId && e.active) return InMemoryStore.clone(e);
    }
    return undefined;
  }
  updateEnrolment(enrolment: Enrolment): void {
    this.enrolments.set(enrolment.id, InMemoryStore.clone(enrolment));
  }
  insertEnrolmentHistory(history: EnrolmentHistory): void {
    this.enrolmentHistory.set(history.id, InMemoryStore.clone(history));
  }
  listEnrolmentHistoryByTeacher(teacherId: string): EnrolmentHistory[] {
    return [...this.enrolmentHistory.values()]
      .filter((h) => h.teacherId === teacherId)
      .map(InMemoryStore.clone);
  }
  listEnrolmentHistoryByStudent(studentId: string): EnrolmentHistory[] {
    return [...this.enrolmentHistory.values()]
      .filter((h) => h.studentId === studentId)
      .map(InMemoryStore.clone);
  }

  // Inference records
  insertInferenceRecord(record: InferenceRecord): void {
    this.inferenceRecords.set(record.id, InMemoryStore.clone(record));
  }
  getInferenceRecord(id: string): InferenceRecord | undefined {
    const r = this.inferenceRecords.get(id);
    return r ? InMemoryStore.clone(r) : undefined;
  }
  listInferenceRecordsByStudent(studentId: string): InferenceRecord[] {
    return [...this.inferenceRecords.values()]
      .filter((r) => r.studentId === studentId)
      .map(InMemoryStore.clone);
  }

  // Auth
  setCredential(credential: Credential): void {
    this.credentials.set(credential.userId, InMemoryStore.clone(credential));
  }
  getCredential(userId: string): Credential | undefined {
    const c = this.credentials.get(userId);
    return c ? InMemoryStore.clone(c) : undefined;
  }
  insertSession(session: Session): void {
    this.sessions.set(session.token, InMemoryStore.clone(session));
  }
  getSession(token: string): Session | undefined {
    const s = this.sessions.get(token);
    return s ? InMemoryStore.clone(s) : undefined;
  }

  // Onboarding
  getOnboarding(schoolId: string): OnboardingProgress | undefined {
    const o = this.onboarding.get(schoolId);
    return o ? InMemoryStore.clone(o) : undefined;
  }
  saveOnboarding(progress: OnboardingProgress): void {
    this.onboarding.set(progress.schoolId, InMemoryStore.clone(progress));
  }
}
