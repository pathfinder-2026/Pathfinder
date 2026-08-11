import type { ParentChildLink } from "../../domain/parent";
import type { ParentStore } from "../../ports/parentStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryParentStore implements ParentStore {
  private links = new Map<string, ParentChildLink>();

  async insertLink(link: ParentChildLink): Promise<void> { this.links.set(link.id, clone(link)); }
  async getLink(id: string): Promise<ParentChildLink | undefined> { const v = this.links.get(id); return v ? clone(v) : undefined; }
  async updateLink(link: ParentChildLink): Promise<void> { this.links.set(link.id, clone(link)); }
  async findLink(parentId: string, studentId: string): Promise<ParentChildLink | undefined> {
    const v = [...this.links.values()].find((l) => l.parentId === parentId && l.studentId === studentId);
    return v ? clone(v) : undefined;
  }
  async listLinksByParent(parentId: string): Promise<ParentChildLink[]> {
    return [...this.links.values()].filter((l) => l.parentId === parentId).map(clone);
  }
  async listLinksBySchool(schoolId: string): Promise<ParentChildLink[]> {
    return [...this.links.values()].filter((l) => l.schoolId === schoolId).map(clone);
  }
}
