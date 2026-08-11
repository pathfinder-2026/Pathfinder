import { describe, expect, it } from "vitest";
import { makeMappedContent, setupAgentSchool } from "./helpers";

/**
 * Milestone 6 — FR-TAG-001 / FR-TAG-002: curriculum/unit-sequence design, lesson
 * planning and differentiated activities, grounded in approved content.
 */
describe("M6 FR-TAG-001/002 — planning", () => {
  it("happy path — a unit sequence is drafted, grounded in the school's approved curriculum content", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Fractions unit pack", sections: 2 });

    const result = await ctx.agent.draftUnitSequence(teacherId, schoolId, { nodeId, term: "Term 1" });

    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;
    expect(result.suggestion.grounding.length).toBeGreaterThan(0); // FR-TAG-004: never ungrounded
    expect(result.suggestion.content).toContain("Fractions unit pack");
    // Every AI call goes through the choke point and is audited (Decision 2/3).
    expect(ctx.audit.find((e) => e.action === "ai.call").length).toBeGreaterThan(0);
  });

  it("edge — no grounding content: the agent declines honestly instead of inventing an ungrounded plan", async () => {
    const { ctx, schoolId, teacherId, emptyNodeId } = await setupAgentSchool();
    // No content mapped to emptyNodeId at all.
    const result = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeId: emptyNodeId, topic: "Long division" });

    expect(result.status).toBe("declined");
    if (result.status !== "declined") return;
    expect(result.reason).toBe("no_grounding_content");
    expect(result.message).toMatch(/won.t invent|no approved content/i);
    expect(ctx.audit.find((e) => e.action === "agent.declined")).toHaveLength(1);
  });

  it("edge — no capability data yet: a general differentiation plan, noted as not yet personalised", async () => {
    const { ctx, schoolId, campusId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Content", sections: 1 });
    // A brand-new class with no mastery/capability data.
    const klass = await ctx.schools.createClass(schoolId, campusId, "New 8C");

    const result = await ctx.agent.draftDifferentiation(teacherId, schoolId, { nodeId, classId: klass.id });

    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;
    expect(result.suggestion.personalised).toBe(false);
    expect(result.suggestion.personalisationNote).toMatch(/not yet personalised/i);
    expect(result.suggestion.grounding.length).toBeGreaterThan(0);
  });
});
