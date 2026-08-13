import { describe, expect, it } from "vitest";
import { AiServiceLayer } from "../src/platform/ai/aiServiceLayer";
import { maskRequest, unmaskText } from "../src/platform/ai/piiMasking";
import { LocalClassifierProvider, type AiCompletionRequest, type AiProvider } from "../src/ports/aiProvider";
import { AuditRecorder } from "../src/platform/audit/auditLog";
import { FixedClock } from "../src/platform/clock";

/**
 * PII masking at the AI choke point: caller-declared names are replaced with
 * stable pseudonyms before ANY provider sees the request, restored in the
 * completion, and the token → name mapping never leaves the call frame —
 * the audit records only that masking happened.
 */

/** A provider that records exactly what it was given and replies as scripted. */
function spyProvider(reply: string) {
  const seen: AiCompletionRequest[] = [];
  const provider: AiProvider = {
    describe: () => ({ kind: "local", provider: "spy" }),
    complete: async (request) => {
      seen.push(request);
      return { text: reply };
    },
  };
  return { provider, seen };
}

const SANA = [{ role: "student" as const, values: ["Sana", "Sana Student"] }];

describe("PII masking — nothing real reaches the provider", () => {
  it("replaces every declared name variant in prompt AND input with one stable token, and strips piiValues", async () => {
    const { provider, seen } = spyProvider("ok");
    const ai = new AiServiceLayer(provider, new AuditRecorder(new FixedClock()));
    await ai.run({
      purpose: "parent.summary",
      prompt: "Summarise progress for Sana Student.",
      input: { name: "Sana", notes: ["Sana tried hard", { deep: "Sana Student improved" }] },
      containsStudentData: true,
      piiValues: SANA,
    }, "parent-1");

    const wire = JSON.stringify(seen[0]);
    expect(wire).not.toContain("Sana");
    expect(seen[0].prompt).toBe("Summarise progress for Student A.");
    expect(wire).toContain("Student A tried hard");
    expect(wire).toContain("Student A improved"); // longest variant masked as ONE token
    expect(seen[0].piiValues).toBeUndefined(); // real values never travel
  });

  it("gives each person their own token, sequenced per role", async () => {
    const { provider, seen } = spyProvider("ok");
    const ai = new AiServiceLayer(provider, null);
    await ai.run({
      purpose: "parent.summary",
      prompt: "Sana worked with Ben; their teacher is Tara.",
      containsStudentData: true,
      piiValues: [
        { role: "student", values: ["Sana"] },
        { role: "student", values: ["Ben"] },
        { role: "teacher", values: ["Tara"] },
      ],
    });
    expect(seen[0].prompt).toBe("Student A worked with Student B; their teacher is Teacher A.");
  });

  it("never corrupts words that merely contain a name (word-boundary, exact case)", () => {
    const { masked } = maskRequest({
      purpose: "parent.summary",
      prompt: "Adapt the Ada worksheet so Ada can mark her own work.",
      containsStudentData: true,
      piiValues: [{ role: "student", values: ["Ada"] }],
    });
    expect(masked.prompt).toBe("Adapt the Student A worksheet so Student A can mark her own work.");
  });

  it("passes containsStudentData:false requests through untouched, even with piiValues present", async () => {
    const { provider, seen } = spyProvider("ok");
    const ai = new AiServiceLayer(provider, new AuditRecorder(new FixedClock()));
    const request = {
      purpose: "parent.summary" as const,
      prompt: "Sana is mentioned but this request carries no student data flag.",
      input: { name: "Sana" },
      containsStudentData: false,
      piiValues: SANA,
    };
    const result = await ai.run(request);
    expect(seen[0].prompt).toContain("Sana"); // unmasked, unchanged
    expect(seen[0].input).toEqual({ name: "Sana" });
    expect(result.text).toBe("ok");
  });
});

describe("PII masking — the caller gets real names back", () => {
  it("restores names including case-drifted and possessive token forms", async () => {
    const { provider } = spyProvider("Student A is improving. student a's working-out is neat.");
    const ai = new AiServiceLayer(provider, null);
    const result = await ai.run({
      purpose: "parent.summary", prompt: "Summarise Sana.", containsStudentData: true, piiValues: SANA,
    });
    expect(result.text).toBe("Sana is improving. Sana's working-out is neat.");
  });

  it("round-trips through the real deterministic provider (parent.summary)", async () => {
    const ai = new AiServiceLayer(new LocalClassifierProvider(), new AuditRecorder(new FixedClock()));
    const result = await ai.run({
      purpose: "parent.summary",
      prompt: "Plain-language, observational, non-diagnostic parent summary.",
      input: { name: "Sana", strengths: ["fractions"], focusAreas: [], activity: ["completed 2 tasks"] },
      containsStudentData: true,
      piiValues: [{ role: "student", values: ["Sana"] }],
    }, "parent-1");
    expect(result.text).toContain("Sana is doing well with fractions");
    expect(result.text).not.toContain("Student A");
  });

  it("leaves a hallucinated, never-issued token untouched and flags it", async () => {
    const { provider } = spyProvider("Student A helped Student B revise.");
    const audit = new AuditRecorder(new FixedClock());
    const ai = new AiServiceLayer(provider, audit);
    const result = await ai.run({
      purpose: "parent.summary", prompt: "About Sana.", containsStudentData: true, piiValues: SANA,
    }, "parent-1");
    // Only Student A was issued — Student B is left verbatim, never guessed at.
    expect(result.text).toBe("Sana helped Student B revise.");
    const flagged = audit.find((e) => e.action === "ai.mask.unresolved");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.metadata).toEqual({ tokens: ["Student B"] });
  });
});

describe("PII masking — the mapping never leaves the call frame", () => {
  it("audits THAT masking happened (a count), never a name or the mapping", async () => {
    const { provider } = spyProvider("Student A is fine.");
    const audit = new AuditRecorder(new FixedClock());
    const ai = new AiServiceLayer(provider, audit);
    await ai.run({
      purpose: "parent.summary", prompt: "Summarise Sana Student.", containsStudentData: true, piiValues: SANA,
    }, "parent-1");

    const calls = audit.find((e) => e.action === "ai.call");
    expect(calls[0]?.metadata).toMatchObject({ piiMasked: 1 });
    // The full audit log carries no real name and no token→name mapping.
    expect(JSON.stringify(audit.list())).not.toContain("Sana");
  });

  it("unmaskText handles the longer-token edge without splitting (Student AA vs Student A)", () => {
    const map = new Map([["Student A", "Sana"], ["Student AA", "Zed"]]);
    expect(unmaskText("Student AA sat with Student A.", map).text).toBe("Zed sat with Sana.");
  });

  it("skips unusable variants (blank / single-character) rather than corrupting text", () => {
    const { masked, maskedCount } = maskRequest({
      purpose: "parent.summary",
      prompt: "A note about J and Sana.",
      containsStudentData: true,
      piiValues: [{ role: "student", values: [" ", "J"] }, { role: "student", values: ["Sana"] }],
    });
    // The all-unusable subject is dropped entirely (it consumes no token), so
    // "J" stays verbatim and the next subject takes "Student A".
    expect(masked.prompt).toBe("A note about J and Student A.");
    expect(maskedCount).toBe(1);
  });
});
