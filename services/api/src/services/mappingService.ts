import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import { ancestorChain, type ContentMapping, type SkillNode } from "../domain/skillGraph";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { ContentService } from "./contentService";

export interface MapOptions {
  source?: "ai" | "teacher";
  difficulty?: string;
}

export interface MappingView {
  mapping: ContentMapping;
  chain: SkillNode[];
}

export type OverrideResult =
  | { requiresDecision: true; prompt: "remap-historical-data"; oldNodeId: string; newNodeId: string }
  | { requiresDecision: false; mapping: ContentMapping };

export type BulkOverrideResult =
  | { requiresConfirmation: true; count: number }
  | { requiresConfirmation: false; applied: number };

/**
 * FR-SKG-001/002/004 — map approved content through the skill graph, with
 * teacher overrides. Mapping is BLOCKED unless a signed-off graph exists for the
 * school's curriculum (Decision 4 gate), and only reads from the approved pool.
 */
export class MappingService {
  constructor(
    private readonly graph: SkillGraphStore,
    private readonly contentStore: ContentStore,
    private readonly content: ContentService,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Configure a school's curriculum (FR-SKG-002). */
  async configureCurriculum(schoolId: string, curriculum: string, customOutcomesDefined = true): Promise<void> {
    await this.graph.setSchoolCurriculum({ schoolId, curriculum, customOutcomesDefined });
  }

  /**
   * Map approved content to one or more skill-graph nodes. Multi-node mapping is
   * supported (FR-SKG-001). Nodes with no defined prerequisite are flagged, not
   * blocked.
   */
  async mapContent(contentItemId: string, nodeIds: string[], options: MapOptions = {}): Promise<ContentMapping[]> {
    if (nodeIds.length === 0) throw new ValidationError("At least one node id is required.");
    const item = await this.contentStore.getContentItem(contentItemId);
    if (!item) throw new NotFoundError("Content item not found.");
    // Reads only from the approved pool (M1 gate is load-bearing).
    if (!(await this.content.isInApprovedPool(contentItemId))) {
      throw new ConflictError("CONTENT_NOT_APPROVED", "Only approved content can be mapped.");
    }

    const version = await this.requireSignedOffVersion(item.schoolId);
    const created: ContentMapping[] = [];
    for (const nodeId of nodeIds) {
      const node = await this.graph.getNode(version.id, nodeId);
      if (!node) throw new NotFoundError(`Node "${nodeId}" not in the signed-off graph.`);
      const mapping: ContentMapping = {
        id: newId(),
        graphVersionId: version.id,
        contentItemId,
        nodeId,
        source: options.source ?? "ai",
        difficulty: options.difficulty ?? "developing", // item attribute, never a node
        overriddenFromNodeId: null,
        flags: await this.flagsFor(version.id, node),
        createdAt: this.clock.isoNow(),
      };
      await this.graph.insertMapping(mapping);
      created.push(mapping);
      this.audit.append({
        action: "skillgraph.content.mapped",
        actorId: null,
        subjectType: "content",
        subjectId: contentItemId,
        metadata: { nodeId, graphVersionId: version.id, flags: mapping.flags },
      });
    }
    return created;
  }

  /** Content's mappings, each with its full subject→…→node chain. */
  async mappingViews(contentItemId: string): Promise<MappingView[]> {
    const views: MappingView[] = [];
    for (const mapping of await this.graph.listMappingsByContent(contentItemId)) {
      views.push({
        mapping,
        chain: ancestorChain(mapping.nodeId, await this.graph.listNodes(mapping.graphVersionId)),
      });
    }
    return views;
  }

  /**
   * Teacher overrides a mapping (FR-SKG-004). Reflected everywhere (the mapping
   * is the single source). If historical mastery data exists against the old
   * node, the caller must decide whether to remap it rather than discard it.
   */
  async overrideMapping(
    mappingId: string,
    newNodeId: string,
    teacherId: string,
    options: { remapHistorical?: boolean } = {},
  ): Promise<OverrideResult> {
    const mapping = await this.graph.getMapping(mappingId);
    if (!mapping) throw new NotFoundError("Mapping not found.");
    const newNode = await this.graph.getNode(mapping.graphVersionId, newNodeId);
    if (!newNode) throw new NotFoundError(`Node "${newNodeId}" not in the graph.`);

    const hasHistory = await this.graph.masteryExists(mapping.contentItemId, mapping.nodeId);
    if (hasHistory && options.remapHistorical === undefined) {
      return { requiresDecision: true, prompt: "remap-historical-data", oldNodeId: mapping.nodeId, newNodeId };
    }

    const updated: ContentMapping = {
      ...mapping,
      overriddenFromNodeId: mapping.nodeId,
      nodeId: newNodeId,
      source: "teacher",
      flags: await this.flagsFor(mapping.graphVersionId, newNode),
    };
    await this.graph.updateMapping(updated);
    this.audit.append({
      action: "skillgraph.mapping.overridden",
      actorId: teacherId,
      subjectType: "content",
      subjectId: mapping.contentItemId,
      metadata: { from: mapping.nodeId, to: newNodeId, remapHistorical: options.remapHistorical ?? false },
    });
    return { requiresDecision: false, mapping: updated };
  }

  /** Bulk override many mappings to one node with a single confirmation. */
  async bulkOverride(
    mappingIds: string[],
    newNodeId: string,
    teacherId: string,
    options: { confirm?: boolean } = {},
  ): Promise<BulkOverrideResult> {
    if (!options.confirm) {
      return { requiresConfirmation: true, count: mappingIds.length };
    }
    let applied = 0;
    for (const id of mappingIds) {
      const mapping = await this.graph.getMapping(id);
      if (!mapping) continue;
      const newNode = await this.graph.getNode(mapping.graphVersionId, newNodeId);
      if (!newNode) throw new NotFoundError(`Node "${newNodeId}" not in the graph.`);
      await this.graph.updateMapping({
        ...mapping,
        overriddenFromNodeId: mapping.nodeId,
        nodeId: newNodeId,
        source: "teacher",
        flags: await this.flagsFor(mapping.graphVersionId, newNode),
      });
      applied += 1;
    }
    this.audit.append({
      action: "skillgraph.mapping.bulk_overridden",
      actorId: teacherId,
      subjectType: "skill_graph",
      subjectId: newNodeId,
      metadata: { count: applied },
    });
    return { requiresConfirmation: false, applied };
  }

  /**
   * Switch a school's curriculum. Previously mapped content (under a different
   * curriculum) is flagged for re-mapping rather than silently left inconsistent.
   */
  async switchCurriculum(schoolId: string, newCurriculum: string): Promise<ContentMapping[]> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    await this.graph.setSchoolCurriculum({
      schoolId,
      curriculum: newCurriculum,
      customOutcomesDefined: config?.customOutcomesDefined ?? true,
    });
    const stale = await this.mappingsNeedingRemap(schoolId);
    this.audit.append({
      action: "skillgraph.curriculum.switched",
      actorId: null,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { to: newCurriculum, flaggedForRemap: stale.length },
    });
    return stale;
  }

