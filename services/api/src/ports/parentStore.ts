import type { ParentChildLink } from "../domain/parent";

/** Persistence port for Milestone 8 verified parent-child links. */
export interface ParentStore {
  insertLink(link: ParentChildLink): Promise<void>;
  getLink(id: string): Promise<ParentChildLink | undefined>;
  updateLink(link: ParentChildLink): Promise<void>;
  findLink(parentId: string, studentId: string): Promise<ParentChildLink | undefined>;
  listLinksByParent(parentId: string): Promise<ParentChildLink[]>;
  listLinksBySchool(schoolId: string): Promise<ParentChildLink[]>;
}
