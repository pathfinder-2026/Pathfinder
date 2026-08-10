import { ValidationError } from "./errors";

/**
 * Milestone 2 — Skill Graph domain.
 *
 * The skill graph is versioned trusted infrastructure (Foundational Decision 4):
 * the prerequisite graph is validated acyclic on import and on every structural
 * edit; difficulty is an item/question attribute, NEVER a node; and a graph
 * version must be curriculum-expert **signed off** before any content is mapped
 * against it. Sign-off is an explicit, audited governance state — the program
 * never self-certifies it.
 */

export type SkillNodeType =
  | "subject" | "strand" | "outcome" | "topic" | "concept" | "skill" | "subskill";

/** The canonical hierarchy order (subject at the top). */
export const HIERARCHY: SkillNodeType[] = [
  "subject", "strand", "outcome", "topic", "concept", "skill", "subskill",
];

export interface SkillNode {
  id: string;
  type: SkillNodeType;
  label: string;
  code?: string;
  parentId: string | null;
  curriculum: string;
  /** Genuine root skills that legitimately need no prerequisite (not flagged). */
  foundational?: boolean;
}

/** Directed prerequisite: `from` must be learned before `to`. */
export interface PrerequisiteEdge {
  from: string;
  to: string;
}

export type GraphStatus = "draft" | "signed_off";

export interface SkillGraphVersion {
  id: string;
  name: string;
  curriculum: string;
  version: string;
  status: GraphStatus;
  signedOffBy: string | null;
  signedOffAt: string | null;
  createdAt: string;
}

/** Raw seed/JSON shape imported into a version. */
export interface SkillGraphSource {
  _meta?: Record<string, unknown>;
  nodes: SkillNode[];
  prerequisites: PrerequisiteEdge[];
}

export type MappingSource = "ai" | "teacher";

/**
 * A link from approved content to a skill-graph node. Difficulty rides here as
 * an item attribute (Decision 4), not as a node. `flags` carries e.g.
 * "missing_prerequisite".
 */
export interface ContentMapping {
  id: string;
  graphVersionId: string;
  contentItemId: string;
  nodeId: string;
  source: MappingSource;
  difficulty: string; // item attribute: e.g. "foundational" | "developing" | "extending"
  overriddenFromNodeId: string | null;
  flags: string[];
  createdAt: string;
}

// ---- Acyclicity (Foundational Decision 4) ----

export interface CycleCheck {
  acyclic: boolean;
  cycle?: string[];
}

/**
 * Detect a cycle in the prerequisite edges via DFS with a recursion stack.
 * Returns the offending path if a cycle exists.
 */
export function findPrerequisiteCycle(edges: PrerequisiteEdge[]): CycleCheck {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];

  const nodes = new Set<string>();
  for (const e of edges) { nodes.add(e.from); nodes.add(e.to); }

  function dfs(node: string): string[] | null {
    colour.set(node, GREY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        // Found a back-edge — extract the cycle from the stack.
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    colour.set(node, BLACK);
    return null;
  }

  for (const node of nodes) {
    if ((colour.get(node) ?? WHITE) === WHITE) {
      const cycle = dfs(node);
      if (cycle) return { acyclic: false, cycle };
    }
  }
  return { acyclic: true };
}

/** Validate a graph source: referential integrity + difficulty-not-a-node + acyclic. */
export function validateGraphSource(source: SkillGraphSource): void {
  const ids = new Set(source.nodes.map((n) => n.id));
  if (ids.size !== source.nodes.length) {
    throw new ValidationError("Skill graph has duplicate node ids.");
  }
  for (const node of source.nodes) {
    if (!HIERARCHY.includes(node.type)) {
      // Guards Decision 4: difficulty (and anything else) can never be a node type.
      throw new ValidationError(`Invalid node type "${node.type}" (difficulty must be an item attribute, not a node).`);
    }
    if (node.parentId && !ids.has(node.parentId)) {
      throw new ValidationError(`Node "${node.id}" references missing parent "${node.parentId}".`);
    }
  }
  for (const edge of source.prerequisites) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new ValidationError(`Prerequisite edge ${edge.from}->${edge.to} references an unknown node.`);
    }
  }
  const cycle = findPrerequisiteCycle(source.prerequisites);
  if (!cycle.acyclic) {
    throw new ValidationError(`Prerequisite graph is not acyclic: ${cycle.cycle?.join(" -> ")}`);
  }
}

/** The full chain from the subject down to a node, via parentId. */
export function ancestorChain(nodeId: string, nodes: SkillNode[]): SkillNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: SkillNode[] = [];
  let current = byId.get(nodeId);
  while (current) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}
