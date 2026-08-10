import type {
  ContentMapping,
  PrerequisiteEdge,
  SkillGraphVersion,
  SkillNode,
} from "../../domain/skillGraph";
import type { SchoolCurriculum, SkillGraphStore } from "../../ports/skillGraphStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemorySkillGraphStore implements SkillGraphStore {
  private versions = new Map<string, SkillGraphVersion>();
  private nodes = new Map<string, Map<string, SkillNode>>(); // versionId -> nodeId -> node
  private edges = new Map<string, PrerequisiteEdge[]>(); // versionId -> edges
  private mappings = new Map<string, ContentMapping>();
  private curricula = new Map<string, SchoolCurriculum>();
  private mastery = new Set<string>(); // `${contentItemId}::${nodeId}`

  insertGraphVersion(version: SkillGraphVersion): void {
    this.versions.set(version.id, clone(version));
    if (!this.nodes.has(version.id)) this.nodes.set(version.id, new Map());
    if (!this.edges.has(version.id)) this.edges.set(version.id, []);
  }
  getGraphVersion(id: string): SkillGraphVersion | undefined {
    const v = this.versions.get(id); return v ? clone(v) : undefined;
  }
  updateGraphVersion(version: SkillGraphVersion): void {
    this.versions.set(version.id, clone(version));
  }
  listGraphVersions(): SkillGraphVersion[] {
    return [...this.versions.values()].map(clone);
  }
  latestSignedOffVersion(curriculum: string): SkillGraphVersion | undefined {
    const signed = [...this.versions.values()]
      .filter((v) => v.curriculum === curriculum && v.status === "signed_off")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return signed[0] ? clone(signed[0]) : undefined;
  }

  insertNode(versionId: string, node: SkillNode): void {
    if (!this.nodes.has(versionId)) this.nodes.set(versionId, new Map());
    this.nodes.get(versionId)!.set(node.id, clone(node));
  }
  getNode(versionId: string, nodeId: string): SkillNode | undefined {
    const n = this.nodes.get(versionId)?.get(nodeId); return n ? clone(n) : undefined;
  }
  listNodes(versionId: string): SkillNode[] {
    return [...(this.nodes.get(versionId)?.values() ?? [])].map(clone);
  }
  insertEdge(versionId: string, edge: PrerequisiteEdge): void {
    if (!this.edges.has(versionId)) this.edges.set(versionId, []);
    this.edges.get(versionId)!.push(clone(edge));
  }
  listEdges(versionId: string): PrerequisiteEdge[] {
    return [...(this.edges.get(versionId) ?? [])].map(clone);
  }

  insertMapping(mapping: ContentMapping): void { this.mappings.set(mapping.id, clone(mapping)); }
  getMapping(id: string): ContentMapping | undefined {
    const m = this.mappings.get(id); return m ? clone(m) : undefined;
  }
  updateMapping(mapping: ContentMapping): void { this.mappings.set(mapping.id, clone(mapping)); }
  listMappingsByContent(contentItemId: string): ContentMapping[] {
    return [...this.mappings.values()].filter((m) => m.contentItemId === contentItemId).map(clone);
  }
  listMappingsByVersion(versionId: string): ContentMapping[] {
    return [...this.mappings.values()].filter((m) => m.graphVersionId === versionId).map(clone);
  }

  setSchoolCurriculum(config: SchoolCurriculum): void { this.curricula.set(config.schoolId, clone(config)); }
  getSchoolCurriculum(schoolId: string): SchoolCurriculum | undefined {
    const c = this.curricula.get(schoolId); return c ? clone(c) : undefined;
  }

  recordMastery(contentItemId: string, nodeId: string): void { this.mastery.add(`${contentItemId}::${nodeId}`); }
  masteryExists(contentItemId: string, nodeId: string): boolean { return this.mastery.has(`${contentItemId}::${nodeId}`); }
}
