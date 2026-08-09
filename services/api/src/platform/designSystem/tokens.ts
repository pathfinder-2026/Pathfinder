/**
 * Design-system token separation (Foundational Decision 5), established on the
 * very first UI-relevant work so FR-WL-004 (white-label) is a property, not a
 * retrofit.
 *
 *  - GOVERNANCE tokens (draft / approved / published / locked-computed) are
 *    fixed platform-wide and NON-OVERRIDABLE. They are deep-frozen here; the
 *    white-label layer (Appendix B) is not permitted to touch them.
 *  - BRAND tokens (colour, logo, product name) are the ONLY surface the
 *    white-label layer may theme.
 *
 * `themeTokens` merges brand overrides only; any attempt to override a
 * governance token via the brand channel is ignored.
 */

export interface GovernanceStateToken {
  label: string;
  /** Semantic colour role names — fixed, not brand colours. */
  fg: string;
  bg: string;
  border: string;
}

export interface GovernanceTokens {
  draft: GovernanceStateToken;
  approved: GovernanceStateToken;
  published: GovernanceStateToken;
  /** Computed results a user must not hand-edit (e.g. peer benchmarks later). */
  lockedComputed: GovernanceStateToken;
}

export interface BrandTokens {
  productName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
}

function deepFreeze<T>(obj: T): T {
  Object.getOwnPropertyNames(obj as object).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (value && typeof value === "object") deepFreeze(value);
  });
  return Object.freeze(obj);
}

/** Fixed governance tokens. Deep-frozen: mutation attempts throw in strict mode. */
export const GOVERNANCE_TOKENS: GovernanceTokens = deepFreeze({
  draft: { label: "Draft", fg: "status.draft.fg", bg: "status.draft.bg", border: "status.draft.border" },
  approved: {
    label: "Approved",
    fg: "status.approved.fg",
    bg: "status.approved.bg",
    border: "status.approved.border",
  },
  published: {
    label: "Published",
    fg: "status.published.fg",
    bg: "status.published.bg",
    border: "status.published.border",
  },
  lockedComputed: {
    label: "Computed",
    fg: "status.locked.fg",
    bg: "status.locked.bg",
    border: "status.locked.border",
  },
});

/** Default brand tokens, overridable per white-label tenant. */
export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  productName: "Pathfinder",
  logoUrl: "/assets/pathfinder-logo.svg",
  primaryColor: "#1d4ed8",
  accentColor: "#0891b2",
};

export interface ThemedTokens {
  governance: GovernanceTokens;
  brand: BrandTokens;
}

/**
 * Produce the effective token set for a tenant. Only brand tokens may be
 * overridden; governance tokens are always the fixed, frozen set.
 */
export function themeTokens(brandOverrides: Partial<BrandTokens> = {}): ThemedTokens {
  return {
    governance: GOVERNANCE_TOKENS,
    brand: { ...DEFAULT_BRAND_TOKENS, ...brandOverrides },
  };
}
