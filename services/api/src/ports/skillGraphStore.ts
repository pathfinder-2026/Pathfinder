import type {
  ContentMapping,
  GraphScope,
  PrerequisiteEdge,
  SkillGraphVersion,
  SkillNode,
} from "../domain/skillGraph";

/** A school's active curriculum configuration (FR-SKG-002). */
export interface SchoolCurriculum {
  schoolId: string;
  curriculum: string;
  /** For custom curricula: whether the outcome set has been defined yet. */
  customOutcomesDefined: boolean;
}

/**
 * Persistence port for the skill graph. Async so both the in-memory adapter and
 * the PostgreSQL adapter (ap-southeast-2) satisfy it.
 */
export interface SkillGraphStore {
  // Versions (governance-tracked, signed-off state)
  insertGraphVersion(version: SkillGraphVersion): Promise<void>;
  getGraphVersion(id: string): Promise<SkillGraphVersion | undefined>;
  updateGraphVersion(version: SkillGraphVersion): Promise<void>;
  listGraphVersions(): Promise<SkillGraphVersion[]>;
  /**
   * The best signed-off graph for `scope` (subject/year), or the most recent
   * signed-off graph when no scope is given. Returns undefined rather than a
   * mismatched subject's graph — see scoreGraphMatch.
   */
  latestSignedOffVersion(curriculum: string, scope?: GraphScope): Promise<SkillGraphVersion | undefined>;
  /**
   * Every signed-off graph for a curriculum, newest first. Label and mapping
   * lookups must span all of them: a node id belongs to exactly one graph, so
   * resolving against a single version silently loses every other subject.
   */
  listSignedOffVersions(curriculum: string): Promise<SkillGraphVersion[]>;

  // Nodes & prerequisite edges (per version)
  insertNode(versionId: string, node: SkillNode): Promise<void>;
  getNode(versionId: string, nodeId: string): Promise<SkillNode | undefined>;
  listNodes(versionId: string): Promise<SkillNode[]>;
  /** Remove a node from a DRAFT version (reviewing an AI-drafted curriculum). */
  deleteNode(versionId: string, nodeId: string): Promise<void>;
  insertEdge(versionId: string, edge: PrerequisiteEdge): Promise<void>;
  listEdges(versionId: string): Promise<PrerequisiteEdge[]>;

  // Content mappings
  insertMapping(mapping: ContentMapping): Promise<void>;
  getMapping(id: string): Promise<ContentMapping | undefined>;
  updateMapping(mapping: ContentMapping): Promise<void>;
  listMappingsByContent(contentItemId: string): Promise<ContentMapping[]>;
  /** Remove a mapping — how a wrong link (e.g. a syllabus filed under the wrong
   *  subject) is undone; the audit entry records that it happened. */
  deleteMapping(id: string): Promise<void>;
  listMappingsByVersion(versionId: string): Promise<ContentMapping[]>;

  // School curriculum config
  setSchoolCurriculum(config: SchoolCurriculum): Promise<void>;
  getSchoolCurriculum(schoolId: string): Promise<SchoolCurriculum | undefined>;

  // Mastery references — stands in for M5 mastery data so the remap-historical
  // prompt (FR-SKG-004) is testable now.
  recordMastery(contentItemId: string, nodeId: string): Promise<void>;
  masteryExists(contentItemId: string, nodeId: string): Promise<boolean>;
}
