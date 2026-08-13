/**
 * Appendix Milestone B — White-label / multi-tenant branding domain
 * (FR-WL-001..004).
 *
 * Branding is allowed to touch ONLY the themeable brand layer (Foundational
 * Decision 5). The fixed governance tokens (draft / approved / locked-computed)
 * are never reachable from here — `resolveBranding` always returns the frozen
 * GOVERNANCE_TOKENS untouched, and there is no field on any branding input that
 * could set a governance colour.
 *
 * This module is pure: WCAG-AA contrast maths + auto-adjust, SVG active-content
 * detection, and white-label resolution. The service persists config and stamps
 * point-in-time report artifacts on top of it.
 */

import {
  DEFAULT_BRAND_TOKENS,
  GOVERNANCE_TOKENS,
  type GovernanceTokens,
} from "../platform/designSystem/tokens";

// ---- stored config + assets ----

export interface BrandingConfig {
  schoolId: string;
  /** White-label product name (used only when whiteLabelEnabled). */
  productName: string;
  primaryColor: string;
  accentColor: string;
  whiteLabelEnabled: boolean;
  /** Reference to the stored, sanitised logo asset (null until one is uploaded). */
  logoKey: string | null;
  logoFormat: string | null;
  configuredBy: string;
  updatedAt: string;
}

export interface LogoAsset {
  key: string;
  schoolId: string;
  format: string;
  createdAt: string;
}

/** Which audience a surface is rendered for. Internal tooling keeps real identity. */
export type BrandingSurface = "user" | "internal";

export interface ResolvedLogo {
  available: boolean;
  url: string | null;
  format: string | null;
  /** School name shown when there is no logo, or the logo fails to load. */
  fallbackText: string;
}

/**
 * The effective branding for one surface. Everything a web page, a PDF report or
 * a notification email needs, derived from ONE resolver so all three match.
 */
export interface ResolvedBranding {
  schoolId: string;
  surface: BrandingSurface;
  displayName: string;
  primaryColor: string;
  accentColor: string;
  logo: ResolvedLogo;
  /** "Powered by Pathfinder" shown on user surfaces unless full white-label is on. */
  showAttribution: boolean;
  whiteLabel: boolean;
  /** Always the fixed, frozen governance tokens — branding can never alter these. */
  governance: GovernanceTokens;
}

/** A generated, point-in-time report artifact: its branding is frozen at issue. */
export interface BrandedReport {
  id: string;
  schoolId: string;
  kind: string;
  branding: ResolvedBranding;
  payload: unknown;
  issuedAt: string;
}

export const PATHFINDER_PRODUCT_NAME = DEFAULT_BRAND_TOKENS.productName;
export const SAFE_LOGO_FORMATS = ["png", "jpg", "jpeg", "svg"] as const;
export type LogoFormat = (typeof SAFE_LOGO_FORMATS)[number];
export const LOGO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB, matching the image policy

// ---- WCAG 2.2 contrast (Foundational Decision 5 / NFR-A11Y-001 floor) ----

export const WCAG_AA_NORMAL = 4.5;

/**
 * The platform's fixed on-primary text colour. Buttons, header bars, status
 * chips and links render WHITE text/iconography on the brand primary, so the
 * accessibility floor is evaluated for white-on-primary: the brand colour must
 * be dark enough that white text on it clears WCAG AA. (Any solid colour clears
 * AA against black OR white text — the min is ~4.58 — so a "best of both" floor
 * would never reject anything; the meaningful floor is the actual pairing the
 * platform renders. See docs/decisions.md ADR-0030.)
 */
