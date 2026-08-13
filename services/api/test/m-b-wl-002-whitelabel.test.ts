import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/**
 * Appendix Milestone B — FR-WL-002: full white-label (display-name override,
 * remove attribution). Presentation-layer only; internal tooling keeps the real
 * Pathfinder identity; reverting is not retroactive.
 */
describe("FR-WL-002 — full white-label mode", () => {
  it("happy path: with full white-label on, the school's name appears and no Pathfinder attribution shows on user surfaces", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    await ctx.branding.configureBranding(school.id, { productName: "Acme Learn", whiteLabelEnabled: true }, admin.user.id);

    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.displayName).toBe("Acme Learn");
    expect(b.showAttribution).toBe(false);
    expect(b.whiteLabel).toBe(true);
  });

  it("internal support tooling still shows the real Pathfinder identity (override is presentation-layer only)", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);
    await ctx.branding.configureBranding(school.id, { productName: "Acme Learn", whiteLabelEnabled: true }, admin.user.id);

    const internal = await ctx.branding.forSurface(school.id, "internal");
    expect(internal.displayName).toBe("Pathfinder");
    expect(internal.showAttribution).toBe(true);
    expect(internal.whiteLabel).toBe(false);
  });

  it("reverting to co-branded: attribution + Pathfinder name reappear going forward, with no retroactive change to reports already issued", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    await ctx.branding.configureBranding(school.id, { productName: "Acme Learn", whiteLabelEnabled: true }, admin.user.id);
    // A report issued WHILE white-label was on.
    const issued = await ctx.branding.issueReport(school.id, "term-report", { term: "T1" }, admin.user.id);
    expect(issued.branding.displayName).toBe("Acme Learn");
    expect(issued.branding.whiteLabel).toBe(true);

    // Later the school disables full white-label.
    await ctx.branding.configureBranding(school.id, { whiteLabelEnabled: false }, admin.user.id);

    // Going forward, user surfaces are co-branded again.
    const now = await ctx.branding.forSurface(school.id, "user");
    expect(now.displayName).toBe("Pathfinder");
    expect(now.showAttribution).toBe(true);

    // But the already-issued report is unchanged (point-in-time artifact).
    const reopened = await ctx.branding.getReport(issued.id);
    expect(reopened!.branding.displayName).toBe("Acme Learn");
    expect(reopened!.branding.whiteLabel).toBe(true);
  });
});
