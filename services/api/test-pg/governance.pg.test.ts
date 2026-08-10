import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startPgWithMigrations, type PgHarness } from "./harness";

/**
 * Real-Postgres governance guarantees (Foundational Decision 3). These prove the
 * behaviours the in-memory audit recorder only *simulates*: the append-only
 * grant model, the immutability triggers, and the hash-chain enforcement.
 */
describe("Postgres governance guarantees", () => {
  let h: PgHarness;
  let client: pg.Client;

  const GENESIS = "0".repeat(64);
  async function insertRow(seq: number, prevHash: string, rowHash: string, asRole?: string) {
    if (asRole) await client.query(`SET ROLE ${asRole}`);
    try {
      await client.query(
        `INSERT INTO audit_log (id, seq, at, action, actor_id, subject_type, subject_id, metadata, prev_hash, row_hash)
         VALUES ($1,$2, now(), 'test.action', null, 'test', 't1', '{}', $3, $4)`,
        [`row-${seq}-${rowHash}`, seq, prevHash, rowHash],
      );
    } finally {
      if (asRole) await client.query("RESET ROLE");
    }
  }

  beforeAll(async () => {
    h = await startPgWithMigrations();
    client = h.client;
  }, 120_000);
  afterAll(async () => { await h?.stop(); });
  beforeEach(async () => { await client.query("TRUNCATE audit_log"); });

  it("migrations created the audit roles and immutability triggers", async () => {
    const roles = await client.query("select rolname from pg_roles where rolname like 'pathfinder%' order by 1");
    expect(roles.rows.map((r) => r.rolname)).toEqual(["pathfinder_app", "pathfinder_audit_retention"]);
    const triggers = await client.query("select tgname from pg_trigger where not tgisinternal and tgrelid = 'audit_log'::regclass order by 1");
    expect(triggers.rows.map((r) => r.tgname)).toContain("audit_log_no_update");
    expect(triggers.rows.map((r) => r.tgname)).toContain("audit_log_chain");
  });

  it("the app role can INSERT and SELECT but NOT UPDATE or DELETE audit_log", async () => {
    await insertRow(0, GENESIS, "h0"); // seed as superuser

    // App role: INSERT (append) is allowed.
    await insertRow(1, "h0", "h1", "pathfinder_app");
    // App role: SELECT is allowed.
    await client.query("SET ROLE pathfinder_app");
    const seen = await client.query("select count(*)::int as n from audit_log");
    expect(seen.rows[0].n).toBe(2);
    // App role: UPDATE and DELETE are denied.
    await expect(client.query("UPDATE audit_log SET action='x' WHERE seq=0")).rejects.toThrow();
    await expect(client.query("DELETE FROM audit_log WHERE seq=0")).rejects.toThrow();
    await client.query("RESET ROLE");
  });

  it("the immutability trigger blocks UPDATE even for a superuser", async () => {
    await insertRow(0, GENESIS, "h0");
    await expect(client.query("UPDATE audit_log SET action='tampered' WHERE seq=0")).rejects.toThrow(
      /append-only: UPDATE is not permitted/,
    );
  });

  it("DELETE is blocked except for the retention role", async () => {
    await insertRow(0, GENESIS, "h0");
    // Superuser DELETE is refused by the trigger (only the retention job may delete).
    await expect(client.query("DELETE FROM audit_log WHERE seq=0")).rejects.toThrow(/retention job/);
    // The retention role may delete.
    await client.query("SET ROLE pathfinder_audit_retention");
    await client.query("DELETE FROM audit_log WHERE seq=0");
    await client.query("RESET ROLE");
    const left = await client.query("select count(*)::int as n from audit_log");
    expect(left.rows[0].n).toBe(0);
  });

  it("the hash-chain trigger rejects out-of-order and broken-link inserts", async () => {
    await insertRow(0, GENESIS, "h0");
    // Non-contiguous seq is rejected.
    await expect(insertRow(5, "h0", "h5")).rejects.toThrow(/contiguous/);
    // A prev_hash that does not match the previous row's row_hash is rejected.
    await expect(insertRow(1, "WRONG", "h1")).rejects.toThrow(/prev_hash/);
    // The correct next row is accepted.
    await insertRow(1, "h0", "h1");
    const n = await client.query("select count(*)::int as n from audit_log");
    expect(n.rows[0].n).toBe(2);
  });
});

