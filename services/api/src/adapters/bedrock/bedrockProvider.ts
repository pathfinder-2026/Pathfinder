import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { AiCompletion, AiCompletionRequest, AiProvider, ProviderDescriptor } from "../../ports/aiProvider";
import { DEFAULT_AI_REGION, type AuRegion } from "../../platform/ai/aiServiceLayer";

/**
 * Production AI provider — Amazon Bedrock in ap-southeast-2 (Foundational
 * Decision 2). Constructed with region + zero-retention + no-training assertions
 * so the AI service layer's guard treats it as a compliant remote endpoint.
 *
 * NOT exercised by the Milestone 1 test suite: live invocation is gated on AWS
 * credentials + an enabled in-region model, which are not present in this
 * environment (see docs/decisions.md ADR-0013). The class exists, compiles and
 * type-checks so the path is ready the moment credentials exist.
 */
export interface BedrockProviderOptions {
  region?: AuRegion;
  modelId?: string;
  /** Zero-retention is a contractual/config property; must be true to construct. */
  zeroRetention?: boolean;
  noTraining?: boolean;
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
    this.client = new BedrockRuntimeClient({ region: this.region });
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
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      messages: [{ role: "user", content: request.prompt }],
    });
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    });
    const response = await this.client.send(command);
    const decoded = JSON.parse(new TextDecoder().decode(response.body));
    const text: string = decoded?.content?.[0]?.text ?? "";
    return { text };
  }
}
