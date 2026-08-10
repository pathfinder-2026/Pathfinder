import type {
  Assessment,
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentVersion,
} from "../../domain/assessment";
import type { AssessmentStore } from "../../ports/assessmentStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryAssessmentStore implements AssessmentStore {
  private assessments = new Map<string, Assessment>();
  private versions = new Map<string, AssessmentVersion>();
  private questions = new Map<string, AssessmentQuestion>();
  private attempts = new Map<string, AssessmentAttempt>();

  async insertAssessment(a: Assessment): Promise<void> { this.assessments.set(a.id, clone(a)); }
  async getAssessment(id: string): Promise<Assessment | undefined> { const v = this.assessments.get(id); return v ? clone(v) : undefined; }
  async updateAssessment(a: Assessment): Promise<void> { this.assessments.set(a.id, clone(a)); }
  async listAssessmentsByTeacher(teacherId: string): Promise<Assessment[]> {
    return [...this.assessments.values()].filter((a) => a.teacherId === teacherId).map(clone);
  }

  async insertVersion(v: AssessmentVersion): Promise<void> { this.versions.set(v.id, clone(v)); }
  async listVersionsByAssessment(assessmentId: string): Promise<AssessmentVersion[]> {
    return [...this.versions.values()].filter((v) => v.assessmentId === assessmentId).sort((a, b) => a.label.localeCompare(b.label)).map(clone);
  }

  async insertQuestion(q: AssessmentQuestion): Promise<void> { this.questions.set(q.id, clone(q)); }
  async getQuestion(id: string): Promise<AssessmentQuestion | undefined> { const v = this.questions.get(id); return v ? clone(v) : undefined; }
  async updateQuestion(q: AssessmentQuestion): Promise<void> { this.questions.set(q.id, clone(q)); }
  async listQuestionsByVersion(versionId: string): Promise<AssessmentQuestion[]> {
    return [...this.questions.values()].filter((q) => q.versionId === versionId).sort((a, b) => a.order - b.order).map(clone);
  }
  async listQuestionsByAssessment(assessmentId: string): Promise<AssessmentQuestion[]> {
    const versionIds = new Set((await this.listVersionsByAssessment(assessmentId)).map((v) => v.id));
    return [...this.questions.values()].filter((q) => versionIds.has(q.versionId)).map(clone);
  }

  async insertAttempt(a: AssessmentAttempt): Promise<void> { this.attempts.set(a.id, clone(a)); }
  async getAttempt(id: string): Promise<AssessmentAttempt | undefined> { const v = this.attempts.get(id); return v ? clone(v) : undefined; }
  async updateAttempt(a: AssessmentAttempt): Promise<void> { this.attempts.set(a.id, clone(a)); }
  async listAttemptsByAssessment(assessmentId: string): Promise<AssessmentAttempt[]> {
    return [...this.attempts.values()].filter((a) => a.assessmentId === assessmentId).map(clone);
  }
  async listAttemptsByStudent(studentId: string): Promise<AssessmentAttempt[]> {
    return [...this.attempts.values()].filter((a) => a.studentId === studentId).map(clone);
  }
}
