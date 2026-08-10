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
    const { school } = seedSchoolWithAdmin(ctx);
    const teacher = makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const itemId = await makeApprovedContent(ctx, school.id, teacher.user.id);

    const version = ctx.skillGraph.importGraph(readSeedGraph()); // draft, unsigned
    ctx.mapping.configureCurriculum(school.id, "NSW");

    // Gate: mapping is refused while the graph is unsigned.
    expect(() => ctx.mapping.mapContent(itemId, ["skill-add-fractions"])).toThrow(/unsigned graph/);

    // A curriculum expert signs it off (a human governance action).
    ctx.skillGraph.signOff(version.id, "dr-expert");

    // Now mapping proceeds.
    const mappings = ctx.mapping.mapContent(itemId, ["skill-add-fractions"]);
    expect(mappings).toHaveLength(1);
  });

  it("sign-off requires the reviewing expert's id and is audited", () => {
    const { ctx } = makeHarness();
    const version = ctx.skillGraph.importGraph(readSeedGraph());
    expect(() => ctx.skillGraph.signOff(version.id, "")).toThrow(ValidationError);

    ctx.skillGraph.signOff(version.id, "dr-expert");
    expect(ctx.skillGraph.getVersion(version.id)?.status).toBe("signed_off");
    const audit = ctx.audit.find((e) => e.action === "skillgraph.signed_off");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe("dr-expert");
  });

  it("the shipped seed is unsigned until a human signs it off", () => {
    // The committed build input must not claim sign-off.
    expect((readSeedGraph()._meta as { signedOff?: boolean }).signedOff).toBe(false);
  });
});
