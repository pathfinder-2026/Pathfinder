import { ConflictError, ValidationError } from "../../domain/errors";
import { maskRequest, unmaskText } from "./piiMasking";
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
  /** Fail-safe pause: when set, no AI call proceeds (FR-GOV-007 drift). */
  private paused: { reason: string } | null = null;
  /** Per-actor usage counters for the fair-use guardrail (NFR-COST-001). */
  private readonly usage = new Map<string, number>();
  private usageCap: number | null = null;

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
   * FR-GOV-007 — fail safe. When the provider's data-handling configuration
   * changes or cannot be verified, PAUSE the choke point: every AI call then
   * fails with a clear Admin-facing status rather than continuing silently.
   */
  pauseForDrift(reason: string): void {
    this.paused = { reason };
    this.audit?.append({ action: "ai.paused", actorId: null, subjectType: "ai", subjectId: "service-layer", metadata: { reason } });
  }
  resume(): void {
    this.paused = null;
    this.audit?.append({ action: "ai.resumed", actorId: null, subjectType: "ai", subjectId: "service-layer", metadata: {} });
  }
  isPaused(): boolean {
    return this.paused !== null;
  }

  /** NFR-COST-001 — a per-actor fair-use cap. null = unlimited (default). */
  setUsageCap(cap: number | null): void {
    this.usageCap = cap;
  }
  usageFor(actorId: string): number {
    return this.usage.get(actorId) ?? 0;
  }

  /**
   * Run an inference through the choke point. Fail-safe pause and usage cap are
   * checked FIRST; the provider is re-validated on every call (so config drift to
   * a non-compliant endpoint is blocked architecturally, not by convention); then
   * an audit entry is written BEFORE the provider runs — if that write throws, the
   * action is blocked rather than silently proceeding unlogged (FR-GOV-002).
   */
  async run(request: AiRunRequest, actorId: string | null = null): Promise<AiRunResult> {
    if (!this.provider) {
      throw new ConflictError("AI_NOT_OPERATIONAL", "The AI service layer has no provider bound.");
    }
    if (this.paused) {
      throw new ConflictError("AI_PAUSED", `AI is paused pending Admin review: ${this.paused.reason}`);
    }
    const key = actorId ?? "system";
    if (this.usageCap !== null && (this.usage.get(key) ?? 0) >= this.usageCap) {
      throw new ConflictError("COST_CAP_REACHED", "AI fair-use cap reached. An Admin can raise the limit; requests are declined rather than billed unbounded.");
    }

    const descriptor = this.provider.describe();
    assertCompliantProvider(descriptor); // re-validated per call: drift to a non-compliant endpoint is blocked here

    // Mask caller-declared names to stable pseudonyms BEFORE anything else sees
    // the request. The token → name map is request-scoped: it lives only in
    // this frame and is never audited, logged or persisted.
    const { masked, map, maskedCount } = maskRequest(request);

    // Every AI call writes an audit entry BEFORE the result — a logging failure
    // throws here and blocks the action (never a silent, unlogged AI call).
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
        // THAT masking happened (a count) — never the mapping itself.
        piiMasked: maskedCount,
        // Provenance references (ids only — no PII in the immutable log): the
        // grounding content and the prompt purpose make the AI action auditable.
        grounding: request.provenanceGrounding ?? [],
      },
    });

    this.usage.set(key, (this.usage.get(key) ?? 0) + 1);
    const completion = await this.provider.complete(masked);
    if (map.size === 0) return completion;

    // Restore real names for the caller; a pseudonym the model emitted that was
    // never issued is left as-is and flagged (count + token labels only — the
    // tokens carry no PII).
    const { text, unresolvedTokens } = unmaskText(completion.text, map);
    if (unresolvedTokens.length > 0) {
      this.audit?.append({
        action: "ai.mask.unresolved",
        actorId,
        subjectType: "ai",
        subjectId: request.purpose,
        metadata: { tokens: unresolvedTokens },
      });
    }
    return { text };
  }
}
