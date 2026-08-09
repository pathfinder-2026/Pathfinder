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
  constructor(message: string) {
    super("AUTH", message);
  }
}
