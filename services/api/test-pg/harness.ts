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
    // initdb/postgres logs are very noisy — opt in via PF_PG_DEBUG=1. Errors
    // are always surfaced: a silent failed boot is far costlier than noise.
    onLog: process.env.PF_PG_DEBUG ? (msg) => console.log("[embedded-pg]", msg) : () => {},
    onError: (err) => console.error("[embedded-pg]", err),
  });
  await postgres.initialise();
  await postgres.start();

  // From here the cluster process is live: any failure (createDatabase, connect,
  // a bad migration) must stop it before rethrowing, or it leaks and holds the
  // port + data dir hostage for every subsequent run.
  let client: pg.Client | undefined;
  try {
    await postgres.createDatabase("pathfinder");
    client = postgres.getPgClient("pathfinder");
    await client.connect();

    const migDir = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await client.query(readFileSync(path.join(migDir, file), "utf8"));
    }
  } catch (error) {
    await client?.end().catch(() => {});
    await postgres.stop().catch(() => {});
    throw error;
  }

  const ready = client;
  if (!ready) throw new Error("unreachable: client is initialised above or the catch rethrew");
  return {
    client: ready,
    stop: async () => {
      await ready.end();
      await postgres.stop();
    },
  };
}
