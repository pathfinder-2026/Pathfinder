import { ConflictError, ValidationError } from "../../domain/errors";

/**
 * The single internal AI service layer (Foundational Decision 2).
 *
 * Every LLM call in Pathfinder must pass through this ONE choke point, which is
 * where residency, zero-retention and no-training rules are enforced before any
 * student-data prompt can reach a model.
 *
 * In Milestone 0 this is deliberately an EMPTY choke point: no provider is
 * wired and `run()` throws. Real inference (Amazon Bedrock, ap-southeast-2)
 * becomes operational in Milestone 1, where student content first reaches an
 * LLM. What already exists here in M0 is the *guard*: the endpoint-compliance
 * check that later milestones cannot bypass, so the constraint is encoded now
 * rather than retrofitted.
 */

/** AU AWS regions permitted for any data-bearing / inference service. */
export const AU_REGIONS = ["ap-southeast-2", "ap-southeast-4"] as const;
export type AuRegion = (typeof AU_REGIONS)[number];

/** Default per Foundational Decision 2. */
export const DEFAULT_AI_REGION: AuRegion = "ap-southeast-2";

export interface AiEndpointConfig {
  provider: string;
  region: string;
  /** Provider contractually bound to zero retention of prompts/outputs. */
  zeroRetention: boolean;
  /** Provider contractually bound to NOT train on submitted data. */
  noTraining: boolean;
}

/**
 * Enforce residency + zero-retention + no-training. Throws for any endpoint
 * that is offshore, retains data, or is training-enabled. This is the technical
 * enforcement point behind FR-GOV-004, FR-GOV-007 and NFR-PRV-001/002.
 */
export function assertCompliantEndpoint(config: AiEndpointConfig): void {
  if (!AU_REGIONS.includes(config.region as AuRegion)) {
    throw new ValidationError(
      `AI endpoint region "${config.region}" is not an approved AU region ` +
        `(${AU_REGIONS.join(", ")}). No student-data prompt may reach an offshore endpoint.`,
    );
  }
  if (!config.zeroRetention) {
    throw new ValidationError(
      "AI endpoint must be zero-retention before any student data flows through it.",
    );
  }
  if (!config.noTraining) {
    throw new ValidationError(
      "AI endpoint must be contractually no-training before any student data flows through it.",
    );
  }
}

export interface AiRunRequest {
  purpose: string;
  prompt: string;
  /** Whether this prompt may contain student data (governs residency checks). */
  containsStudentData: boolean;
}

export interface AiRunResult {
  text: string;
}

export class AiServiceLayer {
  constructor(private readonly endpoint: AiEndpointConfig | null = null) {
    if (endpoint) assertCompliantEndpoint(endpoint);
  }

  /** Is a compliant provider wired? (false throughout Milestone 0.) */
  isOperational(): boolean {
    return this.endpoint !== null;
  }

  /**
   * Run an inference. Milestone 0: no provider is configured, so this always
   * throws. The guard still runs first, so even a future misconfiguration is
   * caught at the choke point.
   */
  async run(_request: AiRunRequest): Promise<AiRunResult> {
    if (!this.endpoint) {
      throw new ConflictError(
        "AI_NOT_OPERATIONAL",
        "The AI service layer is an empty choke point in Milestone 0. " +
          "A compliant in-AU Bedrock endpoint is wired in Milestone 1.",
      );
    }
    assertCompliantEndpoint(this.endpoint);
    // Milestone 1 wires the Bedrock (ap-southeast-2) call here.
    throw new ConflictError("AI_NOT_OPERATIONAL", "No inference provider is bound yet.");
  }
}
