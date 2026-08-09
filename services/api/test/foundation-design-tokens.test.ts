import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_TOKENS,
  GOVERNANCE_TOKENS,
  themeTokens,
} from "../src/platform/designSystem/tokens";

/**
 * Foundational Decision 5 — fixed governance tokens vs. themeable brand tokens.
 * Governance tokens are non-overridable platform-wide; brand tokens are the
 * only surface the white-label layer may touch.
 */
describe("Foundation — design-system token separation", () => {
  it("governance tokens are deep-frozen (non-overridable)", () => {
    expect(Object.isFrozen(GOVERNANCE_TOKENS)).toBe(true);
    expect(Object.isFrozen(GOVERNANCE_TOKENS.draft)).toBe(true);
    expect(() => {
      (GOVERNANCE_TOKENS as unknown as Record<string, unknown>)["draft"] = {};
    }).toThrow(TypeError);
  });

  it("theming overrides brand tokens only", () => {
    const themed = themeTokens({ primaryColor: "#000000", productName: "Acme Learn" });
    expect(themed.brand.primaryColor).toBe("#000000");
    expect(themed.brand.productName).toBe("Acme Learn");
    // Unspecified brand tokens fall back to defaults.
    expect(themed.brand.accentColor).toBe(DEFAULT_BRAND_TOKENS.accentColor);
  });

  it("brand overrides cannot alter governance tokens", () => {
    const themed = themeTokens({
      // A malicious attempt to override a governance token via the brand channel.
      draft: { label: "Approved-looking" },
    } as never);
    expect(themed.governance).toBe(GOVERNANCE_TOKENS);
    expect(themed.governance.draft.label).toBe("Draft");
  });
});
