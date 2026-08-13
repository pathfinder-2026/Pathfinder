import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { AiCompletion, AiCompletionRequest, AiProvider, ProviderDescriptor } from "../../ports/aiProvider";
import { DEFAULT_AI_REGION, type AuRegion } from "../../platform/ai/aiServiceLayer";
import { buildRemotePrompt, extractCompletionText } from "../../platform/ai/remotePrompt";
import { ConflictError, ServiceUnavailableError } from "../../domain/errors";

/**
 * Production AI provider — Amazon Bedrock in ap-southeast-2 (Foundational
 * Decision 2). Constructed with region + zero-retention + no-training assertions
 * so the AI service layer's guard treats it as a compliant remote endpoint.
 * (The flags assert contractual configuration; the layer re-validates them on
 * every call, and live verification of the AWS account remains the ADR-0013
 * onboarding step, with pauseForDrift as the runtime fail-safe.)
 *
 * NOT exercised live by the test suite: real invocation is gated on AWS
 * credentials + an enabled in-region model, which are not present in this
 * environment (see docs/decisions.md ADR-0013). The prompt assembly, response
 * extraction and error classification are pure functions with their own tests,
 * so this class stays a thin transport.
 */
export interface BedrockProviderOptions {
  region?: AuRegion;
  modelId?: string;
  /** Zero-retention is a contractual/config property; must be true to construct. */
  zeroRetention?: boolean;
  noTraining?: boolean;
}

/**
 * Classify an AWS SDK failure into the domain error taxonomy:
 *  - operator misconfiguration (bad credentials, model not enabled, bad request)
 *    → ConflictError AI_PROVIDER_MISCONFIGURED — retrying will not help;
 *  - everything transient (throttling, 5xx, timeouts, network)
 *    → ServiceUnavailableError AI_PROVIDER_UNAVAILABLE — safe to retry later.
 * Exported for unit tests.
 */
export function classifyBedrockError(error: unknown): Error {
  const err = error as { name?: string; message?: string };
  const name = err.name ?? "";
  const message = err.message ?? String(error);
  const misconfigured = [
    "AccessDeniedException",
    "UnrecognizedClientException",
    "ExpiredTokenException",
    "InvalidSignatureException",
    "ResourceNotFoundException", // model not enabled / wrong model id
    "ValidationException",
  ];
  if (misconfigured.includes(name)) {
    return new ConflictError(
      "AI_PROVIDER_MISCONFIGURED",
      `Bedrock rejected the call (${name}): ${message}. This needs an operator fix (credentials, model access or request shape) — retrying will not help.`,
    );
  }
  return new ServiceUnavailableError(
    `Bedrock is temporarily unavailable (${name || "network error"}): ${message}`,
    "AI_PROVIDER_UNAVAILABLE",
  );
}

export class BedrockProvider implements AiProvider {
  private readonly client: BedrockRuntimeClient;
  private readonly region: AuRegion;
  private readonly modelId: string;
  private readonly zeroRetention: boolean;
  private readonly noTraining: boolean;

  constructor(options: BedrockProviderOptions = {}) {
    this.region = options.region ?? DEFAULT_AI_REGION;
    this.modelId = options.modelId ?? "anthropic.claude-3-5-sonnet-20240620-v1:0";
    this.zeroRetention = options.zeroRetention ?? true;
    this.noTraining = options.noTraining ?? true;
    this.client = new BedrockRuntimeClient({
      region: this.region,
      // Throttling/transient faults retry with adaptive backoff inside ONE
      // logical call (so the audit trail still shows one ai.call per run).
      maxAttempts: 3,
      retryMode: "adaptive",
      // LLM generations can legitimately run tens of seconds; connections not so.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
    });
  }

  describe(): ProviderDescriptor {
    return {
      kind: "remote",
      provider: `bedrock:${this.modelId}`,
      region: this.region,
      zeroRetention: this.zeroRetention,
      noTraining: this.noTraining,
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    // The full prompt carries the instruction, the structured input (grounding
    // sources, topic, term…) and the purpose's output contract — a remote model
    // sees everything the local deterministic provider reasons over.
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      messages: [{ role: "user", content: buildRemotePrompt(request) }],
    });
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    });

    let response;
    try {
      response = await this.client.send(command);
    } catch (error) {
      throw classifyBedrockError(error);
    }

    let text = "";
    try {
      const decoded = JSON.parse(new TextDecoder().decode(response.body));
      text = typeof decoded?.content?.[0]?.text === "string" ? decoded.content[0].text : "";
    } catch {
      text = ""; // extractCompletionText raises the malformed-response error below
    }
    return { text: extractCompletionText(request.purpose, text) };
  }
}
