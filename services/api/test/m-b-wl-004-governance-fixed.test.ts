import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";
import { newId } from "../src/platform/ids";
import { passesAA } from "../src/domain/branding";
import { GOVERNANCE_TOKENS } from "../src/platform/designSystem/tokens";

/**
 * Appendix Milestone B — FR-WL-004: governance-critical visual states stay fixed
 * regardless of branding; override requests are declined; the WCAG-AA floor is
 * enforced server-side regardless of the school's choice.
 */
describe("FR-WL-004 — governance visual states remain fixed", () => {
  it("happy path: with a brand colour applied, governance chips still render with fixed platform tokens, never the brand colour", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);
    await ctx.branding.configureBranding(school.id, { primaryColor: "#1d4ed8" }, admin.user.id);

    const b = await ctx.branding.forSurface(school.id, "user");

    // The resolved branding carries the exact frozen governance token set.
    expect(b.governance).toBe(GOVERNANCE_TOKENS);
    expect(Object.isFrozen(b.governance)).toBe(true);
    expect(b.governance.draft.bg).toBe("status.draft.bg");
    expect(b.governance.approved.bg).toBe("status.approved.bg");
    expect(b.governance.lockedComputed.bg).toBe("status.locked.bg");

    // No governance token value is ever the school's brand colour.
    const govValues = Object.values(b.governance).flatMap((t) => Object.values(t));
    expect(govValues).not.toContain(b.primaryColor);
  });

  it("a school's request to recolour a governance status is declined by design", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);
    await expect(
      ctx.branding.requestGovernanceOverride(school.id, "approved", admin.user.id),
    ).rejects.toMatchObject({ code: "GOVERNANCE_TOKENS_FIXED" });
  });

  it("accessibility floor: even a stored non-AA colour is clamped server-side, and governance stays fixed", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    // Force an inaccessible colour straight into the store, bypassing configure's
    // validation, to prove the floor is ALSO enforced at resolve time.
    await ctx.brandingStore.saveBrandingConfig({
      schoolId: school.id,
      productName: school.name,
      primaryColor: "#8ecae6", // fails white-on-primary AA
      accentColor: "#000000",
      whiteLabelEnabled: false,
      logoKey: null,
      logoFormat: null,
      configuredBy: admin.user.id,
      updatedAt: ctx.clock.isoNow(),
    });

    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.primaryColor).not.toBe("#8ecae6");
    expect(passesAA(b.primaryColor)).toBe(true);
    // Governance tokens are still the fixed set regardless of the bad brand colour.
    expect(b.governance).toBe(GOVERNANCE_TOKENS);
  });

  it("branding is stored per school (multi-tenant isolation)", async () => {
    const { ctx } = makeHarness();
    const a = await seedSchoolWithAdmin(ctx, `Brand A ${newId()}`);
    const c = await seedSchoolWithAdmin(ctx, `Brand C ${newId()}`);
    await ctx.branding.configureBranding(a.school.id, { primaryColor: "#1d4ed8" }, a.admin.user.id);
    await ctx.branding.configureBranding(c.school.id, { primaryColor: "#7a1f2b" }, c.admin.user.id);

    expect((await ctx.branding.forSurface(a.school.id, "user")).primaryColor).toBe("#1d4ed8");
    expect((await ctx.branding.forSurface(c.school.id, "user")).primaryColor).toBe("#7a1f2b");
  });
});
