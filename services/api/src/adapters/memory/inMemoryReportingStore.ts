import type { BehaviouralObservation, CoCurricularRecord, Licence, TeacherComment } from "../../domain/reporting";
import type { ReportingStore } from "../../ports/reportingStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryReportingStore implements ReportingStore {
  private observations = new Map<string, BehaviouralObservation>();
  private coCurricular = new Map<string, CoCurricularRecord>();
  private comments = new Map<string, TeacherComment>();
  private licences = new Map<string, Licence>();

  async insertObservation(o: BehaviouralObservation): Promise<void> { this.observations.set(o.id, clone(o)); }
  async listObservationsByStudent(studentId: string): Promise<BehaviouralObservation[]> {
    return [...this.observations.values()].filter((o) => o.studentId === studentId).map(clone);
  }
  async listObservationsBySchool(schoolId: string): Promise<BehaviouralObservation[]> {
    return [...this.observations.values()].filter((o) => o.schoolId === schoolId).map(clone);
  }

  async insertCoCurricular(r: CoCurricularRecord): Promise<void> { this.coCurricular.set(r.id, clone(r)); }
  async listCoCurricularByStudent(studentId: string): Promise<CoCurricularRecord[]> {
    return [...this.coCurricular.values()].filter((r) => r.studentId === studentId).map(clone);
  }

  async insertComment(c: TeacherComment): Promise<void> { this.comments.set(c.id, clone(c)); }
  async listCommentsByStudent(studentId: string): Promise<TeacherComment[]> {
    return [...this.comments.values()].filter((c) => c.studentId === studentId).map(clone);
  }

  async insertLicence(l: Licence): Promise<void> { this.licences.set(l.id, clone(l)); }
  async listLicencesBySchool(schoolId: string): Promise<Licence[]> {
    return [...this.licences.values()].filter((l) => l.schoolId === schoolId).map(clone);
  }
}
