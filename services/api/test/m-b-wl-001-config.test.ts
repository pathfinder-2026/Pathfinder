import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";
import { passesAA } from "../src/domain/branding";
import { DEFAULT_BRAND_TOKENS } from "../src/platform/designSystem/tokens";

/**
 * Appendix Milestone B — FR-WL-001: configure brand colour, logo and favicon.
 * One test per Given/When/Then row (incl. the NEW v1.4 active-content edge).
 */
describe("FR-WL-001 — configure brand colour + logo", () => {
  it("happy path: a contrast-passing colour and a logo are saved and applied immediately", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    const cfg = await ctx.branding.configureBranding(school.id, { primaryColor: "#1d4ed8" }, admin.user.id);
    expect(cfg.primaryColor).toBe("#1d4ed8");
    const logo = await ctx.branding.uploadLogo(school.id, { format: "png", sizeBytes: 4096 }, admin.user.id);

    // Applied across the instance immediately (resolve reflects it right away).
    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.primaryColor).toBe("#1d4ed8");
    expect(b.logo.available).toBe(true);
    expect(b.logo.url).toContain(`/branding/logo/${logo.key}`);
  });

  it("colour fails contrast: warns and offers an auto-adjusted alternative rather than silently accepting", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    const preview = ctx.branding.previewBrandColor("#8ecae6"); // too light for white text
    expect(preview.ok).toBe(false);
    expect(passesAA(preview.suggestion)).toBe(true);

    const err = await ctx.branding.configureBranding(school.id, { primaryColor: "#8ecae6" }, admin.user.id).catch((e) => e);
    expect(err.code).toBe("BRAND_CONTRAST_FAILED");
    expect(passesAA(err.suggestion)).toBe(true);

    // Not silently accepted — nothing inaccessible was stored.
    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.primaryColor).toBe(DEFAULT_BRAND_TOKENS.primaryColor);

    // Accepting the suggested alternative succeeds.
    const cfg = await ctx.branding.configureBranding(school.id, { primaryColor: err.suggestion }, admin.user.id);
    expect(cfg.primaryColor).toBe(err.suggestion);
  });

  it("no branding configured: default Pathfinder branding is shown, not a broken/empty state", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);

    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.displayName).toBe("Pathfinder");
    expect(b.primaryColor).toBe(DEFAULT_BRAND_TOKENS.primaryColor);
    expect(b.logo.available).toBe(false);
    expect(b.showAttribution).toBe(true);
  });

  it("active content in a logo file (NEW v1.4): an SVG with scripts/handlers is rejected; only safe content is stored", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    const scripted = `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('//evil')</script></svg>`;
    await expect(
      ctx.branding.uploadLogo(school.id, { format: "svg", sizeBytes: 512, svgSource: scripted }, admin.user.id),
    ).rejects.toMatchObject({ code: "LOGO_ACTIVE_CONTENT" });

    const handler = `<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"><rect/></svg>`;
    await expect(
      ctx.branding.uploadLogo(school.id, { format: "svg", sizeBytes: 512, svgSource: handler }, admin.user.id),
    ).rejects.toMatchObject({ code: "LOGO_ACTIVE_CONTENT" });

    // Nothing was stored by the rejected uploads.
    expect((await ctx.branding.forSurface(school.id, "user")).logo.available).toBe(false);

    // A clean SVG (no active content) is accepted and stored.
    const clean = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123"/></svg>`;
    const ok = await ctx.branding.uploadLogo(school.id, { format: "svg", sizeBytes: 512, svgSource: clean }, admin.user.id);
    expect(ok.format).toBe("svg");
    expect((await ctx.branding.forSurface(school.id, "user")).logo.available).toBe(true);
  });

  it("a malware-flagged raster logo is rejected by the security scan", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);
    await expect(
      ctx.branding.uploadLogo(school.id, { format: "png", sizeBytes: 2048, malware: true }, admin.user.id),
    ).rejects.toMatchObject({ code: "LOGO_INFECTED" });
  });
});
