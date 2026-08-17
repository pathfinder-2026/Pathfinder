import type { ContentItem } from "../domain/content";
import type { ContentMapping, SkillNode } from "../domain/skillGraph";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import { signedOffGraphs } from "./curriculumScope";

/**
 * What grounds a concept, now that material is filed at SUBJECT level by default.
 *
 * Task #19 moved the primary mapping target up the tree: a teacher filing a
 * textbook says "Year 8 Technology", not "Design processes → Evaluating". If
 * grounding still demanded an exact node match, every one of those items would
 * ground nothing at all and every generate would decline.
 *
 * So grounding walks the ancestor chain, and the NEAREST mapped level wins:
 * material mapped to the concept itself beats material mapped to its strand,
 * which beats material mapped to the subject. Nearest-wins (rather than a union)
 * is what makes the optional concept-level refinement worth doing — refining one
 * item to a concept genuinely narrows what that concept is taught from, instead
 * of being drowned by everything else filed under the subject. The accepted
 * trade-off is that unrefined material grounds broadly.
 *
 * One index is built per request and shared by every node it answers for: the
 * chains and the pool's mappings are the expensive part, and re-reading them per
 * node turned a 5-concept assessment into 5 full passes over the library.
 */

export interface GroundingSource {
  item: ContentItem;
  /** The mapping that reached this node — the nearest one when several do. */
  mapping: ContentMapping;
  /** 0 = mapped to the node itself, 1 = to its parent, … Higher is broader. */
  distance: number;
}

export class GroundingIndex {
  private constructor(
    /** node id -> [self, parent, …, subject], across every signed-off graph. */
    private readonly chains: Map<string, string[]>,
    /** Approved items that are mapped somewhere, with their mappings. */
    private readonly pool: { item: ContentItem; mappings: ContentMapping[] }[],
  ) {}

  static async build(
    graph: SkillGraphStore,
    schoolId: string,
    approvedPool: ContentItem[],
  ): Promise<GroundingIndex> {
    const chains = new Map<string, string[]>();
    for (const version of await signedOffGraphs(graph, schoolId)) {
      const nodes = await graph.listNodes(version.id);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (const node of nodes) chains.set(node.id, chainOf(node, byId));
    }

    const pool: { item: ContentItem; mappings: ContentMapping[] }[] = [];
    for (const item of approvedPool) {
      const mappings = await graph.listMappingsByContent(item.id);
      if (mappings.length > 0) pool.push({ item, mappings });
    }
    return new GroundingIndex(chains, pool);
  }

  /** Every node the school's signed-off curricula define. */
  nodeIds(): string[] {
    return [...this.chains.keys()];
  }

  /**
   * The node and its ancestors: every place material could be filed and still
   * reach it. What "covers this concept" means when explaining a decline.
   */
  chainFor(nodeId: string): string[] {
    return this.chains.get(nodeId) ?? [nodeId];
  }

  /**
   * The approved material that grounds one node, at the nearest mapped level
   * that has any. Empty when nothing along the chain is mapped — still a real
   * answer, and still a reason to decline rather than invent.
   */
  sourcesFor(nodeId: string): GroundingSource[] {
    // A node outside every signed-off graph (a stale id, a draft-only node) can
    // still only be grounded by an exact mapping — never by guessing a parent.
    const chain = this.chains.get(nodeId) ?? [nodeId];
    const rank = new Map(chain.map((id, i) => [id, i] as const));

    const candidates: GroundingSource[] = [];
    let nearestOverall = Infinity;
    for (const { item, mappings } of this.pool) {
      let nearest: ContentMapping | undefined;
      let distance = Infinity;
      for (const mapping of mappings) {
        const d = rank.get(mapping.nodeId);
        if (d !== undefined && d < distance) { nearest = mapping; distance = d; }
      }
      if (!nearest) continue;
      candidates.push({ item, mapping: nearest, distance });
      nearestOverall = Math.min(nearestOverall, distance);
    }
    return candidates.filter((c) => c.distance === nearestOverall);
  }

  /**
   * The same across several nodes at once (a multi-concept assessment), deduped
   * by content item so one textbook chapter covering three of the chosen
   * concepts contributes its sections once, not three times.
   */
  sourcesForAny(nodeIds: string[]): GroundingSource[] {
    const byItem = new Map<string, GroundingSource>();
    for (const nodeId of nodeIds) {
      for (const source of this.sourcesFor(nodeId)) {
        const seen = byItem.get(source.item.id);
        if (!seen || source.distance < seen.distance) byItem.set(source.item.id, source);
      }
    }
    return [...byItem.values()];
  }

  /**
   * How much each node can be grounded by right now, keyed by node id.
   * `weightOf` is asked once per item (it usually counts sections, which is a
   * store read) and then reused across every node it grounds.
   */
  async capacity(weightOf: (item: ContentItem) => Promise<number>): Promise<Record<string, number>> {
    const weights = new Map<string, number>();
    for (const { item } of this.pool) weights.set(item.id, await weightOf(item));

    const capacity: Record<string, number> = {};
    for (const nodeId of this.chains.keys()) {
      let total = 0;
      for (const source of this.sourcesFor(nodeId)) total += weights.get(source.item.id) ?? 0;
      if (total > 0) capacity[nodeId] = total;
    }
    return capacity;
  }
}

/** [self, parent, …, subject]; `seen` guards a malformed graph from looping. */
function chainOf(node: SkillNode, byId: Map<string, SkillNode>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: SkillNode | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}
