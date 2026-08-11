import { describe, expect, it } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/**
 * Appendix Milestone B — FR-WL-003: branding applied consistently across app,
 * PDF reports and notification emails; reports are point-in-time; a failed logo
 * falls back to text.
 */
describe("FR-WL-003 — consistent branding across app, reports, emails", () => {
  it("happy path: the same brand colour + logo appear in-app, in an exported report, and in a notification email", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    await ctx.branding.configureBranding(school.id, { primaryColor: "#1d4ed8" }, admin.user.id);
    await ctx.branding.uploadLogo(school.id, { format: "png", sizeBytes: 4096 }, admin.user.id);

    const app = await ctx.branding.forSurface(school.id, "user");
    const report = await ctx.branding.issueReport(school.id, "term-report", { term: "T1" }, admin.user.id);
    const email = await ctx.branding.brandNotification(school.id, { subject: "Report ready", body: "..." });

    // One resolver, so all three surfaces match.
    expect(report.branding.primaryColor).toBe(app.primaryColor);
    expect(email.branding.primaryColor).toBe(app.primaryColor);
    expect(report.branding.logo.url).toBe(app.logo.url);
    expect(email.header.logoUrl).toBe(app.logo.url);
  });

  it("branding changed after a report was generated: reopening it is not retroactively rebranded", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    await ctx.branding.configureBranding(school.id, { primaryColor: "#1d4ed8" }, admin.user.id);
    const report = await ctx.branding.issueReport(school.id, "term-report", { term: "T1" }, admin.user.id);
    expect(report.branding.primaryColor).toBe("#1d4ed8");

    // The school later changes its brand colour.
    await ctx.branding.configureBranding(school.id, { primaryColor: "#7a1f2b" }, admin.user.id);

    // The already-generated report keeps the branding it had at generation time.
    const reopened = await ctx.branding.getReport(report.id);
    expect(reopened!.branding.primaryColor).toBe("#1d4ed8");
    // While the live surface reflects the new colour.
    expect((await ctx.branding.forSurface(school.id, "user")).primaryColor).toBe("#7a1f2b");
  });

  it("logo fails to load: a text fallback (school name) is shown rather than a broken image", async () => {
    const { ctx } = makeHarness();
    const { school, admin } = await seedSchoolWithAdmin(ctx);

    await ctx.branding.configureBranding(school.id, { primaryColor: "#1d4ed8" }, admin.user.id);
    const logo = await ctx.branding.uploadLogo(school.id, { format: "png", sizeBytes: 4096 }, admin.user.id);
    expect((await ctx.branding.forSurface(school.id, "user")).logo.available).toBe(true);

    // The logo asset becomes unavailable (file lost).
    await ctx.brandingStore.deleteLogoAsset(logo.key);

    const b = await ctx.branding.forSurface(school.id, "user");
    expect(b.logo.available).toBe(false);
    const email = await ctx.branding.brandNotification(school.id, { subject: "Hi", body: "..." });
    expect(email.header.logoUrl).toBeNull();
    expect(email.header.text).toBe(school.name);
  });
});
