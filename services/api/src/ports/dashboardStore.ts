import type { GroupType } from "../domain/insights";

/**
 * Persistence port for Milestone 5a intelligence state that must outlive a single
 * dashboard view: dismissed focus-area suggestions and Teacher group assignments.
 * Two adapter families satisfy it — in-memory (dev/tests) and PostgreSQL.
 */

/** A focus-area suggestion a Teacher dismissed as not relevant. */
export interface FocusDismissal {
  id: string;
  schoolId: string;
  classId: string;
  teacherId: string;
  nodeId: string;
  /** The below-mastery fraction at the moment of dismissal (reappearance basis). */
  belowFractionAtDismiss: number;
  dismissedAt: string;
}

/** A Teacher's explicit assignment of work to a (possibly edited) group. */
export interface GroupAssignment {
  id: string;
  schoolId: string;
  classId: string;
  teacherId: string;
  groupType: GroupType;
  nodeId: string | null;
  studentIds: string[];
  contentId: string | null;
  createdAt: string;
}

export interface DashboardStore {
  insertDismissal(d: FocusDismissal): Promise<void>;
  listDismissals(schoolId: string, classId: string): Promise<FocusDismissal[]>;

  insertAssignment(a: GroupAssignment): Promise<void>;
  getAssignment(id: string): Promise<GroupAssignment | undefined>;
  listAssignmentsByClass(schoolId: string, classId: string): Promise<GroupAssignment[]>;
}
