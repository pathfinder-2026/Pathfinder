import { describe, expect, it } from "vitest";
import { scoreGraphMatch as scopeGraph } from "../src/domain/skillGraph";
import {
  makeHarness,
  makeMappedContent,
  makeTeacher,
  readScienceSeedGraph,
  readSeedGraph,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";
import {
  allSignedOffNodes,
  graphForClass,
  graphOfNode,
  nodeLabelIndex,
  signedOffGraphs,
} from "../src/services/curriculumScope";

const MATHS_NODE = "skill-add-fractions";
const SCIENCE_NODE = "sci-skill-force-diagrams";

/**
 * One signed-off skill graph per subject × year level. Before this, a school had
 * exactly one graph (NSW Year 8 Mathematics), so every teacher of every subject
 * picked from the same maths list and an uploaded Science syllabus had nothing
 * to map onto.
 */
describe("Multi-graph curriculum — a signed-off graph per subject × year", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    // Graph 1: the existing Year 8 Mathematics seed.
    await setupSignedGraph(ctx, school.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  async function addScience(ctx: Awaited<ReturnType<typeof setup>>["ctx"], expertId = "expert-2") {
    const version = await ctx.skillGraph.importGraph(readScienceSeedGraph(), expertId);
    await ctx.skillGraph.signOff(version.id, expertId);
    return version;
  }

  it("imports a second subject's graph, scoped and unsigned until a human signs it off", async () => {
    const { ctx, schoolId } = await setup();
    const version = await ctx.skillGraph.importGraph(readScienceSeedGraph(), "expert-2");

    // Scope comes from the source metadata; sign-off is never self-certified.
    expect(version.subject).toBe("Science");
    expect(version.yearLevel).toBe(7);
    expect(version.status).toBe("draft");
    // Unsigned, so it is not yet available to teach against.
    expect(await signedOffGraphs(ctx.skillGraphStore, schoolId)).toHaveLength(1);

    await ctx.skillGraph.signOff(version.id, "expert-2");
    const graphs = await signedOffGraphs(ctx.skillGraphStore, schoolId);
    expect(graphs).toHaveLength(2);
    expect(graphs.map((g) => g.subject).sort()).toEqual(["Mathematics", "Science"]);
  });

  it("resolves the graph a class teaches — and refuses to answer from another subject's", async () => {
    const { ctx, schoolId } = await setup();
    await addScience(ctx);

    const maths = await graphForClass(ctx.skillGraphStore, schoolId, { subject: "Mathematics", yearGroup: "8" });
    const science = await graphForClass(ctx.skillGraphStore, schoolId, { subject: "Science", yearGroup: "7" });
    expect(maths?.subject).toBe("Mathematics");
    expect(science?.subject).toBe("Science");

    // A subject with no signed-off graph is an honest "none" — NEVER the maths
    // graph, which would silently offer maths skills to a History teacher.
    const history = await graphForClass(ctx.skillGraphStore, schoolId, { subject: "History", yearGroup: "7" });
    expect(history).toBeUndefined();

    // Wrong year for a subject that exists is equally honest.
    const scienceY9 = await graphForClass(ctx.skillGraphStore, schoolId, { subject: "Science", yearGroup: "9" });
    expect(scienceY9).toBeUndefined();
  });

  it("rejects colliding node ids ACROSS subjects, but allows a new version of the same graph", async () => {
    const { ctx } = await setup();

    // A new version of the SAME curriculum reuses ids by design — that is what
    // versioning means, and the ids still denote the same skills.
    await expect(ctx.skillGraph.importGraph(readSeedGraph(), "expert-1")).resolves.toBeDefined();

    // The same nodes filed under a DIFFERENT subject is refused: mastery and
    // mappings reference bare ids, so it would merge two skills' evidence.
    await expect(
      ctx.skillGraph.importGraph(readSeedGraph(), "expert-2", { subject: "Science", yearLevel: 7 }),
    ).rejects.toThrow(/unique across curriculum graphs/i);
  });

  it("maps content into the right subject's graph, and grounds generation from it", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const science = await addScience(ctx);

    // Mapping resolves the node's OWN graph rather than "the latest" one.
    const contentId = await makeMappedContent(ctx, schoolId, teacherId, SCIENCE_NODE, { sections: 2, title: "Forces pack" });
    const mappings = await ctx.skillGraphStore.listMappingsByContent(contentId);
    expect(mappings[0]!.graphVersionId).toBe(science.id);
    expect(await graphOfNode(ctx.skillGraphStore, schoolId, SCIENCE_NODE)).toMatchObject({ subject: "Science" });
    expect(await graphOfNode(ctx.skillGraphStore, schoolId, MATHS_NODE)).toMatchObject({ subject: "Mathematics" });

    // Generation works against the science skill using science material.
    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Forces check", nodeId: SCIENCE_NODE, count: 2, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(2);

    // Capacity is reported per node across both graphs.
    const capacity = await ctx.assessment.groundingCapacity(schoolId);
    expect(capacity[SCIENCE_NODE]).toBe(2);
    expect(capacity[MATHS_NODE]).toBeUndefined(); // nothing mapped there yet
  });

  it("labels and node listings span every signed-off graph, not just the newest", async () => {
    const { ctx, schoolId } = await setup();
    await addScience(ctx);

    const labels = await nodeLabelIndex(ctx.skillGraphStore, schoolId);
    // The regression this guards: a single-graph label map printed raw node ids
    // for every other subject (reports, parent summaries, the heatmap).
    expect(labels.get(SCIENCE_NODE)).toBe("Draw and interpret force diagrams");
    expect(labels.get(MATHS_NODE)).toBe("Add and subtract fractions");

    const nodes = await allSignedOffNodes(ctx.skillGraphStore, schoolId);
    expect(nodes.find((n) => n.id === SCIENCE_NODE)).toMatchObject({ subject: "Science", yearLevel: 7 });
    expect(nodes.some((n) => n.id === MATHS_NODE)).toBe(true);
  });

  it("scope matching prefers an exact subject+year graph over a broader one", () => {
    const base = {
      id: "v", name: "n", curriculum: "NSW", version: "1", status: "signed_off" as const,
      signedOffBy: "x", signedOffAt: null, createdAt: "2026-01-01T00:00:00.000Z",
    };
    const exact = { ...base, subject: "Science", yearLevel: 7 };
    const anyYear = { ...base, subject: "Science", yearLevel: null };
    const otherSubject = { ...base, subject: "Mathematics", yearLevel: 7 };
    const legacy = { ...base, subject: null, yearLevel: null };

    const scope = { subject: "Science", yearLevel: 7 };
    expect(scopeGraph(exact, scope)).toBeGreaterThan(scopeGraph(anyYear, scope));
    expect(scopeGraph(otherSubject, scope)).toBe(-1);
    // An unscoped legacy graph still serves — there is nothing else it could be.
    expect(scopeGraph(legacy, scope)).toBeGreaterThanOrEqual(0);
    // No scope at all accepts anything (every pre-multi-graph caller).
    expect(scopeGraph(otherSubject)).toBe(0);

    // A year WITHOUT a subject must not narrow: matching Year 7 Science to a
    // Year 7 Maths class would silently swap the subject.
    const yearOnly = { yearLevel: 7 };
    expect(scopeGraph(exact, yearOnly)).toBe(0);
    expect(scopeGraph(otherSubject, yearOnly)).toBe(0);
  });
});
