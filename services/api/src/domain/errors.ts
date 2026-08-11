/**
 * Domain errors. Each carries a stable `code` so HTTP/UI layers and tests can
 * assert on intent rather than message text.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A validation rule blocked the operation (e.g. bad term dates). */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION", message);
  }
}

/** Operation needs the caller to confirm before proceeding (not a hard block). */
export class ConfirmationRequiredError extends DomainError {
  constructor(
    code: string,
    message: string,
    public readonly confirmationToken: string,
  ) {
    super(code, message);
  }
}

/** Operation is not permitted in the current state (a hard block). */
export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super("NOT_FOUND", message);
  }
}

export class AuthError extends DomainError {
  /**
   * Defaults to the generic "AUTH" code. SSO sign-in passes a specific code
   * (e.g. SSO_DOMAIN_MISMATCH, SSO_ACCESS_REVOKED) so the UI can show a clear,
   * intent-specific message rather than a generic "login failed" (FR-INT-001).
   */
  constructor(message: string, code = "AUTH") {
    super(code, message);
  }
}

/**
 * A dependency the operation needs is temporarily unavailable (e.g. an external
 * identity provider is down). Distinct from an auth failure so the UI can show a
 * clear "service unavailable, try again" message rather than "invalid
 * credentials" (FR-INT-001 — IdP outage).
 */
export class ServiceUnavailableError extends DomainError {
  constructor(message: string, code = "SERVICE_UNAVAILABLE") {
    super(code, message);
  }
}

/**
 * A chosen brand colour fails the WCAG-AA contrast floor (FR-WL-001). Carries an
 * accessible `suggestion` so the UI can offer an auto-adjusted alternative rather
 * than silently accepting an inaccessible colour.
 */
export class BrandContrastError extends DomainError {
  constructor(
    message: string,
    public readonly suggestion: string,
    public readonly contrastWhite: number,
    public readonly contrastBlack: number,
  ) {
    super("BRAND_CONTRAST_FAILED", message);
  }
}
