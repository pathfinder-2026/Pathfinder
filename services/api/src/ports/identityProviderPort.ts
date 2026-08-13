/**
 * Appendix (Milestone A) — Identity Provider port (FR-INT-001).
 *
 * The seam between Pathfinder and an external SSO IdP (Google Workspace /
 * Microsoft Entra ID). Production verifies a real OIDC token and calls the
 * provider's directory API; that live integration is deferred (no AWS/Google
 * creds in this environment — see docs/decisions.md ADR-0029), mirroring the
 * Bedrock deferral (ADR-0013).
 *
 * The default `LocalIdentityProvider` is deterministic and network-free so the
 * two FR-INT-001 edge cases — IdP outage and an upstream-revoked account — are
 * fully testable. It is the identity analogue of LocalClassifierProvider.
 */

import { ServiceUnavailableError } from "../domain/errors";
import { providerLabel, type SsoAssertion, type SsoProvider } from "../domain/sso";

/** The upstream account state the IdP reports for an authenticated identity. */
export interface IdpAccountState {
  email: string;
  /** False when the organisation has suspended/revoked the account upstream. */
  active: boolean;
}

export interface IdentityProviderPort {
  /**
   * Resolve an SSO assertion to the upstream account state. Throws
   * ServiceUnavailableError when the provider is unreachable (outage) so the
   * caller can surface a clear "try again" message rather than a login failure.
   */
  resolve(provider: SsoProvider, assertion: SsoAssertion): Promise<IdpAccountState>;
}

/**
 * Deterministic, in-memory IdP. Backs dev and the whole test suite in both
 * store backends (like the audit recorder, it stays in-memory even under the
 * Postgres suite). Tests drive the two edge cases via `setOutage` / `suspend`.
 */
export class LocalIdentityProvider implements IdentityProviderPort {
  private readonly outages = new Set<SsoProvider>();
  private readonly suspended = new Set<string>();

  /** Simulate the provider being up (`down=false`) or down (`down=true`). */
  setOutage(provider: SsoProvider, down: boolean): void {
    if (down) this.outages.add(provider);
    else this.outages.delete(provider);
  }

  /** Mark an email as suspended/revoked by the upstream organisation. */
  suspend(email: string): void {
    this.suspended.add(email.trim().toLowerCase());
  }

  /** Restore a previously-suspended email. */
  restore(email: string): void {
    this.suspended.delete(email.trim().toLowerCase());
  }

  async resolve(provider: SsoProvider, assertion: SsoAssertion): Promise<IdpAccountState> {
    if (this.outages.has(provider)) {
      throw new ServiceUnavailableError(
        `${providerLabel(provider)} sign-in is temporarily unavailable. Please try again shortly.`,
        "SSO_IDP_UNAVAILABLE",
      );
    }
    const email = assertion.email.trim();
    return { email, active: !this.suspended.has(email.toLowerCase()) };
  }
}
