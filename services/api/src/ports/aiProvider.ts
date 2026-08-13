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

import { ValidationError } from "../domain/errors";

export type ProviderDescriptor =
  | { kind: "local"; provider: string }
  | {
      kind: "remote";
      provider: string;
      region: string;
      zeroRetention: boolean;
      noTraining: boolean;
      /**
       * An explicit, operator-acknowledged exception to the AU-residency /
       * zero-retention / no-training checks below (Foundational Decision 1).
       * ABSENT by default — every provider must satisfy the checks normally.
       * Set this ONLY when an operator has consciously decided to accept a
       * provider that does NOT meet them (e.g. the direct Claude API, which
       * has no Australia-specific region option) — never to paper over an
       * unverified or accidental gap. `reason` is carried into the audit
       * trail on every call so the exception is visible, not silent. See
       * docs/decisions.md ADR-0034.
       */
      residencyException?: { reason: string };
    };

/**
 * One person whose identifiers may appear in the request. `values` are the
 * name variants the CALLER knows (e.g. ["Sana", "Sana Student"]) — the first
 * valid entry is the canonical form restored on unmasking. The service layer
 * replaces every variant with one stable pseudonym ("Student A") before any
 * provider sees the request (see platform/ai/piiMasking.ts).
 */
export interface PiiSubject {
  role: "student" | "teacher" | "parent";
  values: string[];
}