describe("Postgres schema constraints", () => {
  let h: PgHarness;
  let client: pg.Client;
  beforeAll(async () => { h = await startPgWithMigrations(5434); client = h.client; }, 120_000);
  afterAll(async () => { await h?.stop(); });

  it("skill_nodes rejects 'difficulty' as a node type (Decision 4)", async () => {
    await client.query(
      `INSERT INTO skill_graph_versions (id, name, curriculum, version, status, created_at)
       VALUES ('v1','G','NSW','0.1','draft', now())`,
    );
    await expect(
      client.query(
        `INSERT INTO skill_nodes (graph_version_id, id, type, label, curriculum)
         VALUES ('v1','n1','difficulty','Hard','NSW')`,
      ),
    ).rejects.toThrow(/skill_node_type_valid|check/i);
  });

  it("round-trips core entities, including jsonb and timestamptz", async () => {
    await client.query(
      `INSERT INTO schools (id,name,settings,config_complete,created_at)
       VALUES ('s-rt','RT','{"timezone":"Australia/Sydney","defaultCurriculum":"NSW"}', true, now())`,
    );
    const school = await client.query("select settings, config_complete from schools where id='s-rt'");
    expect(school.rows[0].settings).toEqual({ timezone: "Australia/Sydney", defaultCurriculum: "NSW" });
    expect(school.rows[0].config_complete).toBe(true);

    await client.query(`INSERT INTO users (id,school_id,status,created_at) VALUES ('u-rt','s-rt','active',now())`);
    await client.query(
      `INSERT INTO content_items (id,school_id,owner_teacher_id,title,current_version_id,created_at)
       VALUES ('ci-rt','s-rt','u-rt','Worksheet','cv-rt',now())`,
    );
    await client.query(
      `INSERT INTO content_versions (id,content_item_id,version_number,file_type,size_bytes,content_hash,storage_key,uploaded_by_teacher_id,scan_status,ingestion_status,created_at)
       VALUES ('cv-rt','ci-rt',1,'pdf',100,'h','k','u-rt','clean','ingested',now())`,
    );
    await client.query(
      `INSERT INTO skill_graph_versions (id,name,curriculum,version,status,created_at)
       VALUES ('v-rt','G','NSW','0.1','signed_off',now())`,
    );
    await client.query(
      `INSERT INTO content_mappings (id,graph_version_id,content_item_id,node_id,source,difficulty,flags,created_at)
       VALUES ('m-rt','v-rt','ci-rt','skill-x','ai','developing','["missing_prerequisite"]', now())`,
    );
    const m = await client.query("select flags, difficulty from content_mappings where id='m-rt'");
    expect(m.rows[0].flags).toEqual(["missing_prerequisite"]); // jsonb → JS array
    expect(m.rows[0].difficulty).toBe("developing");
  });

  it("terms rejects an end date on/before the start date", async () => {
    await client.query(
      `INSERT INTO schools (id, name, settings, config_complete, created_at)
       VALUES ('s1','S','{}', false, now())`,
    );
    await client.query(
      `INSERT INTO academic_years (id, school_id, name) VALUES ('y1','s1','2026')`,
    );
    await expect(
      client.query(
        `INSERT INTO terms (id, academic_year_id, name, start_date, end_date)
         VALUES ('t1','y1','T1','2026-04-10','2026-01-28')`,
      ),
    ).rejects.toThrow(/terms_dates_ordered|check/i);
  });
});