export const ON_PRIMARY_TEXT = "#ffffff";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb / #rrggbb (case-insensitive). Throws on anything else. */
export function parseHex(hex: string): RGB {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG AA for normal text: white text on the brand primary must reach 4.5:1.
 * (See ON_PRIMARY_TEXT — this is the pairing the platform actually renders.)
 */
export function passesAA(hex: string): boolean {
  return contrastRatio(hex, ON_PRIMARY_TEXT) >= WCAG_AA_NORMAL;
}

/**
 * Return an accessible variant of `hex` with the same hue, by darkening toward
 * black until white text on it clears the AA floor (darkening monotonically
 * raises contrast against white). Already-accessible colours are returned
 * unchanged. Black is the guaranteed terminal case (21:1 on white).
 */
export function autoAdjust(hex: string): string {
  if (passesAA(hex)) return toHex(parseHex(hex));
  let { r, g, b } = parseHex(hex);
  for (let i = 0; i < 40; i++) {
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
    const candidate = toHex({ r, g, b });
    if (passesAA(candidate)) return candidate;
  }
  return "#000000";
}

export interface BrandColorValidation {
  ok: boolean;
  color: string;
  contrastWhite: number;
  contrastBlack: number;
  /** An accessible alternative when `ok` is false (else the colour itself). */
  suggestion: string;
}

export function validateBrandColor(hex: string): BrandColorValidation {
  if (!isValidHex(hex)) throw new Error(`Invalid hex colour: ${hex}`);
  const color = toHex(parseHex(hex));
  const contrastWhite = round2(contrastRatio(color, "#ffffff"));
  const contrastBlack = round2(contrastRatio(color, "#000000"));
  const ok = passesAA(color);
  return { ok, color, contrastWhite, contrastBlack, suggestion: ok ? color : autoAdjust(color) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- SVG active-content detection (FR-WL-001, NEW v1.4) ----

const ACTIVE_CONTENT_PATTERNS: RegExp[] = [
  /<script[\s>]/i,
  /<foreignObject[\s>]/i,
  /<iframe[\s>]/i,
  /<embed[\s>]/i,
  /<object[\s>]/i,
  /\son\w+\s*=/i, // event handlers: onload=, onclick=, ...
  /javascript:/i,
  /data:text\/html/i,
  /<!ENTITY/i,
  /<!DOCTYPE[^>]*\[/i, // inline DTD (XXE vector)
  /<set[\s>]/i, // SMIL animation that can trigger script in some engines
  /<animate[\s>]/i,
];

/** True if an SVG source carries scripts / active content that must not be served. */
export function svgHasActiveContent(source: string): boolean {
  return ACTIVE_CONTENT_PATTERNS.some((re) => re.test(source));
}

// ---- resolution ----

/**
 * Resolve the effective branding for a surface.
 *
 *  - `internal` surfaces ALWAYS show the real Pathfinder identity, regardless of
 *    white-label (the override is presentation-layer only — FR-WL-002).
 *  - `user` surfaces show the school's colour + logo when configured; the product
 *    NAME is overridden and the Pathfinder attribution hidden only under full
 *    white-label, otherwise it stays co-branded (FR-WL-002 revert).
 *  - The brand colour is re-clamped to the WCAG-AA floor here regardless of what
 *    was stored (FR-WL-004 accessibility floor, enforced server-side).
 *  - Governance tokens are always the fixed frozen set (FR-WL-004).
 */
export function resolveBranding(
  schoolName: string,
  config: BrandingConfig | undefined,
  surface: BrandingSurface,
  logoAvailable: boolean,
): ResolvedBranding {
  const base: Omit<ResolvedBranding, "displayName" | "showAttribution" | "whiteLabel" | "primaryColor" | "accentColor" | "logo"> = {
    schoolId: config?.schoolId ?? "",
    surface,
    governance: GOVERNANCE_TOKENS,
  };

  // Internal tooling: real Pathfinder identity, never the school's branding.
  if (surface === "internal" || !config) {
    return {
      ...base,
      displayName: PATHFINDER_PRODUCT_NAME,
      primaryColor: DEFAULT_BRAND_TOKENS.primaryColor,
      accentColor: DEFAULT_BRAND_TOKENS.accentColor,
      logo: {
        available: surface === "internal" ? true : false,
        url: surface === "internal" ? DEFAULT_BRAND_TOKENS.logoUrl : null,
        format: null,
        fallbackText: schoolName,
      },
      showAttribution: true,
      whiteLabel: false,
    };
  }

  const whiteLabel = config.whiteLabelEnabled;
  return {
    ...base,
    displayName: whiteLabel ? config.productName : PATHFINDER_PRODUCT_NAME,
    // AA floor enforced server-side regardless of the stored value.
    primaryColor: autoAdjust(config.primaryColor),
    accentColor: config.accentColor,
    logo: {
      available: Boolean(config.logoKey) && logoAvailable,
      url: config.logoKey && logoAvailable ? logoUrl(config.logoKey) : null,
      format: config.logoFormat,
      fallbackText: schoolName,
    },
    showAttribution: !whiteLabel,
    whiteLabel,
  };
}

function logoUrl(key: string): string {
  return `/branding/logo/${key}`;
}

/**
 * The header a branded surface renders: the logo when available, otherwise a
 * text fallback (the school name) — never a broken image (FR-WL-003).
 */
export function brandingHeader(b: ResolvedBranding): { logoUrl: string | null; text: string } {
  return b.logo.available ? { logoUrl: b.logo.url, text: b.displayName } : { logoUrl: null, text: b.logo.fallbackText };
}

export function defaultBrandingConfig(schoolId: string, schoolName: string, configuredBy: string, now: string): BrandingConfig {
  return {
    schoolId,
    productName: schoolName,
    primaryColor: DEFAULT_BRAND_TOKENS.primaryColor,
    accentColor: DEFAULT_BRAND_TOKENS.accentColor,
    whiteLabelEnabled: false,
    logoKey: null,
    logoFormat: null,
    configuredBy,
    updatedAt: now,
  };
}
