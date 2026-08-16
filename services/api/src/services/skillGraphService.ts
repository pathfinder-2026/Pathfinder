import { ConflictError, NotFoundError } from "../domain/errors";
import {
  ancestorChain,
  findPrerequisiteCycle,
  validateGraphSource,
  type GraphScope,
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

  /**
   * Import a graph source as a new DRAFT version (validated acyclic).
   *
   * `scope` states the subject × year the graph teaches; when omitted it falls
   * back to the source's own metadata, then to the graph's single subject node.
   */
  async importGraph(
    source: SkillGraphSource,
    actorId: string | null = null,
    scope: GraphScope = {},
  ): Promise<SkillGraphVersion> {
    validateGraphSource(source); // throws on cycle / bad refs / difficulty-as-node
    await this.assertNodeIdsUnused(source);

    const meta = source._meta ?? {};
    const subjectNode = source.nodes.find((n) => n.type === "subject");
    const yearLevel = scope.yearLevel ?? numberOrNull(meta.yearLevel);
    const version: SkillGraphVersion = {
      id: newId(),
      name: String(meta.name ?? "Skill Graph"),
      curriculum: String(meta.curriculum ?? source.nodes[0]?.curriculum ?? "NSW"),
      version: String(meta.version ?? "0.1"),
      status: "draft", // NEVER auto-signed — imports unsigned
      signedOffBy: null,
      signedOffAt: null,
      createdAt: this.clock.isoNow(),
      subject: scope.subject ?? (meta.subject ? String(meta.subject) : subjectNode?.label ?? null),
      yearLevel,
    };
    await this.store.insertGraphVersion(version);
    for (const node of source.nodes) await this.store.insertNode(version.id, node);
    for (const edge of source.prerequisites) await this.store.insertEdge(version.id, edge);

    this.audit.append({
      action: "skillgraph.imported",
      actorId,
      subjectType: "skill_graph",
      subjectId: version.id,
      metadata: {
        curriculum: version.curriculum, version: version.version, nodes: source.nodes.length,
        edges: source.prerequisites.length, status: "draft",
        subject: version.subject, yearLevel: version.yearLevel,
      },
    });
    return version;
  }

  /**
   * Node ids must be unique across every graph in the school, not just within
   * one. Mastery records and content mappings reference a bare node id, so two
   * graphs sharing an id would silently merge two different skills' evidence —
   * a Year 7 student's "fractions" mastery landing on the Year 8 skill.
   */
  private async assertNodeIdsUnused(source: SkillGraphSource): Promise<void> {
    const incoming = new Set(source.nodes.map((n) => n.id));
    for (const version of await this.store.listGraphVersions()) {
      const clashes = (await this.store.listNodes(version.id))
        .filter((n) => incoming.has(n.id))
        .map((n) => n.id);
      if (clashes.length > 0) {
        throw new ValidationError(
          `Node ids already used by "${version.name}": ${clashes.slice(0, 5).join(", ")}${clashes.length > 5 ? ` (+${clashes.length - 5} more)` : ""}. ` +
            "Skill ids must be unique across every curriculum graph, because mastery and content mappings reference them directly.",
        );
      }
    }
  }

  /**
   * Curriculum-expert sign-off — the single external gate before mapping
   * (Decision 4). A human performs this after reviewing the draft; the program
   * only records it.
   */
  async signOff(versionId: string, expertId: string): Promise<SkillGraphVersion> {
    const version = await this.requireVersion(versionId);
    if (!expertId) throw new ValidationError("Sign-off requires the reviewing expert's id.");
    if (version.status === "signed_off") return version;
    const signed: SkillGraphVersion = {
      ...version,
      status: "signed_off",
      signedOffBy: expertId,
      signedOffAt: this.clock.isoNow(),
    };
    await this.store.updateGraphVersion(signed);
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
  async addPrerequisite(versionId: string, edge: PrerequisiteEdge, actorId: string | null = null): Promise<void> {
    await this.requireVersion(versionId);
    const nodes = await this.store.listNodes(versionId);
    const ids = new Set(nodes.map((n) => n.id));
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new ValidationError(`Prerequisite edge ${edge.from}->${edge.to} references an unknown node.`);
    }
    const proposed = [...(await this.store.listEdges(versionId)), edge];
    const cycle = findPrerequisiteCycle(proposed);
    if (!cycle.acyclic) {
      // Reject the edit — the graph must remain acyclic.
      throw new ValidationError(`Adding ${edge.from}->${edge.to} would create a cycle: ${cycle.cycle?.join(" -> ")}`);
    }
    await this.store.insertEdge(versionId, edge);
    this.audit.append({
      action: "skillgraph.edge.added",
      actorId,
      subjectType: "skill_graph",
      subjectId: versionId,
      metadata: { from: edge.from, to: edge.to },
    });
  }

  getVersion(versionId: string): Promise<SkillGraphVersion | undefined> {
    return this.store.getGraphVersion(versionId);
  }

  /** The full subject→…→node chain for a mapped node. */
  async chainFor(versionId: string, nodeId: string): Promise<SkillNode[]> {
    return ancestorChain(nodeId, await this.store.listNodes(versionId));
  }

  private async requireVersion(versionId: string): Promise<SkillGraphVersion> {
    const version = await this.store.getGraphVersion(versionId);
    if (!version) throw new NotFoundError("Skill graph version not found.");
    return version;
  }
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return value == null || Number.isNaN(n) ? null : n;
}
