import { startPgWithMigrations, type PgHarness } from "./harness";

/**
 * Vitest globalSetup for the "acceptance suite against Postgres" run. Boots one
 * embedded PostgreSQL cluster (port 5439) and applies the migrations; the test
 * workers connect via DATABASE_URL (set in vitest.pg-suite.config.ts).
 */
let harness: PgHarness | undefined;

export async function setup(): Promise<void> {
  harness = await startPgWithMigrations(5439);
}

export async function teardown(): Promise<void> {
  await harness?.stop();
}
