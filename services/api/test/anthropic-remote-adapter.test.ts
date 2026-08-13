import { describe, expect, it } from "vitest";
import Anthropic, { APIError as AnthropicAPIError } from "@anthropic-ai/sdk";
import { AnthropicProvider, classifyAnthropicError } from "../src/adapters/anthropic/anthropicProvider";
import { AiServiceLayer, assertCompliantProvider } from "../src/platform/ai/aiServiceLayer";
import { buildRemoteSystemPrompt, buildRemoteUserPrompt } from "../src/platform/ai/remotePrompt";

/**
 * AnthropicProvider is written and type-checked like BedrockProvider was at
 * M1 (ADR-0013). Unlike Bedrock, it's now LIVE-WIREABLE (ADR-0034): the direct
 * Claude API has no Australia-specific residency control, so binding it to
 * AiServiceLayer requires an explicit, operator-acknowledged
 * `residencyException` — never a fabricated "ap-southeast-2" and never a
 * silent gap. These tests cover the pure logic AND prove BOTH halves of that
 * gate actually work: the constructor refuses without acknowledgment, and
 * AiServiceLayer accepts it once the exception is present.
 */

describe("AnthropicProvider — construction requires an explicit residency acknowledgment", () => {
  it("refuses to construct without acceptNonAuResidency (an API key alone is not enough)", () => {
    expect(() => new AnthropicProvider({ apiKey: "test-key" })).toThrow(/acknowledgment|residency/i);
  });

  it("constructs once the operator explicitly accepts non-AU residency", () => {
    const provider = new AnthropicProvider({ apiKey: "test-key", acceptNonAuResidency: true });
    const descriptor = provider.describe();
    expect(descriptor.kind).toBe("remote");
    expect(descriptor).toMatchObject({ region: "global", zeroRetention: false, noTraining: true });
    expect(descriptor.kind === "remote" && descriptor.residencyException?.reason).toMatch(/ADR-0034/);
  });

  it("the compliance guard now ACCEPTS it — the exception is honored, not bypassed silently", () => {
    const provider = new AnthropicProvider({ apiKey: "test-key", acceptNonAuResidency: true });
    expect(() => assertCompliantProvider(provider.describe())).not.toThrow();
    // AiServiceLayer's constructor calls the same guard — binding must succeed too.
    expect(() => new AiServiceLayer(provider)).not.toThrow();
  });

  it("a provider WITHOUT the exception is still correctly refused (the guard isn't globally weakened)", () => {
    // Same shape as AnthropicProvider's descriptor, minus the acknowledgment.
    expect(() =>
      assertCompliantProvider({ kind: "remote", provider: "anthropic:x", region: "global", zeroRetention: false, noTraining: true }),
    ).toThrow(/approved AU region/i);
  });

  it("respects PF_ANTHROPIC_MODEL / an explicit model override, defaulting to claude-opus-5", () => {
    expect(new AnthropicProvider({ apiKey: "k", acceptNonAuResidency: true }).describe().provider).toBe(
      "anthropic:claude-opus-5",
    );
    expect(
      new AnthropicProvider({ apiKey: "k", model: "claude-sonnet-5", acceptNonAuResidency: true }).describe().provider,
    ).toBe("anthropic:claude-sonnet-5");
  });
});

describe("prompt caching split — stable system prefix vs. varying user turn", () => {
  it("buildRemoteSystemPrompt is IDENTICAL across calls sharing a purpose (the cacheable prefix)", () => {
    const a = buildRemoteSystemPrompt("agent.generate");
    const b = buildRemoteSystemPrompt("agent.generate");
    expect(a).toBe(b);
    expect(a).toMatch(/OUTPUT REQUIREMENTS/);
    expect(a).toMatch(/never invent/i);
  });

  it("buildRemoteUserPrompt carries only the per-call instruction + input, not the contract", () => {
    const user = buildRemoteUserPrompt({
      purpose: "agent.generate",
      prompt: "Draft unit_sequence grounded strictly in the approved sources.",
      input: { topic: "fractions" },
      containsStudentData: false,
    });
    expect(user).toContain("Draft unit_sequence");
    expect(user).toContain("fractions");
    expect(user).not.toContain("OUTPUT REQUIREMENTS");
  });

  it("different purposes get different (still each-internally-stable) system prompts", () => {
    expect(buildRemoteSystemPrompt("content.classify")).not.toBe(buildRemoteSystemPrompt("help.hint"));
  });
});

describe("classifyAnthropicError — SDK failures land in the domain error taxonomy", () => {
  const err = <T extends { new (...args: any[]): AnthropicAPIError }>(
    Ctor: T,
    status: number,
    message: string,
  ): InstanceType<T> =>
    // Anthropic API errors are constructed with (status, error, message, headers).
    new Ctor(status, { message }, message, new Headers()) as InstanceType<T>;

  it("maps operator problems to AI_PROVIDER_MISCONFIGURED (retrying will not help)", () => {
    expect(classifyAnthropicError(err(Anthropic.AuthenticationError, 401, "bad key"))).toMatchObject({
      code: "AI_PROVIDER_MISCONFIGURED",
    });
    expect(classifyAnthropicError(err(Anthropic.PermissionDeniedError, 403, "no access"))).toMatchObject({
      code: "AI_PROVIDER_MISCONFIGURED",
    });
    expect(classifyAnthropicError(err(Anthropic.NotFoundError, 404, "bad model id"))).toMatchObject({
      code: "AI_PROVIDER_MISCONFIGURED",
    });
    expect(classifyAnthropicError(err(Anthropic.BadRequestError, 400, "bad shape"))).toMatchObject({
      code: "AI_PROVIDER_MISCONFIGURED",
    });
  });

  it("maps transient faults (rate limit, 5xx, connection) to AI_PROVIDER_UNAVAILABLE", () => {
    expect(classifyAnthropicError(err(Anthropic.RateLimitError, 429, "slow down"))).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    expect(classifyAnthropicError(err(Anthropic.InternalServerError, 500, "oops"))).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    expect(
      classifyAnthropicError(new Anthropic.APIConnectionError({ message: "network down" })),
    ).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
  });

  it("maps a completely unrecognised throwable to AI_PROVIDER_UNAVAILABLE rather than crashing", () => {
    expect(classifyAnthropicError(new Error("something else"))).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });
});
