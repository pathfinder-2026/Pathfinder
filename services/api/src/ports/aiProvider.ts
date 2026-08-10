/**
 * AI provider port. The single AI service layer (Foundational Decision 2)
 * delegates to a provider. Two implementations exist:
 *
 *  - BedrockProvider (remote) — Amazon Bedrock in ap-southeast-2, guarded by the
 *    residency / zero-retention / no-training check. This is production.
 *  - LocalClassifierProvider (local) — a deterministic, in-process provider used
 *    by dev and the test suite. It reaches NO network endpoint, so no student
 *    data ever leaves the machine; that is why the compliance guard treats
 *    `kind: "local"` as inherently compliant.
 *
 * Live Bedrock verification is gated on AWS credentials (deferred — see
 * docs/decisions.md ADR-0013); until then the local provider backs everything.
 */

export type ProviderDescriptor =
  | { kind: "local"; provider: string }
  | {
      kind: "remote";
      provider: string;
      region: string;
      zeroRetention: boolean;
      noTraining: boolean;
    };

export interface AiCompletionRequest {
  /** Machine-readable use case, e.g. "content.classify". */
  purpose: string;
  /** Human/LLM prompt (used by the remote provider). */
  prompt: string;
  /** Structured input the local provider can reason over deterministically. */
  input?: unknown;
  /** Whether this prompt may contain student data (governs residency checks). */
  containsStudentData: boolean;
}

export interface AiCompletion {
  text: string;
}

export interface AiProvider {
  describe(): ProviderDescriptor;
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

/**
 * Deterministic, in-process provider. For `content.classify` it inspects the
 * structured `input` (never a live model) and returns classification JSON, with
 * a confidence that drops when the material looks cross-subject/ambiguous.
 */
export class LocalClassifierProvider implements AiProvider {
  describe(): ProviderDescriptor {
    return { kind: "local", provider: "local-deterministic-v1" };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    if (request.purpose === "content.classify") {
      return { text: JSON.stringify(this.classify(request.input)) };
    }
    // No other AI use cases are in Milestone 1 scope.
    return { text: "" };
  }

  private classify(input: unknown): {
    subject: string;
    year: number;
    topic: string;
    outcome: string;
    difficulty: string;
    confidence: number;
  } {
    const features = (input ?? {}) as {
      text?: string;
      subjectHint?: string;
      yearHint?: number;
    };
    const text = (features.text ?? "").toLowerCase();

    // Very small deterministic heuristic — stands in for the model in tests.
    const mathsSignals = ["algebra", "equation", "fraction", "geometry", "integer", "maths", "math"];
    const otherSubjectSignals = ["photosynthesis", "biology", "essay", "poem", "history", "cell"];
    const looksMaths = mathsSignals.some((s) => text.includes(s));
    const looksOther = otherSubjectSignals.some((s) => text.includes(s));

    // Cross-subject / ambiguous => low confidence.
    const ambiguous = looksMaths && looksOther;
    const confidence = ambiguous ? 0.42 : looksMaths ? 0.93 : 0.6;

    return {
      subject: features.subjectHint ?? (looksMaths ? "Mathematics" : "Unknown"),
      year: features.yearHint ?? 8,
      topic: looksMaths ? "Number and Algebra" : "Unclassified",
      outcome: looksMaths ? "MA4-ALG" : "UNMAPPED",
      difficulty: "medium",
      confidence,
    };
  }
}
