import Anthropic from "@anthropic-ai/sdk";
import type { AiCompletion, AiCompletionRequest, AiProvider, ProviderDescriptor } from "../../ports/aiProvider";
import { buildRemoteSystemPrompt, buildRemoteUserPrompt, extractCompletionText } from "../../platform/ai/remotePrompt";
import { ConflictError, ServiceUnavailableError, ValidationError } from "../../domain/errors";

/**
 * Alternate remote AI provider — the Anthropic Claude API directly, instead of
 * Amazon Bedrock.
 *
 * RESIDENCY (ADR-0034): the direct Claude API has no Australia-specific
 * residency control — its only inference-geography option (`inference_geo`)
 * is "us" or "global", never AU. `AiServiceLayer`'s compliance guard
 * (`assertCompliantProvider`, Foundational Decision 1) would normally REFUSE
 * to bind any remote provider outside `ap-southeast-2`/`ap-southeast-4`. This
 * provider only passes that guard because `describe()` carries an explicit
 * `residencyException` — an operator's CONSCIOUS, ACKNOWLEDGED decision to
 * accept global/US inference for now, not a fabricated "ap-southeast-2" and
 * not a silent gap. Two independent gates enforce that the acknowledgment is
 * real, not incidental:
 *   1. The constructor THROWS unless `acceptNonAuResidency` (or the env var
 *      PF_AI_ACCEPT_NON_AU_RESIDENCY="true") is explicitly set — an API key
 *      alone is not enough to activate this provider.
 *   2. Every `ai.call` audit entry carries the residency-exception reason
 *      (see AiServiceLayer.run) — never a silently-passing compliance check.
 * Revisit when a confirmed AU-region path exists (e.g. Claude Platform on AWS
 * pinned to ap-southeast-2).
 */
export interface AnthropicProviderOptions {
  /** Falls back to ANTHROPIC_API_KEY (SDK default credential resolution). */
  apiKey?: string;
  /** Falls back to PF_ANTHROPIC_MODEL, then the current default model. */
  model?: string;
  /**
   * Required (directly or via PF_AI_ACCEPT_NON_AU_RESIDENCY="true") — the
   * operator's explicit acknowledgment that this provider does not meet the
   * AU-residency guarantee normally required of remote AI providers. See the
   * class-level comment.
   */
  acceptNonAuResidency?: boolean;
}

const DEFAULT_MODEL = "claude-opus-5";
const RESIDENCY_EXCEPTION_REASON =
  "Direct Claude API has no Australia-specific inference_geo option (only \"us\"/\"global\"). " +
  "Operator has explicitly accepted global/US inference pending a confirmed AU residency path " +
  "(see docs/decisions.md ADR-0034).";

/**
 * Classify an Anthropic SDK failure into the domain error taxonomy — mirrors
 * classifyBedrockError's split:
 *  - operator misconfiguration (bad key, bad model id, bad request shape)
 *    -> ConflictError AI_PROVIDER_MISCONFIGURED — retrying will not help;
 *  - everything transient (rate limits, 5xx, overload, network)
 *    -> ServiceUnavailableError AI_PROVIDER_UNAVAILABLE — safe to retry later.
 * Exported for unit tests.
 */
export function classifyAnthropicError(error: unknown): Error {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError
  ) {
    return new ConflictError(
      "AI_PROVIDER_MISCONFIGURED",
      `Anthropic API rejected the call (${error.status} ${error.name}): ${error.message}. This needs an operator fix (API key, model access or request shape) — retrying will not help.`,
    );
  }
  if (error instanceof Anthropic.APIError) {
    // Covers RateLimitError, InternalServerError, overloaded_error (529),
    // and APIConnectionError (a subclass of APIError in this SDK) — all transient.
    return new ServiceUnavailableError(
      `Anthropic API is temporarily unavailable (${error.name}): ${error.message}`,
      "AI_PROVIDER_UNAVAILABLE",
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ServiceUnavailableError(`Anthropic API call failed: ${message}`, "AI_PROVIDER_UNAVAILABLE");
}

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions = {}) {
    const accepted = options.acceptNonAuResidency ?? process.env.PF_AI_ACCEPT_NON_AU_RESIDENCY === "true";
    if (!accepted) {
      throw new ValidationError(
        "AnthropicProvider has no AU-region guarantee (ADR-0034) and requires an explicit " +
          "acknowledgment to construct: pass acceptNonAuResidency: true, or set " +
          'PF_AI_ACCEPT_NON_AU_RESIDENCY="true". This is a conscious residency trade-off, not a default.',
      );
    }
    this.model = options.model ?? process.env.PF_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  describe(): ProviderDescriptor {
    return {
      kind: "remote",
      provider: `anthropic:${this.model}`,
      // Deliberately NOT an AU_REGIONS value — see the class-level comment.
      // Reporting "ap-southeast-2" here without a real regional guarantee would
      // be exactly the fabrication ADR-0013 already refused to do for Bedrock.
      region: "global",
      // Anthropic's standard commercial API policy does not train on API
      // inputs/outputs by default — distinct from the Claude.ai consumer
      // product. Retention (true zero-data-retention) requires a separate,
      // account-level ZDR agreement we have not confirmed, so that stays false.
      zeroRetention: false,
      noTraining: true,
      residencyException: { reason: RESIDENCY_EXCEPTION_REASON },
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    // The STABLE half (shared preamble + purpose contract) goes in `system`
    // with a cache_control breakpoint — identical bytes on every call sharing
    // this purpose, so it's the correct cacheable prefix. The VARYING half
    // (this call's instruction + structured input) goes in the user turn,
    // after the cache boundary, where it belongs.
    const system = buildRemoteSystemPrompt(request.purpose);
    const userContent = buildRemoteUserPrompt(request);

    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokensFor(request.purpose),
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      });
    } catch (error) {
      throw classifyAnthropicError(error);
    }

    const textBlock = response.content.find((block) => block.type === "text");
    return { text: extractCompletionText(request.purpose, textBlock?.text ?? "") };
  }
}

/**
 * Output budget per purpose. 1024 suits a question, a hint or a short summary,
 * but a whole curriculum outline (many strands, each with several skills) does
 * not fit — it came back truncated to empty, surfacing as AI_RESPONSE_MALFORMED
 * when a real NESA syllabus was drafted from.
 */
function maxTokensFor(purpose: string): number {
  return purpose === "curriculum.draft" ? 8192 : 1024;
}
