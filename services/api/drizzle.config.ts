import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit config. The Postgres schema of record lives in
 * src/adapters/postgres/schema.ts and the hand-written SQL migrations
 * (audit-log grants + hash-chain trigger) live in ../../db/migrations.
 *
 * Foundational Decision 1: the database is a data-bearing service and must
 * run in AU (ap-southeast-2). DATABASE_URL is only ever pointed at an
 * in-region Amazon RDS/Aurora PostgreSQL instance.
 */
export default {
  schema: "./src/adapters/postgres/schema.ts",
  out: "../../db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/pathfinder",
  },
} satisfies Config;
