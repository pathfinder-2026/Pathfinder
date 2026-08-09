import { randomUUID, randomBytes } from "node:crypto";

/** Structural identifiers. */
export function newId(): string {
  return randomUUID();
}

/** Opaque, URL-safe tokens (invite tokens, session tokens). */
export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
