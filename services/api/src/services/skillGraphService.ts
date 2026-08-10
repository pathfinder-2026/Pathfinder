import { ConflictError, NotFoundError } from "../domain/errors";
import {
  ancestorChain,
  findPrerequisiteCycle,
  validateGraphSource,
  type PrerequisiteEdge,
  type SkillGraphSource,
  type SkillGraphVersion,
  type SkillNode,
} from "../domain/skillGraph";
import { ValidationError } from "../domain/errors";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { SkillGraphStore } from "../ports/skillGraphStore";

/**
 * Manages the skill graph as versioned trusted infrastructure (Decision 4).
 * Acyclicity is validated on import AND on every structural edit. Sign-off is an
 * explicit, audited governance action performed by a human curriculum expert —
 * the program never self-certifies.
 */
export class SkillGraphService {
  constructor(
    private readonly store: SkillGraphStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Import a graph source as a new DRAFT version (validated acyclic). */
  importGraph(source: SkillGraphSource, actorId: string | null = null): SkillGraphVersion {
    validateGraphSource(source); // throws on cycle / bad refs / difficulty-as-node

    const meta = source._meta ?? {};
    const version: SkillGraphVersion = {
      id: newId(),
      name: String(meta.name ?? "Skill Graph"),
      curriculum: String(meta.curriculum ?? source.nodes[0]?.curriculum ?? "NSW"),
      version: String(meta.version ?? "0.1"),
      status: "draft", // NEVER auto-signed — imports unsigned
      signedOffBy: null,
      signedOffAt: null,
      createdAt: this.clock.isoNow(),
    };
    this.store.insertGraphVersion(version);
    for (const node of source.nodes) this.store.insertNode(version.id, node);
    for (const edge of source.prerequisites) this.store.insertEdge(version.id, edge);

    this.audit.append({
      action: "skillgraph.imported",
      actorId,
      subjectType: "skill_graph",
      subjectId: version.id,
      metadata: { curriculum: version.curriculum, version: version.version, nodes: source.nodes.length, edges: source.prerequisites.length, status: "draft" },
    });
    return version;
  }

  /**
   * Curriculum-expert sign-off — the single external gate before mapping
   * (Decision 4). A human performs this after reviewing the draft; the program
   * only records it.
   */
  signOff(versionId: string, expertId: string): SkillGraphVersion {
    const version = this.requireVersion(versionId);
    if (!expertId) throw new ValidationError("Sign-off requires the reviewing expert's id.");
    if (version.status === "signed_off") return version;
    const signed: SkillGraphVersion = {
      ...version,
      status: "signed_off",
      signedOffBy: expertId,
      signedOffAt: this.clock.isoNow(),
    };
    this.store.updateGraphVersion(signed);
    this.audit.append({
      action: "skillgraph.signed_off",
      actorId: expertId,
      subjectType: "skill_graph",
      subjectId: versionId,
      metadata: { curriculum: version.curriculum, version: version.version },
    });
    return signed;
  }

  /** Add a prerequisite edge; re-validates acyclicity (structural edit, Decision 4). */
  addPrerequisite(versionId: string, edge: PrerequisiteEdge, actorId: string | null = null): void {
    this.requireVersion(versionId);
    const nodes = this.store.listNodes(versionId);
    const ids = new Set(nodes.map((n) => n.id));
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new ValidationError(`Prerequisite edge ${edge.from}->${edge.to} references an unknown node.`);
    }
    const proposed = [...this.store.listEdges(versionId), edge];
    const cycle = findPrerequisiteCycle(proposed);
    if (!cycle.acyclic) {
      // Reject the edit — the graph must remain acyclic.
      throw new ValidationError(`Adding ${edge.from}->${edge.to} would create a cycle: ${cycle.cycle?.join(" -> ")}`);
    }
    this.store.insertEdge(versionId, edge);
    this.audit.append({
      action: "skillgraph.edge.added",
      actorId,
      subjectType: "skill_graph",
      subjectId: versionId,
      metadata: { from: edge.from, to: edge.to },
    });
  }

  getVersion(versionId: string): SkillGraphVersion | undefined {
    return this.store.getGraphVersion(versionId);
  }

  /** The full subject→…→node chain for a mapped node. */
  chainFor(versionId: string, nodeId: string): SkillNode[] {
    return ancestorChain(nodeId, this.store.listNodes(versionId));
  }

  private requireVersion(versionId: string): SkillGraphVersion {
    const version = this.store.getGraphVersion(versionId);
    if (!version) throw new NotFoundError("Skill graph version not found.");
    return version;
  }
}
