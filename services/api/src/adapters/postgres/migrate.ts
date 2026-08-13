import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSql } from "./pgClient";

/**
 * Migration runner: applies db/migrations/*.sql in filename order against the
 * database in PF_DATABASE_URL (or DATABASE_URL) — e.g. a Supabase project in
 * ap-southeast-2 (Sydney). Run via `npm run db:migrate --workspace services/api`.
 *
 * Idempotent across runs: a `schema_migrations` table records each applied
 * file, so re-running applies only what's new (the same .sql files the
 * embedded-Postgres suites apply from scratch on every test run). Each file
 * runs inside its own transaction — a failure rolls that file back, reports
 * it, and stops without touching later files.
 */
async function main(): Promise<void> {
  const url = process.env.PF_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set PF_DATABASE_URL (or DATABASE_URL) to the target PostgreSQL connection string.");
    console.error("Residency: point it ONLY at an ap-southeast-2 (Sydney) instance — Foundational Decision 1.");
    process.exit(2);
  }
  // Never print the URL: it carries the database password.
  const host = (() => { try { return new URL(url).hostname; } catch { return "<unparseable-url>"; } })();
  console.log(`Applying migrations to ${host} …`);

  const sql = createSql(url);
  try {
    await sql`create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set((await sql`select filename from schema_migrations`).map((r) => r.filename as string));

    const migDir = fileURLToPath(new URL("../../../../../db/migrations", import.meta.url));
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }
      const ddl = readFileSync(path.join(migDir, file), "utf8");
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(ddl);
          await tx`insert into schema_migrations (filename) values (${file})`;
        });
        console.log(`  apply  ${file}`);
        ran += 1;
      } catch (error) {
        console.error(`  FAILED ${file}: ${(error as Error).message}`);
        console.error("Rolled back this file; later migrations were not attempted.");
        process.exitCode = 1;
        return;
      }
    }
    console.log(`Done: ${ran} applied, ${files.length - ran} already up to date (${files.length} total).`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Migration run crashed:", (error as Error).message);
  process.exit(1);
});
