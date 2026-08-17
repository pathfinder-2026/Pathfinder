import { describe, expect, it } from "vitest";
import {
  makeHarness,
  makeMappedContent,
  makeStudents,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
} from "./helpers";
import { newId } from "../src/platform/ids";

const NODE = "skill-add-fractions";
const PREREQ_NODE = "skill-simplify-fractions"; // seed graph edge: PREREQ_NODE -> NODE
const LEAF_NODE = "skill-convert-fdp"; // no outgoing edge in the seed graph — a genuine dead end

/**
 * TCH-19 — individually-tailored assessment generation, bridging AdaptiveEngine's
 * per-student recommendation and the existing Assessment Builder. Reuses
 * generate()'s grounding/decline logic entirely — this only covers the new
 * action -> (node, difficulty, rationale) mapping layer.
 */
describe("AssessmentService.generateTailored", () => {
  async function setup() {
    const { ctx, clock } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const [studentId] = await makeStudents(ctx, school.id, 1);
    await makeMappedContent(ctx, school.id, teacher.user.id, NODE, { sections: 5 });
    await makeMappedContent(ctx, school.id, teacher.user.id, PREREQ_NODE, { sections: 5 });
    await makeMappedContent(ctx, school.id, teacher.user.id, LEAF_NODE, { sections: 5 });
    return { ctx, clock, schoolId: school.id, teacherId: teacher.user.id, studentId: studentId! };
  }

  it("remediation: low mastery -> easy difficulty, same node, rationale connects the two", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: NODE, level: "low",
      score: 0.1, dataPoints: 3, lastActivityAt: clock.isoNow(), synthetic: false,
    });
    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    expect(action.action).toBe("remediation");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: NODE, action: action.action, reason: action.reason,
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    const a = await ctx.assessmentStore.getAssessment(result.assessmentId);
    expect(a?.request.nodeId).toBe(NODE);
    expect(a?.request.difficulty).toBe("easy");
    expect(a?.request.targetStudentId).toBe(studentId);
    expect(a?.request.tailoringRationale).toContain(action.reason);
    expect(a?.request.tailoringRationale).toMatch(/easy/);
  });

  it("extension: strong mastery -> hard difficulty, moves to the next node along the prerequisite edge", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: PREREQ_NODE, level: "secure",
      score: 0.95, dataPoints: 4, lastActivityAt: clock.isoNow(), synthetic: false,
    });
    const action = await ctx.adaptive.nextAction(schoolId, studentId, PREREQ_NODE);
    expect(action.action).toBe("extension");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: PREREQ_NODE, action: action.action, reason: action.reason,
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    const a = await ctx.assessmentStore.getAssessment(result.assessmentId);
    // Moved on to NODE (the edge's "to"), not stuck on PREREQ_NODE.
    expect(a?.request.nodeId).toBe(NODE);
    expect(a?.request.difficulty).toBe("hard");
    expect(a?.request.tailoringRationale).toMatch(/next skill/i);
  });

  it("extension with no mapped follow-on edge: falls back to the same node rather than guessing", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    // LEAF_NODE has no outgoing edge in the seed graph — a genuine dead end.
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: LEAF_NODE, level: "secure",
      score: 0.95, dataPoints: 4, lastActivityAt: clock.isoNow(), synthetic: false,
    });
    const action = await ctx.adaptive.nextAction(schoolId, studentId, LEAF_NODE);
    expect(action.action).toBe("extension");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: LEAF_NODE, action: action.action, reason: action.reason,
    });
    if (result.status !== "generated") throw new Error("expected generated");
    const a = await ctx.assessmentStore.getAssessment(result.assessmentId);
    expect(a?.request.nodeId).toBe(LEAF_NODE); // stayed put — no fabricated follow-on
    expect(a?.request.tailoringRationale).toMatch(/no follow-on skill/i);
  });

  it("hint declines honestly — not an assessment, and nothing is persisted", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    // Conflicting signals (independent weak, assisted strong) -> "hint".
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: NODE, level: "developing",
      score: 0.4, assistedScore: 0.9, dataPoints: 4, lastActivityAt: clock.isoNow(), synthetic: false,
    });
    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    expect(action.action).toBe("hint");

    const before = (await ctx.assessmentStore.listAssessmentsByTeacher(teacherId)).length;
    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: NODE, action: action.action, reason: action.reason,
    });
    expect(result.status).toBe("declined");
    const after = (await ctx.assessmentStore.listAssessmentsByTeacher(teacherId)).length;
    expect(after).toBe(before); // nothing persisted
  });

  it("escalate declines honestly — a teaching decision, not another assessment", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    for (let i = 0; i < 3; i++) {
      await ctx.activityStore.insertMisconception({
        id: newId(), studentId, schoolId, nodeId: NODE,
        misconception: "confuses numerator and denominator", occurrences: 3,
        lastSeenAt: clock.isoNow(), synthetic: false,
      });
    }
    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    expect(action.action).toBe("escalate");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: NODE, action: action.action, reason: action.reason,
    });
    expect(result.status).toBe("declined");
  });

  it("no mastery signal yet -> revision, mixed difficulty, same node", async () => {
    const { ctx, schoolId, teacherId, studentId } = await setup();
    const action = await ctx.adaptive.nextAction(schoolId, studentId, NODE);
    expect(action.action).toBe("revision");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: NODE, action: action.action, reason: action.reason,
    });
    if (result.status !== "generated") throw new Error("expected generated");
    const a = await ctx.assessmentStore.getAssessment(result.assessmentId);
    expect(a?.request.difficulty).toBe("mixed");
    expect(a?.request.nodeId).toBe(NODE);
  });

  it("no approved content mapped to the node -> the same honest shortfall as regular generate(), never a crash", async () => {
    const { ctx, clock, schoolId, teacherId, studentId } = await setup();
    // A real node in the signed-off graph, but nothing was mapped to it — nor to
    // anything above it. Since #19 a descendant of the mapped node inherits its
    // material, so this has to be a skill in a different strand entirely.
    const unmappedNode = "skill-interpret-data";
    await ctx.activityStore.insertMastery({
      id: newId(), studentId, schoolId, nodeId: unmappedNode, level: "low",
      score: 0.1, dataPoints: 1, lastActivityAt: clock.isoNow(), synthetic: false,
    });
    const action = await ctx.adaptive.nextAction(schoolId, studentId, unmappedNode);
    expect(action.action).toBe("remediation");

    const result = await ctx.assessment.generateTailored(schoolId, teacherId, {
      studentId, nodeId: unmappedNode, action: action.action, reason: action.reason,
    });
    // Same honest behaviour as generate() itself: an upfront decline with a fix
    // path — no empty draft saved, never a crash, never invented.
    expect(result.status).toBe("declined");
    if (result.status !== "declined") throw new Error("expected declined");
    expect(result.message).toMatch(/mapped to this skill/i);
  });
});
