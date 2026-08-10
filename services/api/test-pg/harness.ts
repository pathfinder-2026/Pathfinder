import EmbeddedPostgres from "embedded-postgres";
import type pg from "pg";
import { rmSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Boots a real (embedded) PostgreSQL cluster and applies db/migrations in order.
 * Used by the real-Postgres integration tests that verify the DB-enforced
 * governance guarantees the in-memory adapter can only simulate (Decision 3).
 */
export interface PgHarness {
  client: pg.Client;
  stop: () => Promise<void>;
}

export async function startPgWithMigrations(port = 5433): Promise<PgHarness> {
  const dataDir = path.join(tmpdir(), `pathfinder-pgtest-${port}`);
  // Clean any stale datadir from a crashed run before initialise().
  rmSync(dataDir, { recursive: true, force: true });

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "password",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("pathfinder");

  const client = postgres.getPgClient("pathfinder");
  await client.connect();

  const migDir = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
  const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.query(readFileSync(path.join(migDir, file), "utf8"));
  }

  return {
    client,
    stop: async () => {
      await client.end();
      await postgres.stop();
    },
  };
}
