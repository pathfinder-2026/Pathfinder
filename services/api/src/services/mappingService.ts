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
  configureCurriculum(schoolId: string, curriculum: string, customOutcomesDefined = true): void {
    this.graph.setSchoolCurriculum({ schoolId, curriculum, customOutcomesDefined });
  }

  /**
   * Map approved content to one or more skill-graph nodes. Multi-node mapping is
   * supported (FR-SKG-001). Nodes with no defined prerequisite are flagged, not
   * blocked.
   */
  mapContent(contentItemId: string, nodeIds: string[], options: MapOptions = {}): ContentMapping[] {
    if (nodeIds.length === 0) throw new ValidationError("At least one node id is required.");
    const item = this.contentStore.getContentItem(contentItemId);
    if (!item) throw new NotFoundError("Content item not found.");
    // Reads only from the approved pool (M1 gate is load-bearing).
    if (!this.content.isInApprovedPool(contentItemId)) {
      throw new ConflictError("CONTENT_NOT_APPROVED", "Only approved content can be mapped.");
    }

    const version = this.requireSignedOffVersion(item.schoolId);
    const created: ContentMapping[] = [];
    for (const nodeId of nodeIds) {
      const node = this.graph.getNode(version.id, nodeId);
      if (!node) throw new NotFoundError(`Node "${nodeId}" not in the signed-off graph.`);
      const mapping: ContentMapping = {
        id: newId(),
        graphVersionId: version.id,
        contentItemId,
        nodeId,
        source: options.source ?? "ai",
        difficulty: options.difficulty ?? "developing", // item attribute, never a node
        overriddenFromNodeId: null,
        flags: this.flagsFor(version.id, node),
        createdAt: this.clock.isoNow(),
      };
      this.graph.insertMapping(mapping);
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
  mappingViews(contentItemId: string): MappingView[] {
    return this.graph.listMappingsByContent(contentItemId).map((mapping) => ({
      mapping,
      chain: ancestorChain(mapping.nodeId, this.graph.listNodes(mapping.graphVersionId)),
    }));
  }

  /**
   * Teacher overrides a mapping (FR-SKG-004). Reflected everywhere (the mapping
   * is the single source). If historical mastery data exists against the old
   * node, the caller must decide whether to remap it rather than discard it.
   */
  overrideMapping(
    mappingId: string,
    newNodeId: string,
    teacherId: string,
    options: { remapHistorical?: boolean } = {},
  ): OverrideResult {
    const mapping = this.graph.getMapping(mappingId);
    if (!mapping) throw new NotFoundError("Mapping not found.");
    const newNode = this.graph.getNode(mapping.graphVersionId, newNodeId);
    if (!newNode) throw new NotFoundError(`Node "${newNodeId}" not in the graph.`);

    const hasHistory = this.graph.masteryExists(mapping.contentItemId, mapping.nodeId);
    if (hasHistory && options.remapHistorical === undefined) {
      return { requiresDecision: true, prompt: "remap-historical-data", oldNodeId: mapping.nodeId, newNodeId };
    }

    const updated: ContentMapping = {
      ...mapping,
      overriddenFromNodeId: mapping.nodeId,
      nodeId: newNodeId,
      source: "teacher",
      flags: this.flagsFor(mapping.graphVersionId, newNode),
    };
    this.graph.updateMapping(updated);
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
  bulkOverride(
    mappingIds: string[],
    newNodeId: string,
    teacherId: string,
    options: { confirm?: boolean } = {},
  ): BulkOverrideResult {
    if (!options.confirm) {
      return { requiresConfirmation: true, count: mappingIds.length };
    }
    let applied = 0;
    for (const id of mappingIds) {
      const mapping = this.graph.getMapping(id);
      if (!mapping) continue;
      const newNode = this.graph.getNode(mapping.graphVersionId, newNodeId);
      if (!newNode) throw new NotFoundError(`Node "${newNodeId}" not in the graph.`);
      this.graph.updateMapping({
        ...mapping,
        overriddenFromNodeId: mapping.nodeId,
        nodeId: newNodeId,
        source: "teacher",
        flags: this.flagsFor(mapping.graphVersionId, newNode),
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
  switchCurriculum(schoolId: string, newCurriculum: string): ContentMapping[] {
    const config = this.graph.getSchoolCurriculum(schoolId);
    this.graph.setSchoolCurriculum({
      schoolId,
      curriculum: newCurriculum,
      customOutcomesDefined: config?.customOutcomesDefined ?? true,
    });
    const stale = this.mappingsNeedingRemap(schoolId);
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
  mappingsNeedingRemap(schoolId: string): ContentMapping[] {
    const config = this.graph.getSchoolCurriculum(schoolId);
    if (!config) return [];
    const items = new Set(this.contentStore.listContentItemsBySchool(schoolId).map((i) => i.id));
    return this.graph
      .listGraphVersions()
      .flatMap((v) => this.graph.listMappingsByVersion(v.id).map((m) => ({ m, curriculum: v.curriculum })))
      .filter(({ m, curriculum }) => items.has(m.contentItemId) && curriculum !== config.curriculum)
      .map(({ m }) => m);
  }

  /**
   * Whether outcome mapping is required or pending for a school. A custom
   * curriculum without a defined outcome set makes outcome mapping optional.
   */
  outcomeMappingPolicy(schoolId: string): "required" | "pending" {
    const config = this.graph.getSchoolCurriculum(schoolId);
    if (config && config.curriculum !== "NSW" && !config.customOutcomesDefined) return "pending";
    return "required";
  }

  private requireSignedOffVersion(schoolId: string) {
    const config = this.graph.getSchoolCurriculum(schoolId);
    const curriculum = config?.curriculum ?? "NSW";
    const version = this.graph.latestSignedOffVersion(curriculum);
    if (!version) {
      throw new ConflictError(
        "SKILL_GRAPH_NOT_SIGNED_OFF",
        `No signed-off skill graph for curriculum "${curriculum}". Content cannot be mapped against an unsigned graph.`,
      );
    }
    return version;
  }

  /** Flag a skill with no defined prerequisite (and not foundational). */
  private flagsFor(versionId: string, node: SkillNode): string[] {
    if (node.type !== "skill" || node.foundational) return [];
    const hasIncoming = this.graph.listEdges(versionId).some((e) => e.to === node.id);
    return hasIncoming ? [] : ["missing_prerequisite"];
  }
}
