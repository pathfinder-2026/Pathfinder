import type { MasteryRecord, MisconceptionSignal } from "../../domain/mastery";
import type { ActivityStore } from "../../ports/activityStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryActivityStore implements ActivityStore {
  private mastery = new Map<string, MasteryRecord>();
  private misconceptions = new Map<string, MisconceptionSignal>();

  async insertMastery(r: MasteryRecord): Promise<void> { this.mastery.set(r.id, clone(r)); }
  async updateMastery(r: MasteryRecord): Promise<void> { this.mastery.set(r.id, clone(r)); }
  async listMasteryBySchool(schoolId: string): Promise<MasteryRecord[]> {
    return [...this.mastery.values()].filter((r) => r.schoolId === schoolId).map(clone);
  }
  async listMasteryByNode(schoolId: string, nodeId: string): Promise<MasteryRecord[]> {
    return [...this.mastery.values()].filter((r) => r.schoolId === schoolId && r.nodeId === nodeId).map(clone);
  }

  async insertMisconception(s: MisconceptionSignal): Promise<void> { this.misconceptions.set(s.id, clone(s)); }
  async listMisconceptionsBySchool(schoolId: string): Promise<MisconceptionSignal[]> {
    return [...this.misconceptions.values()].filter((s) => s.schoolId === schoolId).map(clone);
  }

  async deleteByStudent(studentId: string): Promise<void> {
    for (const [id, r] of this.mastery) if (r.studentId === studentId) this.mastery.delete(id);
    for (const [id, s] of this.misconceptions) if (s.studentId === studentId) this.misconceptions.delete(id);
  }
}
