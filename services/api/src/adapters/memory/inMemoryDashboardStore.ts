import type { DashboardStore, FocusDismissal, GroupAssignment } from "../../ports/dashboardStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryDashboardStore implements DashboardStore {
  private dismissals = new Map<string, FocusDismissal>();
  private assignments = new Map<string, GroupAssignment>();

  async insertDismissal(d: FocusDismissal): Promise<void> {
    this.dismissals.set(d.id, clone(d));
  }
  async listDismissals(schoolId: string, classId: string): Promise<FocusDismissal[]> {
    return [...this.dismissals.values()]
      .filter((d) => d.schoolId === schoolId && d.classId === classId)
      .map(clone);
  }

  async insertAssignment(a: GroupAssignment): Promise<void> {
    this.assignments.set(a.id, clone(a));
  }
  async getAssignment(id: string): Promise<GroupAssignment | undefined> {
    const a = this.assignments.get(id);
    return a ? clone(a) : undefined;
  }
  async listAssignmentsByClass(schoolId: string, classId: string): Promise<GroupAssignment[]> {
    return [...this.assignments.values()]
      .filter((a) => a.schoolId === schoolId && a.classId === classId)
      .map(clone);
  }
}
