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

  async insertGraphVersion(version: SkillGraphVersion): Promise<void> {
    this.versions.set(version.id, clone(version));
    if (!this.nodes.has(version.id)) this.nodes.set(version.id, new Map());
    if (!this.edges.has(version.id)) this.edges.set(version.id, []);
  }
  async getGraphVersion(id: string): Promise<SkillGraphVersion | undefined> {
    const v = this.versions.get(id); return v ? clone(v) : undefined;
  }
  async updateGraphVersion(version: SkillGraphVersion): Promise<void> {
    this.versions.set(version.id, clone(version));
  }
  async listGraphVersions(): Promise<SkillGraphVersion[]> {
    return [...this.versions.values()].map(clone);
  }
  async latestSignedOffVersion(curriculum: string): Promise<SkillGraphVersion | undefined> {
    const signed = [...this.versions.values()]
      .filter((v) => v.curriculum === curriculum && v.status === "signed_off")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return signed[0] ? clone(signed[0]) : undefined;
  }

  async insertNode(versionId: string, node: SkillNode): Promise<void> {
    if (!this.nodes.has(versionId)) this.nodes.set(versionId, new Map());
    this.nodes.get(versionId)!.set(node.id, clone(node));
  }
  async getNode(versionId: string, nodeId: string): Promise<SkillNode | undefined> {
    const n = this.nodes.get(versionId)?.get(nodeId); return n ? clone(n) : undefined;
  }
  async listNodes(versionId: string): Promise<SkillNode[]> {
    return [...(this.nodes.get(versionId)?.values() ?? [])].map(clone);
  }
  async insertEdge(versionId: string, edge: PrerequisiteEdge): Promise<void> {
    if (!this.edges.has(versionId)) this.edges.set(versionId, []);
    this.edges.get(versionId)!.push(clone(edge));
  }
  async listEdges(versionId: string): Promise<PrerequisiteEdge[]> {
    return [...(this.edges.get(versionId) ?? [])].map(clone);
  }

  async insertMapping(mapping: ContentMapping): Promise<void> { this.mappings.set(mapping.id, clone(mapping)); }
  async getMapping(id: string): Promise<ContentMapping | undefined> {
    const m = this.mappings.get(id); return m ? clone(m) : undefined;
  }
  async updateMapping(mapping: ContentMapping): Promise<void> { this.mappings.set(mapping.id, clone(mapping)); }
  async listMappingsByContent(contentItemId: string): Promise<ContentMapping[]> {
    return [...this.mappings.values()].filter((m) => m.contentItemId === contentItemId).map(clone);
  }
  async listMappingsByVersion(versionId: string): Promise<ContentMapping[]> {
    return [...this.mappings.values()].filter((m) => m.graphVersionId === versionId).map(clone);
  }

  async setSchoolCurriculum(config: SchoolCurriculum): Promise<void> { this.curricula.set(config.schoolId, clone(config)); }
  async getSchoolCurriculum(schoolId: string): Promise<SchoolCurriculum | undefined> {
    const c = this.curricula.get(schoolId); return c ? clone(c) : undefined;
  }

  async recordMastery(contentItemId: string, nodeId: string): Promise<void> { this.mastery.add(`${contentItemId}::${nodeId}`); }
  async masteryExists(contentItemId: string, nodeId: string): Promise<boolean> { return this.mastery.has(`${contentItemId}::${nodeId}`); }
}
