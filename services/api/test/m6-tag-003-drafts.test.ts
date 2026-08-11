import { describe, expect, it } from "vitest";
import { makeMappedContent, setupAgentSchool } from "./helpers";

/**
 * Milestone 6 — FR-TAG-003: draft parent communications / feedback (drafts only).
 * Never auto-sent; sensitive behavioural/social references separated and flagged.
 */
describe("M6 FR-TAG-003 — drafts", () => {
  it("happy path — a parent progress summary is a draft the teacher can edit before sending", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Fractions pack", sections: 1 });

    const result = await ctx.agent.draftParentSummary(teacherId, schoolId, { studentId: "stud-1", nodeId });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;
    expect(result.suggestion.sent).toBe(false);

    const edited = await ctx.agent.editDraft(teacherId, result.suggestion.id, "My edited summary for the parent.");
    expect(edited.content).toBe("My edited summary for the parent.");
    expect(edited.sent).toBe(false); // editing never sends
  });

  it("edge — sensitive content: behavioural observations are separated from academic content and flagged", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Fractions pack", sections: 1 });

    const result = await ctx.agent.draftParentSummary(teacherId, schoolId, {
      studentId: "stud-1", nodeId,
      observations: [
        { text: "Strong grasp of equivalent fractions.", category: "academic" },
        { text: "Has been disruptive and withdrawn in class.", category: "behavioural" },
      ],
    });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;

    const s = result.suggestion;
    expect(s.requiresExtraReview).toBe(true);
    expect(s.sensitiveSections).toHaveLength(1);
    expect(s.sensitiveSections[0]!.category).toBe("behavioural");
    expect(s.sensitiveSections[0]!.flaggedForReview).toBe(true);
    // The sensitive note is NOT inlined into the academic body.
    expect(s.content).not.toMatch(/disruptive|withdrawn/i);
  });

  it("edge — draft never sent: it persists and remains accessible later, never auto-sent", async () => {
    const { ctx, clock, schoolId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Fractions pack", sections: 1 });

    const result = await ctx.agent.draftFeedback(teacherId, schoolId, { studentId: "stud-1", nodeId });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;

    // A year passes with no action.
    clock.advanceMs(365 * 24 * 60 * 60 * 1000);

    const still = await ctx.agent.viewSuggestion(result.suggestion.id);
    expect(still).toBeDefined();
    expect(still.sent).toBe(false); // never auto-sent
  });
});
