import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Production database client (Amazon RDS/Aurora PostgreSQL, ap-southeast-2 —
 * Foundational Decision 1). Not exercised in the Milestone 0 test suite, which
 * runs entirely against the in-memory store; this exists so the schema and
 * migrations have a real, type-checked binding ready for when the AU database
 * is provisioned.
 *
 * A full Postgres DataStore adapter is deferred until that provisioning (see
 * docs/decisions.md, ADR-0007); the Drizzle schema + SQL migrations are the
 * schema of record in the meantime.
 */
export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it only at an in-AU (ap-southeast-2) PostgreSQL instance.",
    );
  }
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export { schema };
