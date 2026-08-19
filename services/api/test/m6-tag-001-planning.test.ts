import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { LocalClassifierProvider, type AiCompletionRequest, type AiProvider } from "../src/ports/aiProvider";
import { makeMappedContent, makeTeacher, seedSchoolWithAdmin, setupAgentSchool, setupSignedGraph, testHash } from "./helpers";

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

  it("#19 — a draft spans several concepts and is grounded by SUBJECT-level material", async () => {
    const { ctx, schoolId, teacherId, nodeId, emptyNodeId } = await setupAgentSchool();
    // Filed the way a teacher actually files it: against the subject, not a concept.
    await makeMappedContent(ctx, schoolId, teacherId, "subj-maths", { title: "Year 8 maths textbook", sections: 2 });

    const result = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeIds: [nodeId, emptyNodeId] });

    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;
    // One source covering both concepts is one reference, not two.
    expect(result.suggestion.grounding).toHaveLength(1);
    expect(result.suggestion.content).toContain("Year 8 maths textbook");
  });

  it("the AI receives the sources' ACTUAL TEXT, not just their titles", async () => {
    // In production the remote model was refusing lesson drafts — correctly,
    // because the prompt forbids inventing beyond the supplied sources and the
    // service supplied only TITLES. The local provider's canned template kept
    // every test green. This pins the contract: real text reaches the AI.
    const seen: AiCompletionRequest[] = [];
    const capturing: AiProvider = {
      describe: () => ({ kind: "local", provider: "capturing" }),
      complete: (req) => { seen.push(req); return new LocalClassifierProvider().complete(req); },
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: capturing });
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "agent-text@riverbank.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, "skill-add-fractions", { title: "Fractions unit pack", sections: 2 });

    const result = await ctx.agent.draftLessonPlan(teacher.user.id, school.id, { nodeId: "skill-add-fractions" });
    expect(result.status).toBe("suggested");

    const call = seen.find((r) => r.purpose === "agent.generate")!;
    expect(call).toBeDefined();
    const sources = (call.input as { sources: { title: string; text: string }[] }).sources;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.title).toBe("Fractions unit pack");
    // The item's real section prose — the thing that was missing.
    expect(sources[0]!.text).toContain("Explain the idea clearly in prose.");
    expect(sources[0]!.text).toContain("Topic A");
  });

  it("sections RELEVANT to the topic are sent first — front matter can't eat the text budget", async () => {
    // The production failure shape: a big syllabus whose early sections are
    // copyright/contents. Page order spent the whole budget before any subject
    // content; the model then refused for want of anything to ground in.
    const seen: AiCompletionRequest[] = [];
    const capturing: AiProvider = {
      describe: () => ({ kind: "local", provider: "capturing" }),
      complete: (req) => { seen.push(req); return new LocalClassifierProvider().complete(req); },
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: capturing });
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "agent-rank@riverbank.edu");
    await setupSignedGraph(ctx, school.id);
    const text = [
      "# Copyright\nAll rights reserved by the issuing authority.",
      "# Contents\nA table listing every following section.",
      "# Working with fractions\nAdd and subtract fractions by finding a common denominator first.",
    ].join("\n");
    const up = await ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "Syllabus-like pack", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("rank"), source: { text },
    });
    if (up.status !== "accepted") throw new Error("unreachable");
    const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
    await ctx.ingestion.ingest(item.currentVersionId, teacher.user.id);
    await ctx.classification.classify(up.contentItemId, teacher.user.id);
    await ctx.classification.approveClassification(up.contentItemId, teacher.user.id);
    await ctx.content.attestRights(up.contentItemId, teacher.user.id);
    await ctx.content.approveContent(up.contentItemId, teacher.user.id);
    await ctx.mapping.mapContent(up.contentItemId, ["skill-add-fractions"], { difficulty: "developing" });

    // The node's label is "Add and subtract fractions" — the third section
    // matches it; the front matter doesn't.
    await ctx.agent.draftLessonPlan(teacher.user.id, school.id, { nodeId: "skill-add-fractions" });
    const call = seen.find((r) => r.purpose === "agent.generate")!;
    const source = (call.input as { sources: { text: string }[] }).sources[0]!;
    const relevant = source.text.indexOf("Working with fractions");
    const frontMatter = source.text.indexOf("Copyright");
    expect(relevant).toBeGreaterThanOrEqual(0);
    // Relevance beats page order: the fractions section precedes the front matter.
    expect(frontMatter === -1 || relevant < frontMatter).toBe(true);
  });

  it("differentiation drafts receive the class's REAL per-concept mastery aggregates — no student names", async () => {
    // "Differentiated" used to mean a boolean: the AI was told data exists but
    // never shown any, so every plan was a generic three-tier template.
    const seen: AiCompletionRequest[] = [];
    const capturing: AiProvider = {
      describe: () => ({ kind: "local", provider: "capturing" }),
      complete: (req) => { seen.push(req); return new LocalClassifierProvider().complete(req); },
    };
    const ctx = buildContext({ clock: new FixedClock(), aiProvider: capturing });
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "adaptive@riverbank.edu");
    await setupSignedGraph(ctx, school.id);
    await makeMappedContent(ctx, school.id, teacher.user.id, "skill-add-fractions", { title: "Fractions pack", sections: 2 });
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
    const scores = [0.2, 0.4, 0.7, 0.95]; // 2 below, 1 at, 1 above mastery (threshold 0.67)
    for (let i = 0; i < scores.length; i++) {
      const student = await ctx.accounts.createAccount({
        schoolId: school.id, role: "student", email: `ad-stu-${i}@riverbank.edu`, firstName: "S", lastName: `T${i}`, classId: klass.id,
      });
      await ctx.activityStore.insertMastery({
        id: `m-${i}`, studentId: student.user.id, schoolId: school.id, nodeId: "skill-add-fractions",
        level: "developing", score: scores[i]!, dataPoints: 1, lastActivityAt: new FixedClock().isoNow(), history: [],
        assistedScore: null, synthetic: false,
      });
    }

    const result = await ctx.agent.draftDifferentiation(teacher.user.id, school.id, { nodeId: "skill-add-fractions", classId: klass.id });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") return;
    expect(result.suggestion.personalised).toBe(true);

    const call = seen.find((r) => r.purpose === "agent.generate")!;
    const perf = (call.input as { classPerformance: { concept: string; below: number; at: number; above: number }[] }).classPerformance;
    expect(perf).toEqual([{ concept: "Add and subtract fractions", below: 2, at: 1, above: 1 }]);
    // Aggregates only — the AI input never carries a student name or id.
    expect(JSON.stringify(call.input)).not.toMatch(/ad-stu-|"studentId"/);
    // And the local provider's draft actually tiers to the data.
    expect(result.suggestion.content).toContain("2 below / 1 at / 1 above");
  });

  it("a dead draft can be deleted — own, unsent drafts only", async () => {
    const { ctx, schoolId, teacherId, nodeId } = await setupAgentSchool();
    await makeMappedContent(ctx, schoolId, teacherId, nodeId, { title: "Pack", sections: 1 });
    const result = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeId });
    if (result.status !== "suggested") throw new Error("unreachable");

    await ctx.agent.deleteDraft(teacherId, result.suggestion.id);
    expect(await ctx.agentStore.getSuggestion(result.suggestion.id)).toBeUndefined();
    expect(ctx.audit.find((e) => e.action === "agent.draft.deleted")).toHaveLength(1);

    // A colleague cannot delete someone else's draft.
    const other = await ctx.agent.draftLessonPlan(teacherId, schoolId, { nodeId });
    if (other.status !== "suggested") throw new Error("unreachable");
    const rival = await makeTeacher(ctx, schoolId, "rival@riverbank.edu");
    await expect(ctx.agent.deleteDraft(rival.user.id, other.suggestion.id)).rejects.toThrow();
    expect(await ctx.agentStore.getSuggestion(other.suggestion.id)).toBeDefined();
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
