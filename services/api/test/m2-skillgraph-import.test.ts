import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/errors";
import { HIERARCHY, findPrerequisiteCycle } from "../src/domain/skillGraph";
import { makeHarness, readSeedGraph } from "./helpers";

/**
 * Foundational Decision 4 — the prerequisite graph is validated acyclic on
 * import and on every structural edit; difficulty is never a node.
 */
describe("M2 skill-graph import & acyclicity", () => {
  it("imports the AI-drafted NSW seed as a DRAFT version and validates it acyclic", () => {
    const { ctx } = makeHarness();
    const version = ctx.skillGraph.importGraph(readSeedGraph());
    expect(version.status).toBe("draft"); // never auto-signed
    expect(version.curriculum).toBe("NSW");
    const nodes = ctx.skillGraphStore.listNodes(version.id);
    expect(nodes.length).toBeGreaterThan(20);
    expect(findPrerequisiteCycle(ctx.skillGraphStore.listEdges(version.id)).acyclic).toBe(true);
  });

  it("difficulty can never be a node type", () => {
    expect(HIERARCHY).not.toContain("difficulty");
    const { ctx } = makeHarness();
    const bad = {
      nodes: [{ id: "d1", type: "difficulty", label: "Hard", parentId: null, curriculum: "NSW" }],
      prerequisites: [],
    };
    expect(() => ctx.skillGraph.importGraph(bad as never)).toThrow(ValidationError);
  });

  it("rejects a cyclic prerequisite graph on import", () => {
    const { ctx } = makeHarness();
    const cyclic = {
      nodes: [
        { id: "a", type: "skill", label: "A", parentId: null, curriculum: "NSW" },
        { id: "b", type: "skill", label: "B", parentId: null, curriculum: "NSW" },
        { id: "c", type: "skill", label: "C", parentId: null, curriculum: "NSW" },
      ],
      prerequisites: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" }, // cycle
      ],
    };
    expect(() => ctx.skillGraph.importGraph(cyclic as never)).toThrow(/not acyclic/);
  });

  it("re-validates acyclicity on a structural edit (rejects a cycle-creating edge)", () => {
    const { ctx } = makeHarness();
    const version = ctx.skillGraph.importGraph(readSeedGraph());
    // add-fractions -> simplify-fractions would reverse an existing chain → cycle.
    expect(() =>
      ctx.skillGraph.addPrerequisite(version.id, { from: "skill-add-fractions", to: "skill-simplify-fractions" }),
    ).toThrow(/cycle/);
    // A safe edge is accepted.
    expect(() =>
      ctx.skillGraph.addPrerequisite(version.id, { from: "skill-simplify-fractions", to: "skill-area-triangle" }),
    ).not.toThrow();
  });
});
