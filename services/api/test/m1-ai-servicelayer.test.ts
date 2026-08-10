import { describe, expect, it } from "vitest";
import { AiServiceLayer } from "../src/platform/ai/aiServiceLayer";
import { AuditRecorder } from "../src/platform/audit/auditLog";
import { FixedClock } from "../src/platform/clock";
import { LocalClassifierProvider } from "../src/ports/aiProvider";
import { makeHarness, makeTeacher, seedSchoolWithAdmin, testHash } from "./helpers";

/**
 * Milestone 1: the AI service layer is operational via a provider, every LLM
 * call goes through it, and every call writes an audit entry (Decision 3). No
 * student-data prompt may reach an offshore or training-enabled endpoint.
 */
describe("M1 AI service layer", () => {
  it("classification runs through the layer and writes an ai.call audit entry", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    const up = await ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "W", fileType: "pdf", sizeBytes: 1000, contentHash: testHash("ai"), source: { text: "# Algebra\n2x+3=11" },
    });
    if (up.status !== "accepted") throw new Error("unreachable");

    expect(ctx.ai.isOperational()).toBe(true);
    await ctx.classification.classify(up.contentItemId, teacher.user.id);

    const aiCalls = ctx.audit.find((e) => e.action === "ai.call");
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]?.metadata).toMatchObject({
      purpose: "content.classify",
      providerKind: "local",
      containsStudentData: true,
    });
  });

  it("a bound compliant provider is operational; every run appends an audit entry", async () => {
    const audit = new AuditRecorder(new FixedClock());
    const ai = new AiServiceLayer(new LocalClassifierProvider(), audit);
    expect(ai.isOperational()).toBe(true);
    await ai.run({ purpose: "content.classify", prompt: "x", input: { text: "algebra" }, containsStudentData: true });
    await ai.run({ purpose: "content.classify", prompt: "y", input: { text: "geometry" }, containsStudentData: true });
    expect(audit.find((e) => e.action === "ai.call")).toHaveLength(2);
  });

  it("refuses an offshore remote provider (no student data leaves the AU region)", () => {
    const audit = new AuditRecorder(new FixedClock());
    const offshore = {
      describe: () => ({ kind: "remote" as const, provider: "x", region: "us-east-1", zeroRetention: true, noTraining: true }),
      complete: async () => ({ text: "{}" }),
    };
    expect(() => new AiServiceLayer(offshore, audit)).toThrow(/not an approved AU region/);
  });
});
