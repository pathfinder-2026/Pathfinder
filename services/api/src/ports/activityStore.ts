import type { MasteryRecord, MisconceptionSignal } from "../domain/mastery";

/** Persistence port for Milestone 4 mastery/misconception activity. */
export interface ActivityStore {
  insertMastery(record: MasteryRecord): Promise<void>;
  updateMastery(record: MasteryRecord): Promise<void>;
  listMasteryBySchool(schoolId: string): Promise<MasteryRecord[]>;
  listMasteryByNode(schoolId: string, nodeId: string): Promise<MasteryRecord[]>;

  insertMisconception(signal: MisconceptionSignal): Promise<void>;
  listMisconceptionsBySchool(schoolId: string): Promise<MisconceptionSignal[]>;

  /** Remove all activity for a student (used by synthetic-student deletion). */
  deleteByStudent(studentId: string): Promise<void>;
}
