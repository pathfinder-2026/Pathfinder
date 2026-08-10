import { describe, expect, it } from "vitest";
import type { MasteryRecord } from "../src/domain/mastery";
import { newId } from "../src/platform/ids";
import { makeApprovedContent, makeMappedContent, makeTeacher, seedActivityClass } from "./helpers";
import { makeHarness } from "./helpers";

/**
 * Milestone 5a — FR-TDB-002: class-level focus-area suggestions. Every suggestion
 * is a draft; nothing is auto-assigned to students.
 */
describe("M5a FR-TDB-002 — class focus areas", () => {
  it("happy path — a weak skill is surfaced with suggested approved material to reteach it", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu");
    // Approved material mapped to the focus skill — the reteach candidate.
    const contentId = await makeMappedContent(ctx, schoolId, teacher.user.id, summary.focusNodeId, { sections: 2 });

    const areas = await ctx.dashboard.classFocusAreas(schoolId, classId);
    const focus = areas.find((a) => a.nodeId === summary.focusNodeId);

    expect(focus).toBeDefined();
    expect(focus!.belowFraction).toBeGreaterThanOrEqual(0.5);
    expect(focus!.contentGap).toBe(false);
    expect(focus!.suggestedContentIds).toContain(contentId);
  });

  it("edge — no suitable material: a focus area with no approved content is flagged as a content gap", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    // Some approved content exists in the school, but NONE mapped to the gap skill.
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu");
    await makeApprovedContent(ctx, schoolId, teacher.user.id);

    const areas = await ctx.dashboard.classFocusAreas(schoolId, classId);
    const gap = areas.find((a) => a.nodeId === summary.contentGapNodeId);

    expect(gap).toBeDefined();
    expect(gap!.contentGap).toBe(true);
    expect(gap!.suggestedContentIds).toHaveLength(0);
  });

  it("edge — dismissed suggestion: doesn't reappear next session, but does if the data worsens again", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu");

    expect((await ctx.dashboard.classFocusAreas(schoolId, classId)).some((a) => a.nodeId === summary.focusNodeId)).toBe(true);

    // The Teacher dismisses it as not relevant.
    await ctx.dashboard.dismissFocusArea(teacher.user.id, schoolId, classId, summary.focusNodeId);

    // Next session — it does NOT reappear identically.
    expect((await ctx.dashboard.classFocusAreas(schoolId, classId)).some((a) => a.nodeId === summary.focusNodeId)).toBe(false);

    // The underlying mastery data significantly worsens (more students now below).
    for (const studentId of summary.studentIds.slice(15)) {
      const rec: MasteryRecord = {
        id: newId(), studentId, schoolId, nodeId: summary.focusNodeId,
        level: "low", score: 0.15, dataPoints: 6, lastActivityAt: ctx.clock.isoNow(), synthetic: true,
      };
      await ctx.activityStore.insertMastery(rec);
    }

    // Now it reappears despite the earlier dismissal.
    expect((await ctx.dashboard.classFocusAreas(schoolId, classId)).some((a) => a.nodeId === summary.focusNodeId)).toBe(true);
  });

  it("edge — auto-assign attempted: blocked by design, requiring an explicit teacher action", async () => {
    const { ctx } = makeHarness();
    const { schoolId, classId, summary } = await seedActivityClass(ctx);
    const teacher = await makeTeacher(ctx, schoolId, "t@springfield.edu");
    const contentId = await makeMappedContent(ctx, schoolId, teacher.user.id, summary.focusNodeId);

    // A future/automated feature with no real Teacher actor is blocked at the platform level.
    await expect(
      ctx.dashboard.assignFocusMaterial("system-agent", schoolId, classId, summary.focusNodeId, contentId),
    ).rejects.toMatchObject({ code: "AUTO_ASSIGN_BLOCKED" });

    // An explicit teacher action succeeds and is audited.
    const assignment = await ctx.dashboard.assignFocusMaterial(teacher.user.id, schoolId, classId, summary.focusNodeId, contentId);
    expect(assignment.teacherId).toBe(teacher.user.id);
    expect(ctx.audit.find((e) => e.action === "dashboard.focus.assigned")).toHaveLength(1);
  });
});
