import type { ClassRoom } from "../domain/types";
import type { GraphScope, SkillGraphVersion, SkillNode } from "../domain/skillGraph";
import type { SkillGraphStore } from "../ports/skillGraphStore";

/**
 * Resolving which curriculum graph applies, now that a school can have one per
 * subject × year level.
 *
 * These are free functions rather than an injected service on purpose: every
 * caller already holds a SkillGraphStore, so fixing a single-graph assumption is
 * a one-line change at the call site instead of a new constructor dependency
 * threaded through eight services.
 *
 * The rule that matters: anything that RESOLVES A LABEL or COLLECTS MAPPINGS
 * must span every signed-off graph. A node id belongs to exactly one graph, so
 * looking it up in "the latest" graph silently loses every other subject — the
 * heatmap would print raw ids for Science and the reteach lookup would find no
 * material for it.
 */

/** The curriculum a school is on (defaults to NSW, as it always has). */
export async function curriculumOf(graph: SkillGraphStore, schoolId: string): Promise<string> {
  return (await graph.getSchoolCurriculum(schoolId))?.curriculum ?? "NSW";
}

/** Every signed-off graph available to a school, newest first. */
export async function signedOffGraphs(
  graph: SkillGraphStore,
  schoolId: string,
): Promise<SkillGraphVersion[]> {
  return graph.listSignedOffVersions(await curriculumOf(graph, schoolId));
}

/**
 * The signed-off graph for a scope, or undefined when the school has none for
 * that subject/year. Undefined is a real answer — "no Science curriculum is
 * signed off yet" — never a reason to substitute another subject's graph.
 */
export async function graphForScope(
  graph: SkillGraphStore,
  schoolId: string,
  scope?: GraphScope,
): Promise<SkillGraphVersion | undefined> {
  return graph.latestSignedOffVersion(await curriculumOf(graph, schoolId), scope);
}

/** The scope a class implies: what it teaches, to which year. */
export function scopeOfClass(klass: Pick<ClassRoom, "subject" | "yearGroup">): GraphScope {
  const year = Number(klass.yearGroup);
  return {
    subject: klass.subject ?? null,
    yearLevel: klass.yearGroup != null && !Number.isNaN(year) ? year : null,
  };
}

/** The graph a class works against. */
export async function graphForClass(
  graph: SkillGraphStore,
  schoolId: string,
  klass: Pick<ClassRoom, "subject" | "yearGroup">,
): Promise<SkillGraphVersion | undefined> {
  return graphForScope(graph, schoolId, scopeOfClass(klass));
}

export interface ScopedNode extends SkillNode {
  versionId: string;
  subject: string | null;
  yearLevel: number | null;
}

/** Every node across every signed-off graph, tagged with the graph it came from. */
export async function allSignedOffNodes(
  graph: SkillGraphStore,
  schoolId: string,
): Promise<ScopedNode[]> {
  const out: ScopedNode[] = [];
  for (const version of await signedOffGraphs(graph, schoolId)) {
    for (const node of await graph.listNodes(version.id)) {
      out.push({ ...node, versionId: version.id, subject: version.subject, yearLevel: version.yearLevel });
    }
  }
  return out;
}

/**
 * The signed-off graph a node belongs to. Node ids are unique across graphs
 * (enforced on import), so this is unambiguous — and it is how anything that
 * walks graph structure from a node must find its version.
 */
export async function graphOfNode(
  graph: SkillGraphStore,
  schoolId: string,
  nodeId: string,
): Promise<SkillGraphVersion | undefined> {
  for (const version of await signedOffGraphs(graph, schoolId)) {
    if (await graph.getNode(version.id, nodeId)) return version;
  }
  return undefined;
}

/**
 * node id → label, across every signed-off graph. Replaces the old
 * "latest graph only" label maps that would print bare ids for any other subject.
 */
export async function nodeLabelIndex(
  graph: SkillGraphStore,
  schoolId: string,
): Promise<Map<string, string>> {
  return new Map((await allSignedOffNodes(graph, schoolId)).map((n) => [n.id, n.label]));
}
