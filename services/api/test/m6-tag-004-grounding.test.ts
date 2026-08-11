import { describe, expect, it } from "vitest";
import { makeMappedContent, setupAgentSchool } from "./helpers";

/**
 * Milestone 6 — FR-TAG-004: every Agent suggestion shows the approved source
 * content it was grounded in — all of it, and retained even if later archived.
 */
describe("M6 FR-TAG-004 — grounding sources", () => {
  it("happy path — a suggestion shows exactly which approved content it was grounded in", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    const contentId = await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Algebra basics", sections: 1 });

    const result = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeId, topic: "Algebra" });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;

    const view = await ctx.agent.viewSuggestion(result.suggestion.id);
    expect(view.grounding.map((g) => g.contentItemId)).toContain(contentId);
    expect(view.grounding.map((g) => g.title)).toContain("Algebra basics");
  });

  it("edge — multiple sources: all of them are listed, not just one", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    const a = await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Doc A", sections: 1 });
    const b = await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Doc B", sections: 1 });
    const c = await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Doc C", sections: 1 });

    const result = await ctx.agent.draftUnitSequence(teacherId, schoolId, { nodeId, term: "Term 1" });
    if (result.status !== "suggested") throw new Error("expected a suggestion");

    const ids = (await ctx.agent.viewSuggestion(result.suggestion.id)).grounding.map((g) => g.contentItemId).sort();
    expect(ids).toEqual([a, b, c].sort());
  });

  it("edge — source later archived: the suggestion retains a reference (now flagged archived), not a broken link", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    const contentId = await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Soon-archived doc", sections: 1 });

    const result = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeId, topic: "Topic" });
    if (result.status !== "suggested") throw new Error("expected a suggestion");

    // Archive the source AFTER the suggestion was made.
    const archived = await ctx.content.archive(contentId, teacherId, { confirm: true });
    expect(archived.archived).toBe(true);

    const view = await ctx.agent.viewSuggestion(result.suggestion.id);
    const ref = view.grounding.find((g) => g.contentItemId === contentId);
    expect(ref).toBeDefined(); // link retained, not silently dropped
    expect(ref!.archived).toBe(true); // and flagged as archived
    expect(ref!.title).toBe("Soon-archived doc"); // snapshot title preserved
  });
});
