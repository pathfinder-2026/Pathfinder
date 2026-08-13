import { AuthError, NotFoundError, ValidationError } from "../domain/errors";
import {
  domainOf,
  isSsoProvider,
  normaliseDomain,
  providerLabel,
  type SsoAssertion,
  type SsoConfig,
  type SsoProvider,
} from "../domain/sso";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newToken } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";
import type { IdentityProviderPort } from "../ports/identityProviderPort";

export interface ConfigureSsoInput {
  provider: SsoProvider;
  /** The single email domain permitted to sign in, e.g. "school.edu". */
  domain: string;
}

export interface SsoLoginResult {
  token: string;
  userId: string;
}

/**
 * Appendix (Milestone A) — FR-ADM-003 SSO configuration + FR-INT-001 sign-in.
 *
 * A school federates with one provider (Google Workspace / Microsoft Entra ID)
 * for one email domain. Sign-in enforces three edge cases the plan calls out:
 *   - an email OUTSIDE the configured domain is denied with a clear, specific
 *     message (not a generic failure);
 *   - a provider OUTAGE surfaces as a service-unavailable error (thrown by the
 *     IdentityProviderPort), never "invalid credentials";
 *   - an account REVOKED upstream is denied AND its cached sessions are purged,
 *     so a stale session cannot keep working.
 */
export class SsoService {
  constructor(
    private readonly store: DataStore,
    private readonly idp: IdentityProviderPort,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Configure (or update) SSO for a school. */
  async configure(schoolId: string, input: ConfigureSsoInput, actorId: string | null = null): Promise<SsoConfig> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    if (!isSsoProvider(input.provider)) {
      throw new ValidationError("SSO provider must be 'google' or 'microsoft'.");
    }
    const domain = normaliseDomain(input.domain ?? "");
    if (!domain || !domain.includes(".")) throw new ValidationError("A valid SSO email domain is required.");

    const config: SsoConfig = {
      schoolId,
      provider: input.provider,
      domain,
      configuredBy: actorId ?? "system",
      configuredAt: this.clock.isoNow(),
    };
    await this.store.saveSsoConfig(config);
    this.audit.append({
      action: "sso.configured",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { provider: config.provider, domain: config.domain },
    });
    return config;
  }

  getConfig(schoolId: string): Promise<SsoConfig | undefined> {
    return this.store.getSsoConfig(schoolId);
  }

  /**
   * Sign in via SSO. The assertion is the (already provider-authenticated)
   * identity; we enforce the domain, resolve the Pathfinder account, and issue a
   * session — no password is created or required (FR-INT-001 happy path).
   */
  async signIn(schoolId: string, provider: SsoProvider, assertion: SsoAssertion): Promise<SsoLoginResult> {
    const config = await this.store.getSsoConfig(schoolId);
    if (!config) {
      throw new AuthError("Single sign-on is not configured for this school.", "SSO_NOT_CONFIGURED");
    }
    if (config.provider !== provider) {
      throw new AuthError(
        `This school signs in with ${providerLabel(config.provider)}, not ${providerLabel(provider)}.`,
        "SSO_PROVIDER_MISMATCH",
      );
    }

    // May throw ServiceUnavailableError on an IdP outage — deliberately NOT
    // caught, so the caller shows a clear "try again" message (FR-INT-001).
    const upstream = await this.idp.resolve(provider, assertion);
    const email = upstream.email.trim();
    const emailDomain = domainOf(email);

    if (emailDomain !== config.domain) {
      this.audit.append({
        action: "sso.signin.denied",
        actorId: null,
        subjectType: "school",
        subjectId: schoolId,
        metadata: { reason: "domain_mismatch", emailDomain, expected: config.domain },
      });
      throw new AuthError(
        `Access denied: this ${providerLabel(provider)} account is outside your school's permitted sign-in domain (${config.domain}).`,
        "SSO_DOMAIN_MISMATCH",
      );
    }

    const userId = await this.store.findUserIdByEmail(email);
    const user = userId ? await this.store.getUser(userId) : undefined;
    if (!userId || !user) {
      this.audit.append({
        action: "sso.signin.denied",
        actorId: null,
        subjectType: "school",
        subjectId: schoolId,
        metadata: { reason: "no_account" },
      });
      throw new AuthError(
        "No Pathfinder account matches this single sign-on identity. Ask your administrator to add you.",
        "SSO_NO_ACCOUNT",
      );
    }

    // Upstream revocation: deny AND purge any cached sessions so a stale session
    // cannot keep working (FR-INT-001 — access revoked upstream).
    if (!upstream.active) {
      await this.store.deleteSessionsByUser(userId);
      this.audit.append({
        action: "sso.access.revoked",
        actorId: userId,
        subjectType: "user",
        subjectId: userId,
        metadata: { reason: "upstream_revoked", sessionsRevoked: true },
      });
      throw new AuthError(
        "Access has been revoked by your organisation. Please contact your administrator.",
        "SSO_ACCESS_REVOKED",
      );
    }

    if (user.status !== "active") {
      throw new AuthError("This account is not active.", "SSO_ACCOUNT_INACTIVE");
    }

    const token = newToken(32);
    await this.store.insertSession({ token, userId, createdAt: this.clock.isoNow() });
    this.audit.append({
      action: "auth.sso.login",
      actorId: userId,
      subjectType: "user",
      subjectId: userId,
      metadata: { provider },
    });
    return { token, userId };
  }
}
