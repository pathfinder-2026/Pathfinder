import type {
  ContentMapping,
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
 * Persistence port for the skill graph. In-memory adapter backs dev/tests;
 * production is PostgreSQL in ap-southeast-2 (schema + migration 0004).
 */
export interface SkillGraphStore {
  // Versions (governance-tracked, signed-off state)
  insertGraphVersion(version: SkillGraphVersion): void;
  getGraphVersion(id: string): SkillGraphVersion | undefined;
  updateGraphVersion(version: SkillGraphVersion): void;
  listGraphVersions(): SkillGraphVersion[];
  latestSignedOffVersion(curriculum: string): SkillGraphVersion | undefined;

  // Nodes & prerequisite edges (per version)
  insertNode(versionId: string, node: SkillNode): void;
  getNode(versionId: string, nodeId: string): SkillNode | undefined;
  listNodes(versionId: string): SkillNode[];
  insertEdge(versionId: string, edge: PrerequisiteEdge): void;
  listEdges(versionId: string): PrerequisiteEdge[];

  // Content mappings
  insertMapping(mapping: ContentMapping): void;
  getMapping(id: string): ContentMapping | undefined;
  updateMapping(mapping: ContentMapping): void;
  listMappingsByContent(contentItemId: string): ContentMapping[];
  listMappingsByVersion(versionId: string): ContentMapping[];

  // School curriculum config
  setSchoolCurriculum(config: SchoolCurriculum): void;
  getSchoolCurriculum(schoolId: string): SchoolCurriculum | undefined;

  // Mastery references — stands in for M5 mastery data so the remap-historical
  // prompt (FR-SKG-004) is testable now.
  recordMastery(contentItemId: string, nodeId: string): void;
  masteryExists(contentItemId: string, nodeId: string): boolean;
}