  /** Mappings whose graph curriculum differs from the school's current one. */
  async mappingsNeedingRemap(schoolId: string): Promise<ContentMapping[]> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    if (!config) return [];
    const items = new Set((await this.contentStore.listContentItemsBySchool(schoolId)).map((i) => i.id));
    const stale: ContentMapping[] = [];
    for (const v of await this.graph.listGraphVersions()) {
      if (v.curriculum === config.curriculum) continue;
      for (const m of await this.graph.listMappingsByVersion(v.id)) {
        if (items.has(m.contentItemId)) stale.push(m);
      }
    }
    return stale;
  }

  /**
   * Whether outcome mapping is required or pending for a school. A custom
   * curriculum without a defined outcome set makes outcome mapping optional.
   */
  async outcomeMappingPolicy(schoolId: string): Promise<"required" | "pending"> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    if (config && config.curriculum !== "NSW" && !config.customOutcomesDefined) return "pending";
    return "required";
  }

  private async requireSignedOffVersion(schoolId: string) {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    const curriculum = config?.curriculum ?? "NSW";
    const version = await this.graph.latestSignedOffVersion(curriculum);
    if (!version) {
      throw new ConflictError(
        "SKILL_GRAPH_NOT_SIGNED_OFF",
        `No signed-off skill graph for curriculum "${curriculum}". Content cannot be mapped against an unsigned graph.`,
      );
    }
    return version;
  }

  /** Flag a skill with no defined prerequisite (and not foundational). */
  private async flagsFor(versionId: string, node: SkillNode): Promise<string[]> {
    if (node.type !== "skill" || node.foundational) return [];
    const hasIncoming = (await this.graph.listEdges(versionId)).some((e) => e.to === node.id);
    return hasIncoming ? [] : ["missing_prerequisite"];
  }
}
