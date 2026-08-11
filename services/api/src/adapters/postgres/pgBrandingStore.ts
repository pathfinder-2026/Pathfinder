import type { BrandedReport, BrandingConfig, LogoAsset, ResolvedBranding } from "../../domain/branding";
import type { BrandingStore } from "../../ports/brandingStore";
import { iso, type Sql } from "./pgClient";

/** PostgreSQL BrandingStore adapter (Amazon RDS/Aurora, ap-southeast-2). */
export class PgBrandingStore implements BrandingStore {
  constructor(private readonly sql: Sql) {}

  async getBrandingConfig(schoolId: string): Promise<BrandingConfig | undefined> {
    const r = (await this.sql`select * from branding_configs where school_id=${schoolId}`)[0];
    return r
      ? {
          schoolId: r.school_id, productName: r.product_name, primaryColor: r.primary_color,
          accentColor: r.accent_color, whiteLabelEnabled: r.white_label_enabled,
          logoKey: r.logo_key ?? null, logoFormat: r.logo_format ?? null,
          configuredBy: r.configured_by, updatedAt: iso(r.updated_at),
        }
      : undefined;
  }
  async saveBrandingConfig(c: BrandingConfig): Promise<void> {
    await this.sql`insert into branding_configs
      (school_id,product_name,primary_color,accent_color,white_label_enabled,logo_key,logo_format,configured_by,updated_at)
      values (${c.schoolId},${c.productName},${c.primaryColor},${c.accentColor},${c.whiteLabelEnabled},${c.logoKey},${c.logoFormat},${c.configuredBy},${c.updatedAt})
      on conflict (school_id) do update set product_name=${c.productName},primary_color=${c.primaryColor},
        accent_color=${c.accentColor},white_label_enabled=${c.whiteLabelEnabled},logo_key=${c.logoKey},
        logo_format=${c.logoFormat},configured_by=${c.configuredBy},updated_at=${c.updatedAt}`;
  }

  async putLogoAsset(a: LogoAsset): Promise<void> {
    await this.sql`insert into branding_logo_assets (key,school_id,format,created_at)
      values (${a.key},${a.schoolId},${a.format},${a.createdAt})
      on conflict (key) do update set format=${a.format}`;
  }
  async getLogoAsset(key: string): Promise<LogoAsset | undefined> {
    const r = (await this.sql`select * from branding_logo_assets where key=${key}`)[0];
    return r ? { key: r.key, schoolId: r.school_id, format: r.format, createdAt: iso(r.created_at) } : undefined;
  }
  async deleteLogoAsset(key: string): Promise<void> {
    await this.sql`delete from branding_logo_assets where key=${key}`;
  }

  async insertBrandedReport(report: BrandedReport): Promise<void> {
    await this.sql`insert into branded_reports (id,school_id,kind,branding,payload,issued_at)
      values (${report.id},${report.schoolId},${report.kind},${this.sql.json(report.branding as never)},
        ${this.sql.json((report.payload ?? null) as never)},${report.issuedAt})`;
  }
  async getBrandedReport(id: string): Promise<BrandedReport | undefined> {
    const r = (await this.sql`select * from branded_reports where id=${id}`)[0];
    return r
      ? {
          id: r.id, schoolId: r.school_id, kind: r.kind,
          branding: r.branding as ResolvedBranding, payload: r.payload,
          issuedAt: iso(r.issued_at),
        }
      : undefined;
  }
}
