import type {
  Assessment,
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentVersion,
} from "../domain/assessment";

/** Persistence port for Milestone 3 assessments. In-memory + Postgres adapters. */
export interface AssessmentStore {
  insertAssessment(a: Assessment): Promise<void>;
  getAssessment(id: string): Promise<Assessment | undefined>;
  updateAssessment(a: Assessment): Promise<void>;
  listAssessmentsByTeacher(teacherId: string): Promise<Assessment[]>;

  insertVersion(v: AssessmentVersion): Promise<void>;
  listVersionsByAssessment(assessmentId: string): Promise<AssessmentVersion[]>;

  insertQuestion(q: AssessmentQuestion): Promise<void>;
  getQuestion(id: string): Promise<AssessmentQuestion | undefined>;
  updateQuestion(q: AssessmentQuestion): Promise<void>;
  deleteQuestion(id: string): Promise<void>;
  listQuestionsByVersion(versionId: string): Promise<AssessmentQuestion[]>;
  listQuestionsByAssessment(assessmentId: string): Promise<AssessmentQuestion[]>;

  insertAttempt(a: AssessmentAttempt): Promise<void>;
  getAttempt(id: string): Promise<AssessmentAttempt | undefined>;
  updateAttempt(a: AssessmentAttempt): Promise<void>;
  listAttemptsByAssessment(assessmentId: string): Promise<AssessmentAttempt[]>;
  listAttemptsByStudent(studentId: string): Promise<AssessmentAttempt[]>;
}
