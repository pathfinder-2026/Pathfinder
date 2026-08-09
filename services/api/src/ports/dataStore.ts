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
 * Persistence port. The in-memory adapter backs dev and the full test suite in
 * Milestone 0 (no database is provisioned yet); the production adapter is
 * Amazon RDS/Aurora PostgreSQL in ap-southeast-2 (Foundational Decision 1),
 * whose schema of record is src/adapters/postgres/schema.ts + db/migrations.
 */
export interface DataStore {
  // Schools
  insertSchool(school: School): void;
  getSchool(id: string): School | undefined;
  findSchoolByName(name: string): School | undefined;
  updateSchool(school: School): void;

  // Campuses
  insertCampus(campus: Campus): void;
  getCampus(id: string): Campus | undefined;
  listCampusesBySchool(schoolId: string): Campus[];
  updateCampus(campus: Campus): void;

  // Academic years & terms
  insertAcademicYear(year: AcademicYear): void;
  listAcademicYearsBySchool(schoolId: string): AcademicYear[];
  insertTerm(term: Term): void;
  listTermsByYear(academicYearId: string): Term[];

  // Classes
  insertClass(klass: ClassRoom): void;
  getClass(id: string): ClassRoom | undefined;
  listClassesBySchool(schoolId: string): ClassRoom[];

  // Users & PII
  insertUser(user: User): void;
  getUser(id: string): User | undefined;
  updateUser(user: User): void;
  listUsersBySchool(schoolId: string): User[];
  upsertPersonalData(data: PersonalData): void;
  getPersonalData(userId: string): PersonalData | undefined;
  deletePersonalData(userId: string): void;
  findUserIdByEmail(email: string): string | undefined;

  // Memberships
  insertMembership(membership: Membership): void;
  getMembership(id: string): Membership | undefined;
  listMembershipsByUser(userId: string): Membership[];
  listMembershipsBySchool(schoolId: string): Membership[];
  updateMembership(membership: Membership): void;
  deleteMembership(id: string): void;

  // Invites
  insertInvite(invite: Invite): void;
  getInviteByToken(token: string): Invite | undefined;
  updateInvite(invite: Invite): void;
  listInvitesBySchool(schoolId: string): Invite[];

  // Enrolments
  insertEnrolment(enrolment: Enrolment): void;
  getActiveEnrolmentForStudent(studentId: string): Enrolment | undefined;
  updateEnrolment(enrolment: Enrolment): void;
  insertEnrolmentHistory(history: EnrolmentHistory): void;
  listEnrolmentHistoryByTeacher(teacherId: string): EnrolmentHistory[];
  listEnrolmentHistoryByStudent(studentId: string): EnrolmentHistory[];

  // Inference records (approvable-state scaffold, Decision 7)
  insertInferenceRecord(record: InferenceRecord): void;
  getInferenceRecord(id: string): InferenceRecord | undefined;
  listInferenceRecordsByStudent(studentId: string): InferenceRecord[];

  // Auth
  setCredential(credential: Credential): void;
  getCredential(userId: string): Credential | undefined;
  insertSession(session: Session): void;
  getSession(token: string): Session | undefined;

  // Onboarding
  getOnboarding(schoolId: string): OnboardingProgress | undefined;
  saveOnboarding(progress: OnboardingProgress): void;
}
