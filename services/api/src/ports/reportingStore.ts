import type {
  BehaviouralObservation,
  CoCurricularRecord,
  Licence,
  TeacherComment,
} from "../domain/reporting";

/**
 * Persistence port for Milestone 10 reporting data: behavioural/social
 * observations, co-curricular capability, teacher comments and licences. These are
 * SEPARATE from academic mastery (which lives in the ActivityStore).
 */
export interface ReportingStore {
  insertObservation(o: BehaviouralObservation): Promise<void>;
  listObservationsByStudent(studentId: string): Promise<BehaviouralObservation[]>;
  listObservationsBySchool(schoolId: string): Promise<BehaviouralObservation[]>;

  insertCoCurricular(r: CoCurricularRecord): Promise<void>;
  listCoCurricularByStudent(studentId: string): Promise<CoCurricularRecord[]>;

  insertComment(c: TeacherComment): Promise<void>;
  listCommentsByStudent(studentId: string): Promise<TeacherComment[]>;

  insertLicence(l: Licence): Promise<void>;
  listLicencesBySchool(schoolId: string): Promise<Licence[]>;
}
