import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { LocalClassifierProvider, type AiProvider } from "../src/ports/aiProvider";
import {
  makeHarness,
  makeMappedContent,
  makeTeacher,
  seedSchoolWithAdmin,
  setupSignedGraph,
  testHash,
} from "./helpers";

const NODE = "skill-add-fractions";

/** FR-ASM-001 — Generate assessments from natural-language requests, approved content only. */
describe("FR-ASM-001 grounded assessment generation", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  // The insufficient-content edge is tested FIRST and explicitly (plan DoD):
  // this is where ungrounded-generation risk shows up first.
  it("edge — insufficient approved content: generates fewer well-grounded questions and says so", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 2 }); // capacity 2

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Fractions quiz", nodeId: NODE, count: 10, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(2); // never fabricates the missing 8
    expect(res.shortfall).toMatchObject({ requested: 10, generated: 2 });
    // Every persisted question is grounded in approved content.
    const qs = await ctx.assessmentStore.listQuestionsByAssessment(res.assessmentId);
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.groundingContentIds.length > 0)).toBe(true);
  });

  it("happy path: a draft is generated using only the approved content", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 5 });

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Adding fractions", nodeId: NODE, count: 5, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(5);
    expect(res.shortfall).toBeNull();
    const a = await ctx.assessmentStore.getAssessment(res.assessmentId);
    expect(a?.status).toBe("draft"); // stays draft (FR-ASM-004)
  });

  it("edge — unapproved content referenced: the generator excludes it and notifies why", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    // Content exists but is only a pending upload (never approved/mapped).
    const up = await ctx.content.uploadOne(schoolId, teacherId, {
      title: "Pending", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("pend"), source: { text: "# Topic A\nprose" },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    await ctx.ingestion.ingest((await ctx.contentStore.getContentItem(up.contentItemId))!.currentVersionId, teacherId);

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Quiz", nodeId: NODE, count: 5, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(0);
    expect(res.flags).toContain("excluded_unapproved_content");
  });

  it("edge (NEW v1.4) — generation fails mid-run: clear failed state, no partial draft, audit-logged", async () => {
    // A provider that classifies fine but fails assessment generation.
    const failing: AiProvider = {
      describe: () => ({ kind: "local", provider: "failing" }),
      complete: (req) =>
        req.purpose === "assessment.generate"
          ? Promise.reject(new Error("AI service timed out"))
          : new LocalClassifierProvider().complete(req),
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: failing });
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, NODE, { sections: 3 });

    const res = await ctx.assessment.generate(school.id, teacher.user.id, {
      title: "Quiz", nodeId: NODE, count: 3, difficulty: "mixed",
    });
    expect(res.status).toBe("failed");
    expect(ctx.audit.find((e) => e.action === "assessment.generation.failed")).toHaveLength(1);
    // No partial draft was saved.
    expect(await ctx.assessmentStore.listAssessmentsByTeacher(teacher.user.id)).toHaveLength(0);
  });
});
