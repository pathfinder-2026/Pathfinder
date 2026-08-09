import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuditRecorder } from "../src/platform/audit/auditLog";
import { FixedClock } from "../src/platform/clock";
import { makeHarness } from "./helpers";

function seededRecorder(): AuditRecorder {
  const rec = new AuditRecorder(new FixedClock());
  rec.append({ action: "a.one", actorId: null, subjectType: "x", subjectId: "1" });
  rec.append({ action: "a.two", actorId: "u1", subjectType: "x", subjectId: "2" });
  rec.append({ action: "a.three", actorId: "u1", subjectType: "x", subjectId: "3" });
  return rec;
}

describe("Foundational Decision 3 — append-only, hash-chained audit log", () => {
  it("chains rows from a genesis hash and verifies intact", () => {
    const rec = seededRecorder();
    const rows = rec.list();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows[0]?.prevHash).toBe("0".repeat(64));
    expect(rows[1]?.prevHash).toBe(rows[0]?.rowHash);
    expect(rec.verifyChain()).toBe(true);
  });

  it("detects tampering with a row's content", () => {
    const rows = seededRecorder().list();
    expect(AuditRecorder.verifyEntries(rows)).toBe(true);
    const tampered = rows.map((r) => ({ ...r }));
    tampered[1] = { ...tampered[1]!, action: "a.two.EVIL" };
    expect(AuditRecorder.verifyEntries(tampered)).toBe(false);
  });

  it("detects deletion / reordering of rows", () => {
    const rows = seededRecorder().list();
    expect(AuditRecorder.verifyEntries([rows[0]!, rows[2]!])).toBe(false); // middle deleted
    expect(AuditRecorder.verifyEntries([rows[1]!, rows[0]!, rows[2]!])).toBe(false); // reordered
  });

  it("exposes no update or delete mutator (append-only API)", () => {
    const rec = seededRecorder() as unknown as Record<string, unknown>;
    expect(rec["update"]).toBeUndefined();
    expect(rec["delete"]).toBeUndefined();
    expect(rec["remove"]).toBeUndefined();
  });

  it("records significant admin actions", () => {
    const { ctx } = makeHarness();
    ctx.schools.createSchool({
      name: "Audited School",
      campusName: "Main",
      academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
    });
    expect(ctx.audit.find((e) => e.action === "school.created")).toHaveLength(1);
    expect(ctx.audit.verifyChain()).toBe(true);
  });

  it("the SQL migration grants the app role INSERT+SELECT only and blocks mutation", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../db/migrations/0002_audit_log_grants.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toMatch(/GRANT INSERT, SELECT ON audit_log TO pathfinder_app/);
    // The app role is never granted UPDATE or DELETE.
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*TO pathfinder_app/);
    // Immutability is enforced by triggers too.
    expect(sql).toMatch(/append-only: UPDATE is not permitted/);
  });
});
