import {
  BrandContrastError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../domain/errors";
import {
  autoAdjust,
  brandingHeader,
  defaultBrandingConfig,
  isValidHex,
  LOGO_MAX_BYTES,
  resolveBranding,
  SAFE_LOGO_FORMATS,
  svgHasActiveContent,
  validateBrandColor,
  type BrandColorValidation,
  type BrandedReport,
  type BrandingConfig,
  type BrandingSurface,
  type LogoFormat,
  type ResolvedBranding,
} from "../domain/branding";
import type { ContentFileType } from "../domain/content";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { BrandingStore } from "../ports/brandingStore";
import type { DataStore } from "../ports/dataStore";
import type { ScannerPort } from "../ports/scannerPort";

export interface ConfigureBrandingInput {
  primaryColor?: string;
  accentColor?: string;
  /** White-label product name (used only when full white-label is enabled). */
  productName?: string;
  whiteLabelEnabled?: boolean;
}

export interface UploadLogoInput {
  format: string;
  sizeBytes: number;
  /** For SVG uploads: the raw source, inspected for active content (NEW v1.4). */
  svgSource?: string;
  /** Raster uploads are malware-scanned; set in tests to trip the scanner. */
  malware?: boolean;
}

export interface BrandedEmail {
  subject: string;
  body: string;
  branding: ResolvedBranding;
  header: { logoUrl: string | null; text: string };
}

/**
 * Appendix Milestone B — White-label / multi-tenant branding (FR-WL-001..004).
 *
 * Configures per-school brand colour (WCAG-AA validated), logo (sanitised), and
 * full white-label mode; resolves the effective branding for any surface; and
 * stamps point-in-time report artifacts so a later branding change never
 * rebrands an already-issued report. Governance visual states are structurally
 * out of reach — every resolve returns the fixed governance tokens, and an
 * explicit request to override one is declined by design.
 */
export class BrandingService {
  constructor(
    private readonly branding: BrandingStore,
    private readonly store: DataStore,
    private readonly scanner: ScannerPort,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Preview a brand colour without saving — returns the AA verdict + a suggestion. */
  previewBrandColor(hex: string): BrandColorValidation {
    if (!isValidHex(hex)) throw new ValidationError(`Invalid hex colour: ${hex}`);
    return validateBrandColor(hex);
  }

  /**
   * Configure branding. A brand colour that fails the WCAG-AA floor is NOT saved
   * silently — it throws BrandContrastError carrying an accessible suggestion
   * (FR-WL-001). Only brand fields exist here; governance tokens are untouchable.
   */
  async configureBranding(schoolId: string, input: ConfigureBrandingInput, actorId: string | null = null): Promise<BrandingConfig> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");

    const existing =
      (await this.branding.getBrandingConfig(schoolId)) ??
      defaultBrandingConfig(schoolId, school.name, actorId ?? "system", this.clock.isoNow());

    let primaryColor = existing.primaryColor;
    if (input.primaryColor !== undefined) {
      if (!isValidHex(input.primaryColor)) throw new ValidationError(`Invalid hex colour: ${input.primaryColor}`);
      const v = validateBrandColor(input.primaryColor);
      if (!v.ok) {
        throw new BrandContrastError(
          `Brand colour ${v.color} does not meet the WCAG-AA contrast floor. Try ${v.suggestion} instead.`,
          v.suggestion,
          v.contrastWhite,
          v.contrastBlack,
        );
      }
      primaryColor = v.color;
    }
    if (input.accentColor !== undefined && !isValidHex(input.accentColor)) {
      throw new ValidationError(`Invalid hex colour: ${input.accentColor}`);
    }

    const config: BrandingConfig = {
      ...existing,
      primaryColor,
      accentColor: input.accentColor ?? existing.accentColor,
      productName: input.productName?.trim() || existing.productName,
      whiteLabelEnabled: input.whiteLabelEnabled ?? existing.whiteLabelEnabled,
      configuredBy: actorId ?? existing.configuredBy,
      updatedAt: this.clock.isoNow(),
    };
    await this.branding.saveBrandingConfig(config);
    this.audit.append({
      action: "branding.configured",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { whiteLabel: config.whiteLabelEnabled, primaryColor: config.primaryColor },
    });
    return config;
  }

  /**
   * Upload a logo. An SVG carrying scripts/active content is rejected; a raster
   * logo is malware-scanned. Only safe image content is ever stored (FR-WL-001,
   * NEW v1.4).
   */
  async uploadLogo(schoolId: string, input: UploadLogoInput, actorId: string | null = null): Promise<{ key: string; format: LogoFormat }> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");

    const format = input.format.trim().toLowerCase();
    if (!(SAFE_LOGO_FORMATS as readonly string[]).includes(format)) {
      throw new ValidationError(`Unsupported logo format '${input.format}'. Supported: ${SAFE_LOGO_FORMATS.join(", ")}.`);
    }
    if (input.sizeBytes > LOGO_MAX_BYTES) {
      throw new ValidationError(`Logo exceeds the ${LOGO_MAX_BYTES / (1024 * 1024)} MB limit.`);
    }

    if (format === "svg") {
      if (svgHasActiveContent(input.svgSource ?? "")) {
        this.audit.append({
          action: "branding.logo.rejected",
          actorId,
          subjectType: "school",
          subjectId: schoolId,
          metadata: { reason: "active_content", format },
        });
        throw new ConflictError(
          "LOGO_ACTIVE_CONTENT",
          "This SVG contains scripts or active content and cannot be used as a logo. Upload a static image.",
        );
      }
    } else {
      // Raster: malware-scan through the same port the content pipeline uses.
      const verdict = this.scanner.scan({
        key: `logo-scan-${newId()}`,
        fileType: format as ContentFileType,
        sizeBytes: input.sizeBytes,
        contentHash: `logo-${schoolId}`,
        malware: input.malware,
      });
      if (verdict === "infected") {
        this.audit.append({
          action: "branding.logo.rejected",
          actorId,
          subjectType: "school",
          subjectId: schoolId,
          metadata: { reason: "infected", format },
        });
        throw new ConflictError("LOGO_INFECTED", "This logo file failed the security scan and was rejected.");
      }
    }

    const key = `logo-${schoolId}-${newId()}`;
    const now = this.clock.isoNow();
    await this.branding.putLogoAsset({ key, schoolId, format, createdAt: now });

    const existing =
      (await this.branding.getBrandingConfig(schoolId)) ??
      defaultBrandingConfig(schoolId, school.name, actorId ?? "system", now);
    await this.branding.saveBrandingConfig({ ...existing, logoKey: key, logoFormat: format, updatedAt: now });

    this.audit.append({
      action: "branding.logo.uploaded",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { format },
    });
    return { key, format: format as LogoFormat };
  }

  /** Resolve the effective branding for a surface (app/report/email vs internal). */
  async forSurface(schoolId: string, surface: BrandingSurface = "user"): Promise<ResolvedBranding> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const config = await this.branding.getBrandingConfig(schoolId);
    const logoAvailable = config?.logoKey ? Boolean(await this.branding.getLogoAsset(config.logoKey)) : false;
    return resolveBranding(school.name, config, surface, logoAvailable);
  }

  /**
   * Issue a point-in-time report artifact: it snapshots the branding at issue
   * time, so a later branding change (or a white-label revert) never rebrands it
   * (FR-WL-002 / FR-WL-003).
   */
  async issueReport(schoolId: string, kind: string, payload: unknown, actorId: string | null = null): Promise<BrandedReport> {
    const branding = await this.forSurface(schoolId, "user");
    const report: BrandedReport = {
      id: newId(),
      schoolId,
      kind,
      branding,
      payload,
      issuedAt: this.clock.isoNow(),
    };
    await this.branding.insertBrandedReport(report);
    this.audit.append({
      action: "branding.report.issued",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { reportId: report.id, kind, whiteLabel: branding.whiteLabel },
    });
    return report;
  }

  /** Re-open a previously issued report — with its ORIGINAL branding intact. */
  getReport(reportId: string): Promise<BrandedReport | undefined> {
    return this.branding.getBrandedReport(reportId);
  }

  /**
   * Wrap a notification in the school's branding so an email matches the in-app
   * and PDF surfaces (FR-WL-003). Falls back to the school name when the logo is
   * unavailable, never a broken image.
   */
  async brandNotification(schoolId: string, message: { subject: string; body: string }): Promise<BrandedEmail> {
    const branding = await this.forSurface(schoolId, "user");
    return { subject: message.subject, body: message.body, branding, header: brandingHeader(branding) };
  }

  /**
   * A school may ASK to recolour a governance status to match their brand. This
   * is declined by design (FR-WL-004): governance signals are fixed platform-wide.
   */
  async requestGovernanceOverride(schoolId: string, target: string, actorId: string | null = null): Promise<never> {
    this.audit.append({
      action: "branding.governance_override.declined",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { target },
    });
    throw new ConflictError(
      "GOVERNANCE_TOKENS_FIXED",
      "Governance status signals (draft, approved, locked-computed) are fixed platform-wide and cannot be rebranded.",
    );
  }

  /** Expose the AA auto-adjust so callers can accept the suggested colour. */
  suggestAccessibleColor(hex: string): string {
    return autoAdjust(hex);
  }
}
