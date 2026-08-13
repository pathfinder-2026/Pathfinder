import postgres, { type Sql } from "postgres";

/**
 * postgres-js client for the PostgreSQL adapters. Must only ever point at an
 * in-AU (ap-southeast-2) instance (Foundational Decision 1).
 */
export function createSql(connectionString = process.env.DATABASE_URL): Sql {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (point it only at an ap-southeast-2 PostgreSQL).");
  }
  // Cap the pool well below Supabase's session-mode pooler limit (15 clients
  // TOTAL across every consumer of the pooler). postgres-js defaults to
  // max: 10 per process — two processes (e.g. a dev API + the hosted API on
  // the same project) at defaults exceed the cap under parallel query bursts
  // and every request starts failing with EMAXCONNSESSION. Override via
  // PF_PG_POOL_MAX when a deployment owns the pooler outright.
  const max = Number(process.env.PF_PG_POOL_MAX ?? 5);
  return postgres(connectionString, { onnotice: () => {}, max });
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
