import type { BrandedReport, BrandingConfig, LogoAsset } from "../../domain/branding";
import type { BrandingStore } from "../../ports/brandingStore";

/** In-memory BrandingStore for dev and the fast test suite. */
export class InMemoryBrandingStore implements BrandingStore {
  private configs = new Map<string, BrandingConfig>();
  private logos = new Map<string, LogoAsset>();
  private reports = new Map<string, BrandedReport>();

  private static clone<T>(v: T): T {
    return structuredClone(v);
  }

  async getBrandingConfig(schoolId: string): Promise<BrandingConfig | undefined> {
    const c = this.configs.get(schoolId);
    return c ? InMemoryBrandingStore.clone(c) : undefined;
  }
  async saveBrandingConfig(config: BrandingConfig): Promise<void> {
    this.configs.set(config.schoolId, InMemoryBrandingStore.clone(config));
  }

  async putLogoAsset(asset: LogoAsset): Promise<void> {
    this.logos.set(asset.key, InMemoryBrandingStore.clone(asset));
  }
  async getLogoAsset(key: string): Promise<LogoAsset | undefined> {
    const a = this.logos.get(key);
    return a ? InMemoryBrandingStore.clone(a) : undefined;
  }
  async deleteLogoAsset(key: string): Promise<void> {
    this.logos.delete(key);
  }

  async insertBrandedReport(report: BrandedReport): Promise<void> {
    this.reports.set(report.id, InMemoryBrandingStore.clone(report));
  }
  async getBrandedReport(id: string): Promise<BrandedReport | undefined> {
    const r = this.reports.get(id);
    return r ? InMemoryBrandingStore.clone(r) : undefined;
  }
}
