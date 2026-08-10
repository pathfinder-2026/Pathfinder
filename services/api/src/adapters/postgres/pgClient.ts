import postgres, { type Sql } from "postgres";

/**
 * postgres-js client for the PostgreSQL adapters. Must only ever point at an
 * in-AU (ap-southeast-2) instance (Foundational Decision 1).
 */
export function createSql(connectionString = process.env.DATABASE_URL): Sql {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (point it only at an ap-southeast-2 PostgreSQL).");
  }
  return postgres(connectionString, { onnotice: () => {} });
}

/** Timestamptz (Date) -> domain ISO string. */
export function iso(value: Date | string | null): string {
  if (value === null) return "";
  return value instanceof Date ? value.toISOString() : value;
}

export function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export type { Sql };