export interface AiCompletionRequest {
  /** Machine-readable use case, e.g. "content.classify". */
  purpose: string;
  /** Human/LLM prompt (used by the remote provider). */
  prompt: string;
  /** Structured input the local provider can reason over deterministically. */
  input?: unknown;
  /** Whether this prompt may contain student data (governs residency checks). */
  containsStudentData: boolean;
  /** Approved-content ids grounding this call — logged as provenance (FR-GOV-002). */
  provenanceGrounding?: string[];
  /**
   * People the caller KNOWS are referenced by this request. When
   * `containsStudentData` is true their names are masked to stable pseudonyms
   * before the provider runs and restored afterwards; the mapping lives only
   * for the duration of the call and is never audited or persisted. Stripped
   * from the request the provider receives.
   */
  piiValues?: PiiSubject[];
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
    if (request.purpose === "assessment.generate") {
      return { text: JSON.stringify(this.generateQuestion(request.input)) };
    }
    if (request.purpose === "agent.generate") {
      return { text: this.agentDraft(request.input) };
    }
    if (request.purpose === "help.hint") {
      return { text: this.helpHint(request.input) };
    }
    if (request.purpose === "parent.summary") {
      return { text: this.parentSummary(request.input) };
    }
    // An unknown purpose is a programmer error (e.g. a typo'd purpose string).
    // Failing loudly beats silently returning "" that becomes an empty draft
    // or a failed JSON parse far from its cause.
    throw new ValidationError(`Unknown AI purpose "${request.purpose}" — no deterministic behaviour is defined for it.`);
  }

  /**
   * A plain-language, OBSERVATIONAL progress summary for a parent — strengths and
   * focus areas described in everyday topic words, never clinical/diagnostic terms
   * and never raw internal labels. The service also guards the output.
   */
  private parentSummary(input: unknown): string {
    const f = (input ?? {}) as { name?: string; strengths?: string[]; focusAreas?: string[]; activity?: string[] };
    const who = f.name ?? "Your child";
    const strengths = (f.strengths ?? []).filter(Boolean);
    const focus = (f.focusAreas ?? []).filter(Boolean);
    const activity = (f.activity ?? []).filter(Boolean);
    const parts: string[] = [];
    if (strengths.length) parts.push(`${who} is doing well with ${list(strengths)}.`);
    if (focus.length) parts.push(`${who} has found ${list(focus)} more challenging and is getting extra practice.`);
    if (activity.length) parts.push(`Recently: ${list(activity)}.`);
    if (parts.length === 0) parts.push(`There's no new activity to report for ${who} this period.`);
    return parts.join(" ");
  }

  /**
   * A HINT grounded in the task's approved content — never the answer. The tutor
   * is given only the grounding chunk (never a solution), so it structurally
   * cannot leak one; it nudges the student toward the next step.
   */
  private helpHint(input: unknown): string {
    const f = (input ?? {}) as { chunk?: string; topic?: string };
    const topic = (f.topic ?? "this task").trim();
    const chunk = (f.chunk ?? "").trim();
    const anchor = chunk ? chunk.split(/\s+/).slice(0, 10).join(" ") : topic;
    return `Here's a hint on ${topic}: revisit "${anchor}". Try the first step yourself and check it against the approved material — I can nudge you if you get stuck, but I won't do it for you.`;
  }

  /**
   * Deterministically draft Teacher-Agent prose GROUNDED in the supplied approved
   * sources (never invented from nothing — the caller declines when there are no
   * sources). Academic only; sensitive observations are separated by the service.
   */
  private agentDraft(input: unknown): string {
    const f = (input ?? {}) as { kind?: string; topic?: string; term?: string; sources?: string[]; personalised?: boolean };
    const topic = f.topic ?? "the topic";
    const sources = (f.sources ?? []).join("; ") || "the approved content";
    switch (f.kind) {
      case "unit_sequence":
        return `Draft unit sequence for ${f.term ?? "the term"} on "${topic}", grounded in ${sources}. Week 1 introduces core ideas; subsequent weeks build toward mastery with checkpoints.`;
      case "lesson_plan":
        return `Draft lesson plan on "${topic}", grounded in ${sources}. Starter, guided practice, independent task, and an exit check.`;
      case "differentiation":
        return `Differentiation plan for "${topic}", grounded in ${sources}. ${f.personalised ? "Tiered to the class's current mastery data." : "A general three-tier plan (support / core / extension)."}`;
      case "parent_summary":
        return `Draft progress summary on "${topic}", grounded in ${sources}. The student has engaged with the core concepts and is progressing.`;
      case "feedback":
        return `Draft feedback on "${topic}", grounded in ${sources}. Strengths noted; next steps suggested.`;
      default:
        return `Draft grounded in ${sources}.`;
    }
  }

  /**
   * Deterministically draft one question GROUNDED in a supplied content chunk
   * (never fabricated from nothing). Version-specific `seed` yields different
   * wording/values while testing the same content.
   */
  private generateQuestion(input: unknown): {
    prompt: string;
    options: string[] | null;
    modelAnswer: string;
    rubric: string | null;
  } {
    const f = (input ?? {}) as { chunk?: string; type?: string; difficulty?: string; seed?: string };
    const chunk = (f.chunk ?? "").trim();
    const topic = chunk.split(/\s+/).slice(0, 8).join(" ") || "the material";
    const v = f.seed ? ` [${f.seed}]` : "";
    const type = f.type ?? "short_answer";

    if (type === "multiple_choice") {
      return {
        prompt: `Which statement about "${topic}" is correct?${v}`,
        options: [`Correct fact about ${topic}`, "Distractor 1", "Distractor 2", "Distractor 3"],
        modelAnswer: `Correct fact about ${topic}`,
        rubric: null,
      };
    }
    if (type === "numerical") {
      return { prompt: `Compute a value from "${topic}".${v}`, options: null, modelAnswer: "42", rubric: null };
    }
    if (type === "extended_response") {
      return {
        prompt: `Explain, with reasoning, the key idea in "${topic}".${v}`,
        options: null,
        modelAnswer: `A well-structured explanation grounded in ${topic}.`,
        rubric: `1 mark: identifies the idea. 2 marks: correct reasoning. 3 marks: worked example from ${topic}.`,
      };
    }
    if (type === "scenario") {
      return { prompt: `A student encounters "${topic}" in a real context — what should they do?${v}`, options: null, modelAnswer: `Apply ${topic} to the scenario.`, rubric: null };
    }
    return { prompt: `Briefly describe "${topic}".${v}`, options: null, modelAnswer: `A short answer about ${topic}.`, rubric: null };
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

/** Join items into a natural-language list: "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
