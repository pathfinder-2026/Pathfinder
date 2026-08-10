import { describe, expect, it } from "vitest";
import { HIERARCHY } from "../src/domain/skillGraph";
import {
  makeApprovedContent,
  makeHarness,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";

/** FR-SKG-001 — Map content through subject→…→prerequisite→difficulty. */
describe("FR-SKG-001 map content through the skill graph", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    setupSignedGraph(ctx, school.id);
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);
    return { ctx, schoolId: school.id, itemId };
  }

  it("happy path: content links through the correct chain, with difficulty as an item attribute", async () => {
    const { ctx, itemId } = await setup();
    const [mapping] = ctx.mapping.mapContent(itemId, ["skill-add-fractions"], { difficulty: "developing" });
    const [view] = ctx.mapping.mappingViews(itemId);

    // Full chain subject → strand → outcome → topic → concept → skill.
    expect(view?.chain.map((n) => n.type)).toEqual([
      "subject", "strand", "outcome", "topic", "concept", "skill",
    ]);
    expect(view?.chain[0]?.label).toBe("Mathematics");
    expect(view?.chain.at(-1)?.id).toBe("skill-add-fractions");
    // Difficulty is an item attribute, and never a node type.
    expect(mapping?.difficulty).toBe("developing");
    expect(HIERARCHY).not.toContain("difficulty");
  });

  it("edge — content spanning multiple skills maps to multiple nodes", async () => {
    const { ctx, itemId } = await setup();
    const mappings = ctx.mapping.mapContent(itemId, ["skill-add-fractions", "skill-convert-fdp"]);
    expect(mappings).toHaveLength(2);
    expect(ctx.mapping.mappingViews(itemId).map((v) => v.mapping.nodeId).sort()).toEqual(
      ["skill-add-fractions", "skill-convert-fdp"],
    );
  });

  it("edge — a skill with no defined prerequisite is flagged (mapping still proceeds)", async () => {
    const { ctx, itemId } = await setup();
    // skill-interpret-data intentionally has no prerequisite in the seed.
    const [mapping] = ctx.mapping.mapContent(itemId, ["skill-interpret-data"]);
    expect(mapping?.flags).toContain("missing_prerequisite");
    // A skill that DOES have prerequisites is not flagged.
    const [ok] = ctx.mapping.mapContent(itemId, ["skill-solve-linear"]);
    expect(ok?.flags).not.toContain("missing_prerequisite");
  });
});
