import { describe, expect, it } from "vitest";
import { buildRemotePrompt, extractCompletionText, isKnownRemotePurpose } from "../src/platform/ai/remotePrompt";
import { classifyBedrockError } from "../src/adapters/bedrock/bedrockProvider";
import { LocalClassifierProvider } from "../src/ports/aiProvider";

/**
 * Remote-provider plumbing (code-review fixes 1/2/6). BedrockProvider itself
 * stays a thin transport (live invocation is credential-gated, ADR-0013); the
 * prompt assembly, response extraction and error classification it relies on
 * are pure and fully tested here.
 */

describe("buildRemotePrompt — the remote model sees instruction + input + output contract (fix 1)", () => {
  it("serialises the structured input (grounding sources, topic, term) into the prompt", () => {
    const prompt = buildRemotePrompt({
      purpose: "agent.generate",
      prompt: "Draft unit_sequence grounded strictly in the approved sources.",
      input: { kind: "unit_sequence", term: "Term 1", topic: "fractions", sources: ["Fractions pack", "Practice set"] },
      containsStudentData: false,
    });
    expect(prompt).toContain("Draft unit_sequence grounded strictly in the approved sources.");
    expect(prompt).toContain("Fractions pack");
    expect(prompt).toContain("Practice set");
    expect(prompt).toContain("Term 1");
    expect(prompt).toContain("OUTPUT REQUIREMENTS");
    expect(prompt).toMatch(/do not invent material/i);
  });

  it("gives JSON purposes an explicit JSON-only output contract", () => {
    const classify = buildRemotePrompt({ purpose: "content.classify", prompt: "Classify.", input: { text: "algebra" }, containsStudentData: false });
    expect(classify).toMatch(/ONLY a JSON object/);
    expect(classify).toContain('"confidence"');
    const generate = buildRemotePrompt({ purpose: "assessment.generate", prompt: "Generate.", input: { chunk: "x" }, containsStudentData: false });
    expect(generate).toContain('"modelAnswer"');
  });

  it("carries safety guardrails for the tutor and parent-summary purposes", () => {
    expect(buildRemotePrompt({ purpose: "help.hint", prompt: "Hint.", input: {}, containsStudentData: true })).toMatch(/NEVER state or imply the final answer/i);
    expect(buildRemotePrompt({ purpose: "parent.summary", prompt: "Summarise.", input: {}, containsStudentData: true })).toMatch(/never use clinical or diagnostic/i);
  });

  it("refuses an unknown purpose rather than sending an under-specified prompt", () => {
    expect(isKnownRemotePurpose("agent.generate")).toBe(true);
    expect(isKnownRemotePurpose("nope.unknown")).toBe(false);
    expect(() => buildRemotePrompt({ purpose: "nope.unknown", prompt: "x", containsStudentData: false })).toThrow(/Unknown AI purpose/);
  });
});

describe("extractCompletionText — malformed/empty completions raise instead of becoming empty drafts (fixes 2/6)", () => {
  it("passes prose purposes through trimmed", () => {
    expect(extractCompletionText("agent.generate", "  A grounded draft.  ")).toBe("A grounded draft.");
  });

  it("unwraps a fenced JSON object for JSON purposes and returns canonical JSON", () => {
    const fenced = 'Here you go:\n```json\n{"subject": "Mathematics", "confidence": 0.9}\n```';
    expect(JSON.parse(extractCompletionText("content.classify", fenced))).toMatchObject({ subject: "Mathematics" });
    const bare = 'prefix {"prompt": "Q?", "options": null, "modelAnswer": "A", "rubric": null} suffix';
    expect(JSON.parse(extractCompletionText("assessment.generate", bare))).toMatchObject({ modelAnswer: "A" });
  });

  it("raises AI_RESPONSE_MALFORMED on empty or unparseable completions", () => {
    expect(() => extractCompletionText("agent.generate", "")).toThrow(/empty completion/);
    expect(() => extractCompletionText("content.classify", "sorry, I cannot")).toThrowError(
      expect.objectContaining({ code: "AI_RESPONSE_MALFORMED" }),
    );
    expect(() => extractCompletionText("content.classify", "[1,2,3]")).toThrowError(
      expect.objectContaining({ code: "AI_RESPONSE_MALFORMED" }),
    );
  });
});

describe("classifyBedrockError — SDK failures land in the domain error taxonomy (fix 2)", () => {
  it("maps operator problems to AI_PROVIDER_MISCONFIGURED (retrying will not help)", () => {
    for (const name of ["AccessDeniedException", "ResourceNotFoundException", "ValidationException", "ExpiredTokenException"]) {
      const err = classifyBedrockError(Object.assign(new Error("denied"), { name }));
      expect(err).toMatchObject({ code: "AI_PROVIDER_MISCONFIGURED" });
    }
  });

  it("maps transient faults (throttling, 5xx, network) to AI_PROVIDER_UNAVAILABLE", () => {
    for (const name of ["ThrottlingException", "ServiceUnavailableException", "InternalServerException", "ModelTimeoutException", "TimeoutError", ""]) {
      const err = classifyBedrockError(Object.assign(new Error("later"), { name }));
      expect(err).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    }
  });
});

describe("LocalClassifierProvider — unknown purposes fail loudly (fix 6)", () => {
  it("throws on a purpose with no deterministic behaviour instead of returning ''", async () => {
    const provider = new LocalClassifierProvider();
    await expect(provider.complete({ purpose: "typo.purpose", prompt: "x", containsStudentData: false }))
      .rejects.toThrow(/Unknown AI purpose/);
  });

  it("still serves every purpose the services actually use", async () => {
    const provider = new LocalClassifierProvider();
    for (const purpose of ["content.classify", "assessment.generate", "agent.generate", "help.hint", "parent.summary"]) {
      const result = await provider.complete({ purpose, prompt: "x", input: {}, containsStudentData: false });
      expect(result.text.length).toBeGreaterThan(0);
    }
  });
});
