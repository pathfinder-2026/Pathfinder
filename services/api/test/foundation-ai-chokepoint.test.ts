import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../src/domain/errors";
import {
  AiServiceLayer,
  assertCompliantEndpoint,
  DEFAULT_AI_REGION,
} from "../src/platform/ai/aiServiceLayer";

/**
 * Foundational Decision 2 — the single AI service layer choke point. In
 * Milestone 0 it is EMPTY (no provider wired); the residency / zero-retention /
 * no-training guard already exists so it cannot be bypassed later.
 */
describe("Foundation — AI service layer (empty choke point + guard)", () => {
  const compliant = {
    provider: "bedrock",
    region: "ap-southeast-2",
    zeroRetention: true,
    noTraining: true,
  };

  it("defaults to ap-southeast-2", () => {
    expect(DEFAULT_AI_REGION).toBe("ap-southeast-2");
  });

  it("accepts a compliant in-AU, zero-retention, no-training endpoint", () => {
    expect(() => assertCompliantEndpoint(compliant)).not.toThrow();
  });

  it("rejects an offshore endpoint", () => {
    expect(() => assertCompliantEndpoint({ ...compliant, region: "us-east-1" })).toThrow(
      ValidationError,
    );
  });

  it("rejects retention-enabled or training-enabled endpoints", () => {
    expect(() => assertCompliantEndpoint({ ...compliant, zeroRetention: false })).toThrow(
      ValidationError,
    );
    expect(() => assertCompliantEndpoint({ ...compliant, noTraining: false })).toThrow(
      ValidationError,
    );
  });

  it("is not operational in Milestone 0 and refuses to run", async () => {
    const ai = new AiServiceLayer(null);
    expect(ai.isOperational()).toBe(false);
    await expect(
      ai.run({ purpose: "test", prompt: "hi", containsStudentData: false }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to construct with an offshore endpoint", () => {
    expect(() => new AiServiceLayer({ ...compliant, region: "eu-west-1" })).toThrow(ValidationError);
  });
});
