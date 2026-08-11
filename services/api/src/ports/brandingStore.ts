import type { BrandedReport, BrandingConfig, LogoAsset } from "../domain/branding";

/**
 * Persistence port for white-label branding (Appendix Milestone B). Per-school
 * config, sanitised logo assets, and point-in-time report artifacts. Satisfied
 * by the in-memory adapter (dev/tests) and the PostgreSQL adapter (ap-southeast-2).
 */
export interface BrandingStore {
  getBrandingConfig(schoolId: string): Promise<BrandingConfig | undefined>;
  saveBrandingConfig(config: BrandingConfig): Promise<void>;

  putLogoAsset(asset: LogoAsset): Promise<void>;
  getLogoAsset(key: string): Promise<LogoAsset | undefined>;
  deleteLogoAsset(key: string): Promise<void>;

  insertBrandedReport(report: BrandedReport): Promise<void>;
  getBrandedReport(id: string): Promise<BrandedReport | undefined>;
}
