import { ConflictError, NotFoundError } from "../domain/errors";
import {
  ancestorChain,
  findPrerequisiteCycle,
  scopeLabel,
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
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";

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
    /** Drafting a curriculum from a syllabus is the only AI use here. */
    private readonly ai: AiServiceLayer,
  ) {}

  /**
   * Draft a curriculum graph FROM an approved syllabus document (ADR-0035).
   *
   * This is the missing link that left an approved NESA syllabus with nowhere to
   * map: approving a document says "this material is trusted", but only a signed
   * -off GRAPH gives teachers skills to teach against. The draft is built from
   * the document's own extracted text — never from the model's own knowledge of
   * the subject — and lands as a DRAFT that a human must sign off (Decision 4).
   */
  async draftFromSyllabus(
    schoolId: string,
    input: { contentItemId: string; subject: string; yearLevel: number; sections: { heading: string; text: string }[] },
    actorId: string,
  ): Promise<SkillGraphVersion> {
    if (input.sections.length === 0) {
      throw new ValidationError("This document has no extracted text to draft a curriculum from.");
    }
    const completion = await this.ai.run(
      {
        purpose: "curriculum.draft",
        prompt: `Outline the ${input.subject} Year ${input.yearLevel} curriculum from this syllabus.`,
        input: { subject: input.subject, yearLevel: input.yearLevel, sections: boundSections(input.sections) },
        containsStudentData: false,
      },
      actorId,
    );

    const drafted = JSON.parse(completion.text) as { strands?: { label: string; skills?: string[] }[] };
    const source = buildGraphSource(input.subject, input.yearLevel, drafted.strands ?? []);
    if (source.nodes.filter((n) => n.type === "skill").length === 0) {
      throw new ValidationError(
        "No teachable skills could be drawn from this document — it may be a cover page or index rather than the syllabus body.",
      );
    }

    const version = await this.importGraph(source, actorId, { subject: input.subject, yearLevel: input.yearLevel });
    this.audit.append({
      action: "skillgraph.drafted_from_syllabus",
      actorId,
      subjectType: "skill_graph",
      subjectId: version.id,
      metadata: {
        contentItemId: input.contentItemId, subject: input.subject, yearLevel: input.yearLevel,
        strands: (drafted.strands ?? []).length, skills: source.nodes.filter((n) => n.type === "skill").length,
      },
    });
    return version;
  }

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

    const meta = source._meta ?? {};
    const subjectNode = source.nodes.find((n) => n.type === "subject");
    // Year comes from the caller, then explicit metadata, then whatever the
    // graph calls itself ("… Stage 4 (Year 8)" / "NSW Year 8 Mathematics") —
    // curriculum sources state the year in prose far more often than in a field.
    const yearLevel = scope.yearLevel
      ?? numberOrNull(meta.yearLevel)
      ?? yearFromText(String(meta.stage ?? ""))
      ?? yearFromText(String(meta.name ?? ""));
    const subject = scope.subject ?? (meta.subject ? String(meta.subject) : subjectNode?.label ?? null);
    await this.assertNodeIdsUnused(source, { subject, yearLevel });

    const version: SkillGraphVersion = {
      id: newId(),
      name: String(meta.name ?? "Skill Graph"),
      curriculum: String(meta.curriculum ?? source.nodes[0]?.curriculum ?? "NSW"),
      version: String(meta.version ?? "0.1"),
      status: "draft", // NEVER auto-signed — imports unsigned
      signedOffBy: null,
      signedOffAt: null,
      createdAt: this.clock.isoNow(),
      subject,
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
   * Node ids must be unique across graphs of DIFFERENT scope. Mastery records
   * and content mappings reference a bare node id, so a Science graph reusing a
   * Maths id would silently merge two different skills' evidence.
   *
   * Graphs of the SAME subject × year are successive versions of one curriculum
   * — they are *expected* to share ids (that is what versioning means), and the
   * ids still denote the same skill, so they are left alone.
   */
  private async assertNodeIdsUnused(source: SkillGraphSource, scope: GraphScope): Promise<void> {
    const sameScope = (v: SkillGraphVersion) =>
      norm(v.subject) === norm(scope.subject) && (v.yearLevel ?? null) === (scope.yearLevel ?? null);

    const incoming = new Set(source.nodes.map((n) => n.id));
    for (const version of await this.store.listGraphVersions()) {
      if (sameScope(version)) continue;
      const clashes = (await this.store.listNodes(version.id))
        .filter((n) => incoming.has(n.id))
        .map((n) => n.id);
      if (clashes.length > 0) {
        throw new ValidationError(
          `Node ids already used by "${version.name}" (${scopeLabel(version)}): ${clashes.slice(0, 5).join(", ")}${clashes.length > 5 ? ` (+${clashes.length - 5} more)` : ""}. ` +
            "Skill ids must be unique across curriculum graphs, because mastery and content mappings reference them directly.",
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

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Total syllabus characters sent for drafting. */
const DRAFT_INPUT_BUDGET = 60_000;

/**
 * Keep the syllabus text within a sane request size.
 *
 * A real NESA PDF extracts as ONE ~50k-character section (chunking splits on
 * markdown headings, which a PDF has none of), so the whole document arrives as
 * a single blob. Truncating fairly across sections beats sending an unbounded
 * request, and keeps the front matter from crowding out the outcomes.
 */
function boundSections(sections: { heading: string; text: string }[]): { heading: string; text: string }[] {
  if (sections.length === 0) return sections;
  const perSection = Math.max(2_000, Math.floor(DRAFT_INPUT_BUDGET / sections.length));
  return sections.map((s) => ({
    heading: s.heading,
    text: s.text.length > perSection ? `${s.text.slice(0, perSection)}\n…[truncated]` : s.text,
  }));
}

/**
 * Turn a drafted outline into a valid graph source: subject → strand → skill.
 *
 * Node ids are namespaced by subject+year because ids must be unique across
 * every graph in the school — mastery records reference a bare node id, so a
 * collision would merge two different subjects' evidence.
 */
function buildGraphSource(
  subject: string,
  yearLevel: number,
  strands: { label: string; skills?: string[] }[],
): SkillGraphSource {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const ns = `${slug(subject)}-y${yearLevel}`;
  const subjectId = `${ns}-subject`;
  const nodes: SkillGraphSource["nodes"] = [
    { id: subjectId, type: "subject", label: subject, parentId: null, curriculum: "NSW" },
  ];
  const seen = new Set<string>([subjectId]);
  const unique = (base: string) => {
    let id = base;
    for (let i = 2; seen.has(id); i++) id = `${base}-${i}`;
    seen.add(id);
    return id;
  };

  strands.forEach((strand, si) => {
    const label = (strand.label ?? "").trim();
    if (!label) return;
    const strandId = unique(`${ns}-strand-${slug(label) || si}`);
    nodes.push({ id: strandId, type: "strand", label, parentId: subjectId, curriculum: "NSW" });
    for (const skill of strand.skills ?? []) {
      const skillLabel = (skill ?? "").trim();
      if (!skillLabel) continue;
      nodes.push({
        id: unique(`${ns}-skill-${slug(skillLabel)}`),
        type: "skill", label: skillLabel, parentId: strandId, curriculum: "NSW",
        // Foundational: a freshly drafted graph has no prerequisite edges yet, and
        // without this every skill would be flagged "missing prerequisite" on map.
        foundational: true,
      });
    }
  });

  return {
    _meta: {
      name: `${subject} — Year ${yearLevel} (drafted from syllabus)`,
      curriculum: "NSW", version: "0.1", subject, yearLevel,
      status: "draft", signedOff: false,
      reviewerNote:
        "AI-DRAFTED from an approved syllabus document's own text. Not reviewed: a human must check it against the source syllabus and sign it off before any teacher maps content or generates assessments against it.",
    },
    nodes,
    prerequisites: [],
  };
}

/** "Stage 4 (Year 8)" / "NSW Year 8 Mathematics" → 8. */
function yearFromText(text: string): number | null {
  const match = /year\s*(\d{1,2})/i.exec(text);
  const year = match ? Number(match[1]) : NaN;
  return Number.isNaN(year) || year < 1 || year > 13 ? null : year;
}
