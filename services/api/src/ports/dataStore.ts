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
} from "../domain/types";
import type { SafeguardingConfig } from "../domain/safeguarding";

/** Stored password credential (scrypt hash + salt). */
export interface Credential {
  userId: string;
  hash: string;
  salt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
}

/** Admin 7-step onboarding progress, tracked per school. */
export interface OnboardingProgress {
  schoolId: string;
  completedSteps: string[];
  workspaceEntered: boolean;
}

/**
 * Persistence port. Every method is async so the same interface is satisfied by
 * both the in-memory adapter (dev/tests) and the Amazon RDS/Aurora PostgreSQL
 * adapter in ap-southeast-2 (Foundational Decision 1), whose schema of record is
 * src/adapters/postgres/schema.ts + db/migrations.
 */
export interface DataStore {
  // Schools
  insertSchool(school: School): Promise<void>;
  getSchool(id: string): Promise<School | undefined>;
  findSchoolByName(name: string): Promise<School | undefined>;
  updateSchool(school: School): Promise<void>;

  // Campuses
  insertCampus(campus: Campus): Promise<void>;
  getCampus(id: string): Promise<Campus | undefined>;
  listCampusesBySchool(schoolId: string): Promise<Campus[]>;
  updateCampus(campus: Campus): Promise<void>;

  // Academic years & terms
  insertAcademicYear(year: AcademicYear): Promise<void>;
  listAcademicYearsBySchool(schoolId: string): Promise<AcademicYear[]>;
  insertTerm(term: Term): Promise<void>;
  listTermsByYear(academicYearId: string): Promise<Term[]>;

  // Classes
  insertClass(klass: ClassRoom): Promise<void>;
  getClass(id: string): Promise<ClassRoom | undefined>;
  listClassesBySchool(schoolId: string): Promise<ClassRoom[]>;

  // Users & PII
  insertUser(user: User): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  updateUser(user: User): Promise<void>;
  deleteUser(id: string): Promise<void>;
  listUsersBySchool(schoolId: string): Promise<User[]>;
  upsertPersonalData(data: PersonalData): Promise<void>;
  getPersonalData(userId: string): Promise<PersonalData | undefined>;
  deletePersonalData(userId: string): Promise<void>;
  findUserIdByEmail(email: string): Promise<string | undefined>;

  // Memberships
  insertMembership(membership: Membership): Promise<void>;
  getMembership(id: string): Promise<Membership | undefined>;
  listMembershipsByUser(userId: string): Promise<Membership[]>;
  listMembershipsBySchool(schoolId: string): Promise<Membership[]>;
  updateMembership(membership: Membership): Promise<void>;
  deleteMembership(id: string): Promise<void>;

  // Invites
  insertInvite(invite: Invite): Promise<void>;
  getInviteByToken(token: string): Promise<Invite | undefined>;
  updateInvite(invite: Invite): Promise<void>;
  listInvitesBySchool(schoolId: string): Promise<Invite[]>;

  // Enrolments
  insertEnrolment(enrolment: Enrolment): Promise<void>;
  getActiveEnrolmentForStudent(studentId: string): Promise<Enrolment | undefined>;
  updateEnrolment(enrolment: Enrolment): Promise<void>;
  deleteEnrolmentsByStudent(studentId: string): Promise<void>;
  insertEnrolmentHistory(history: EnrolmentHistory): Promise<void>;
  listEnrolmentHistoryByTeacher(teacherId: string): Promise<EnrolmentHistory[]>;
  listEnrolmentHistoryByStudent(studentId: string): Promise<EnrolmentHistory[]>;

  // Inference records (approvable-state scaffold, Decision 7)
  insertInferenceRecord(record: InferenceRecord): Promise<void>;
  getInferenceRecord(id: string): Promise<InferenceRecord | undefined>;
  listInferenceRecordsByStudent(studentId: string): Promise<InferenceRecord[]>;

  // Auth
  setCredential(credential: Credential): Promise<void>;
  getCredential(userId: string): Promise<Credential | undefined>;
  insertSession(session: Session): Promise<void>;
  getSession(token: string): Promise<Session | undefined>;

  // Onboarding
  getOnboarding(schoolId: string): Promise<OnboardingProgress | undefined>;
  saveOnboarding(progress: OnboardingProgress): Promise<void>;

  // Safeguarding config (M7 — a hard precondition for Ask for Help)
  getSafeguardingConfig(schoolId: string): Promise<SafeguardingConfig | undefined>;
  saveSafeguardingConfig(config: SafeguardingConfig): Promise<void>;
}
