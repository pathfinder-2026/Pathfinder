/**
 * Appendix (Milestone A) — Single sign-on domain (FR-ADM-003 SSO config,
 * FR-INT-001 sign-in).
 *
 * A school configures SSO for exactly one identity provider and one email
 * domain (the MVP shape). Sign-in is only ever honoured for an email inside that
 * domain — a mismatch is denied with a clear, specific message. The identity
 * provider itself is reached through the IdentityProviderPort so an outage or an
 * upstream-revoked account are deterministic and testable without a network.
 */

/** The two providers in MVP scope (per the plan): Google Workspace / MS Entra ID. */
export type SsoProvider = "google" | "microsoft";

export function isSsoProvider(v: string): v is SsoProvider {
  return v === "google" || v === "microsoft";
}

/** Human label for messages (e.g. the outage / configure copy). */
export function providerLabel(p: SsoProvider): string {
  return p === "google" ? "Google Workspace" : "Microsoft Entra ID";
}

/** Per-school SSO configuration. One provider + one permitted email domain. */
export interface SsoConfig {
  schoolId: string;
  provider: SsoProvider;
  /** Permitted email domain, e.g. "school.edu" (stored lower-cased, no "@"). */
  domain: string;
  configuredBy: string;
  configuredAt: string;
}

/**
 * An opaque SSO assertion. In production this is the verified OIDC token from
 * Google/Microsoft; in MVP the port trusts the email it carries (real token
 * verification is deferred — see docs/decisions.md ADR-0029).
 */
export interface SsoAssertion {
  email: string;
}

/** The lower-cased domain part of an email address, or "" if malformed. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/** Normalise a configured domain: trim, drop a leading "@", lower-case. */
export function normaliseDomain(domain: string): string {
  return domain.trim().replace(/^@/, "").toLowerCase();
}
