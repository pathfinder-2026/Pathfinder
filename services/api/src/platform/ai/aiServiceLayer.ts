import { ConflictError, ValidationError } from "../../domain/errors";
import type { AuditRecorder } from "../audit/auditLog";
import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
  ProviderDescriptor,
} from "../../ports/aiProvider";

/**
 * The single internal AI service layer (Foundational Decision 2) — the ONE
 * choke point every LLM call passes through. It:
 *   1. enforces residency / zero-retention / no-training on the provider, and
 *   2. writes an audit entry for EVERY call (Foundational Decision 3).
 *
 * In Milestone 1 it becomes operational via an injected provider. The remote
 * (Bedrock, ap-southeast-2) provider is guarded; the local deterministic
 * provider reaches no endpoint. If no provider is bound, `run()` throws.
 */

/** AU AWS regions permitted for any data-bearing / inference service. */
export const AU_REGIONS = ["ap-southeast-2", "ap-southeast-4"] as const;
export type AuRegion = (typeof AU_REGIONS)[number];

/** Default per Foundational Decision 2. */
export const DEFAULT_AI_REGION: AuRegion = "ap-southeast-2";

/**
 * Enforce residency + zero-retention + no-training for a provider. A local
 * (in-process) provider reaches no endpoint and is inherently compliant; a
 * remote provider must be in an approved AU region, zero-retention and
 * no-training. Throws otherwise. This is the technical enforcement point behind
 * FR-GOV-004, FR-GOV-007 and NFR-PRV-001/002.
 */
export function assertCompliantProvider(descriptor: ProviderDescriptor): void {
  if (descriptor.kind === "local") return;
  if (!AU_REGIONS.includes(descriptor.region as AuRegion)) {
    throw new ValidationError(
      `AI endpoint region "${descriptor.region}" is not an approved AU region ` +
        `(${AU_REGIONS.join(", ")}). No student-data prompt may reach an offshore endpoint.`,
    );
  }
  if (!descriptor.zeroRetention) {
    throw new ValidationError(
      "AI endpoint must be zero-retention before any student data flows through it.",
    );
  }
  if (!descriptor.noTraining) {
    throw new ValidationError(
      "AI endpoint must be contractually no-training before any student data flows through it.",
    );
  }
}

/** Back-compat helper retained for the endpoint-shaped config used in tests. */
export interface AiEndpointConfig {
  provider: string;
  region: string;
  zeroRetention: boolean;
  noTraining: boolean;
}
export function assertCompliantEndpoint(config: AiEndpointConfig): void {
  assertCompliantProvider({ kind: "remote", ...config });
}

export interface AiRunRequest extends AiCompletionRequest {}
export interface AiRunResult extends AiCompletion {}

export class AiServiceLayer {
  constructor(
    private readonly provider: AiProvider | null,
    private readonly audit: AuditRecorder | null = null,
  ) {
    if (provider) assertCompliantProvider(provider.describe());
  }

  /** Is a provider bound? */
  isOperational(): boolean {
    return this.provider !== null;
  }

  descriptor(): ProviderDescriptor | null {
    return this.provider ? this.provider.describe() : null;
  }

  /**
   * Run an inference through the choke point. Validates the provider, records an
   * audit entry (Decision 3), then delegates. Throws if no provider is bound.
   */
  async run(request: AiRunRequest, actorId: string | null = null): Promise<AiRunResult> {
    if (!this.provider) {
      throw new ConflictError(
        "AI_NOT_OPERATIONAL",
        "The AI service layer has no provider bound.",
      );
    }
    const descriptor = this.provider.describe();
    assertCompliantProvider(descriptor);

    // Every AI call writes an audit entry — before and independent of the result.
    this.audit?.append({
      action: "ai.call",
      actorId,
      subjectType: "ai",
      subjectId: request.purpose,
      metadata: {
        purpose: request.purpose,
        provider: descriptor.provider,
        providerKind: descriptor.kind,
        region: descriptor.kind === "remote" ? descriptor.region : "local",
        containsStudentData: request.containsStudentData,
      },
    });

    return this.provider.complete(request);
  }
}
