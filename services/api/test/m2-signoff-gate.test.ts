import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/errors";
import { makeApprovedContent, makeHarness, makeTeacher, readSeedGraph, seedSchoolWithAdmin } from "./helpers";

/**
 * Foundational Decision 4 gate — content may NOT be mapped against a graph that
 * has not been signed off by a curriculum expert. Sign-off is an explicit,
 * audited governance action; the program never self-certifies.
 */
describe("M2 sign-off gate", () => {
  it("blocks mapping against an unsigned (draft) graph, and allows it after sign-off", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);

    const version = await ctx.skillGraph.importGraph(readSeedGraph()); // draft, unsigned
    await ctx.mapping.configureCurriculum(school.id, "NSW");

    // Gate: mapping is refused while the graph is unsigned.
    await expect(ctx.mapping.mapContent(itemId, ["skill-add-fractions"])).rejects.toThrow(/unsigned graph/);

    // A curriculum expert signs it off (a human governance action).
    await ctx.skillGraph.signOff(version.id, "dr-expert");

    // Now mapping proceeds.
    const mappings = await ctx.mapping.mapContent(itemId, ["skill-add-fractions"]);
    expect(mappings).toHaveLength(1);
  });

  it("sign-off requires the reviewing expert's id and is audited", async () => {
    const { ctx } = makeHarness();
    const version = await ctx.skillGraph.importGraph(readSeedGraph());
    await expect(ctx.skillGraph.signOff(version.id, "")).rejects.toThrow(ValidationError);

    await ctx.skillGraph.signOff(version.id, "dr-expert");
    expect((await ctx.skillGraph.getVersion(version.id))?.status).toBe("signed_off");
    const audit = ctx.audit.find((e) => e.action === "skillgraph.signed_off");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe("dr-expert");
  });

  it("the shipped seed is unsigned until a human signs it off", () => {
    // The committed build input must not claim sign-off.
    expect((readSeedGraph()._meta as { signedOff?: boolean }).signedOff).toBe(false);
  });
});
