import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { LocalClassifierProvider, type AiCompletionRequest, type AiProvider } from "../src/ports/aiProvider";
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

  it("edge — unapproved content referenced: declines upfront with a fix path, saves nothing", async () => {
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
    // No empty draft is created — the teacher gets an actionable refusal instead.
    expect(res.status).toBe("declined");
    if (res.status !== "declined") throw new Error("unreachable");
    expect(res.message).toMatch(/awaiting approval/i);
    expect(await ctx.assessmentStore.listAssessmentsByTeacher(teacherId)).toHaveLength(0);
    expect(ctx.audit.find((e) => e.action === "assessment.generation.declined")).toHaveLength(1);
  });

  it("edge — approved material later reverted to draft: the decline NAMES the content to fix", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const contentItemId = await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 2 });
    // A re-upload/edit resets governance to draft; the mapping survives.
    const item = (await ctx.contentStore.getContentItem(contentItemId))!;
    await ctx.contentStore.updateContentItem({
      ...item,
      governance: { status: "draft", approvedBy: null, approvedAt: null, publishedAt: null },
    });

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Quiz", nodeId: NODE, count: 2, difficulty: "mixed",
    });
    expect(res.status).toBe("declined");
    if (res.status !== "declined") throw new Error("unreachable");
    expect(res.message).toContain(item.title);
    expect(res.pendingContent).toHaveLength(1);
    expect(res.pendingContent[0]).toMatchObject({ id: contentItemId, status: "draft" });
  });

  it("grounding capacity reports per-node question capacity for the picker", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 3 });
    const capacity = await ctx.assessment.groundingCapacity(schoolId);
    expect(capacity[NODE]).toBe(3);
    // #19 — a subskill inherits the material mapped to the skill above it, which
    // is what lets a school file everything at subject level and still generate.
    expect(capacity["sub-common-denominator"]).toBe(3);
    // Inheritance only ever runs DOWN the tree: a skill in another strand is
    // untouched by material mapped to fractions.
    expect(capacity["skill-interpret-data"]).toBeUndefined();
  });

  it("#19 — material mapped at SUBJECT level grounds every concept beneath it", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, "subj-maths", { sections: 4 });

    const capacity = await ctx.assessment.groundingCapacity(schoolId);
    expect(capacity["skill-interpret-data"]).toBe(4);
    expect(capacity[NODE]).toBe(4);

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Data displays", nodeId: "skill-interpret-data", count: 2, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    // The teacher is told the questions came from material filed more broadly
    // than the concept they asked about — that's theirs to know before publishing.
    expect(res.flags).toContain("grounded_at_broader_level");
  });

  it("#19 — a concept-level mapping wins over the subject-level one, and isn't flagged", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, "subj-maths", { sections: 4 });
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 1 });

    // Refining one item down to the concept is what narrows it: capacity drops
    // to that item alone rather than everything filed under Mathematics.
    const capacity = await ctx.assessment.groundingCapacity(schoolId);
    expect(capacity[NODE]).toBe(1);
    expect(capacity["skill-interpret-data"]).toBe(4); // untouched by the refinement

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Adding fractions", nodeId: NODE, count: 1, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.flags).not.toContain("grounded_at_broader_level");
  });

  it("#19 — a multi-concept request grounds in the union, counting shared material once", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    await makeMappedContent(ctx, schoolId, teacherId, NODE, { sections: 2 });
    await makeMappedContent(ctx, schoolId, teacherId, "skill-interpret-data", { sections: 3 });

    const res = await ctx.assessment.generate(schoolId, teacherId, {
      title: "Term review", nodeId: NODE, nodeIds: [NODE, "skill-interpret-data"],
      count: 10, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(5); // 2 + 3, neither item double-counted
  });

  it("questions come from sections RELEVANT to the concept — and the AI is told what skill to assess", async () => {
    // The production failure: a syllabus whose first sections are copyright and
    // licensing generated questions quizzing the copyright notice. Two causes,
    // both pinned here: units were consumed in page order, and the generation
    // input never named the skill being assessed.
    const seen: AiCompletionRequest[] = [];
    const capturing: AiProvider = {
      describe: () => ({ kind: "local", provider: "capturing" }),
      complete: (req) => { seen.push(req); return new LocalClassifierProvider().complete(req); },
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: capturing });
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "rank@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const text = [
      "# Copyright\nAll rights reserved. Copies found elsewhere are not authorised.",
      "# Contents\nA table listing the sections of this document.",
      "# Working with fractions\nAdd and subtract fractions by finding a common denominator first.",
    ].join("\n");
    const up = await ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "Syllabus-like pack", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("qrank"), source: { text },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
    await ctx.ingestion.ingest(item.currentVersionId, teacher.user.id);
    await ctx.classification.classify(up.contentItemId, teacher.user.id);
    await ctx.classification.approveClassification(up.contentItemId, teacher.user.id);
    await ctx.content.attestRights(up.contentItemId, teacher.user.id);
    await ctx.content.approveContent(up.contentItemId, teacher.user.id);
    // Filed at SUBJECT level, the #19 default — grounding reaches the concept via ancestry.
    await ctx.mapping.mapContent(up.contentItemId, ["subj-maths"], { difficulty: "developing" });

    const res = await ctx.assessment.generate(school.id, teacher.user.id, {
      title: "Fractions check", nodeId: NODE, count: 1, difficulty: "mixed",
    });
    expect(res.status).toBe("generated");

    const call = seen.find((r) => r.purpose === "assessment.generate")!;
    const input = call.input as { chunk: string; skill: string };
    // The one question drew on the fractions section, not the front matter…
    expect(input.chunk).toContain("common denominator");
    expect(input.chunk).not.toContain("Copyright");
    // …and the model was told what the question is FOR.
    expect(input.skill).toBe("Add and subtract fractions");
  });

  it('a section the model judges unable to support the skill ({"unsupported": true}) is skipped, not fatal', async () => {
    // The model may now honestly answer "this extract can't support a question
    // on that skill" (a copyright notice, a table of contents). That answer
    // must move generation on to the next section — it used to surface as a
    // JSON parse error that killed the whole run.
    const local = new LocalClassifierProvider();
    const skipping: AiProvider = {
      describe: () => ({ kind: "local", provider: "skipping" }),
      complete: (req) => {
        if (req.purpose === "assessment.generate") {
          const chunk = (req.input as { chunk: string }).chunk;
          if (chunk.includes("Copyright")) return Promise.resolve({ text: '{"unsupported": true}' });
          // A truncated/garbled reply for the middle section — must skip that
          // section, never kill the run (it used to fail the whole generation).
          if (chunk.includes("Garbled")) return Promise.resolve({ text: '{"prompt": "cut off mid-' });
        }
        return local.complete(req);
      },
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: skipping });
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "skip@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    const text = [
      "# Copyright fractions notice\nAdd fractions of rights reserved.", // ranks high but is unsupported
      "# Garbled fractions section\nAdd and subtract fractions here too.", // provider reply is truncated JSON
      "# Adding fractions properly\nAdd and subtract fractions with a common denominator.",
    ].join("\n");
    const up = await ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "Two-part pack", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("skip"), source: { text },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
    await ctx.ingestion.ingest(item.currentVersionId, teacher.user.id);
    await ctx.classification.classify(up.contentItemId, teacher.user.id);
    await ctx.classification.approveClassification(up.contentItemId, teacher.user.id);
    await ctx.content.attestRights(up.contentItemId, teacher.user.id);
    await ctx.content.approveContent(up.contentItemId, teacher.user.id);
    await ctx.mapping.mapContent(up.contentItemId, [NODE], { difficulty: "developing" });

    const res = await ctx.assessment.generate(school.id, teacher.user.id, {
      title: "Fractions", nodeId: NODE, count: 2, difficulty: "mixed",
    });
    // One section refused, one garbled, one delivered: a 1-question draft with
    // an honest shortfall — never a dead "failed" run, never a question forced
    // from the unsupported section.
    expect(res.status).toBe("generated");
    if (res.status !== "generated") throw new Error("unreachable");
    expect(res.questionCount).toBe(1);
    expect(res.shortfall).toMatchObject({ requested: 2, generated: 1 });
    const qs = await ctx.assessmentStore.listQuestionsByAssessment(res.assessmentId);
    expect(qs).toHaveLength(1);
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
