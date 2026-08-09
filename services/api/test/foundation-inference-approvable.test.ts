import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  approveInference,
  canSurfaceToStakeholder,
  newInferenceRecord,
} from "../src/domain/inference";

/**
 * Foundational Decision 7 — AI claims about a student carry an approvable state
 * field from the first schema, so the review gate can be enabled later without
 * a schema migration. No records exist in Milestone 0; the shape is proven here.
 */
describe("Foundation — inference-record approvable state", () => {
  const base = {
    studentId: "s1",
    schoolId: "sch1",
    kind: "misconception" as const,
    claim: "Confuses area and perimeter",
    createdAt: "2026-02-01T00:00:00.000Z",
  };

  it("new inference records default to 'unreviewed' (never auto-approved)", () => {
    const record = newInferenceRecord(base);
    expect(record.approvalState).toBe("unreviewed");
  });

  it("an unreviewed claim cannot be surfaced to a parent/principal", () => {
    expect(canSurfaceToStakeholder(newInferenceRecord(base))).toBe(false);
  });

  it("only an approved claim may be surfaced", () => {
    const approved = approveInference(newInferenceRecord(base));
    expect(approved.approvalState).toBe("approved");
    expect(canSurfaceToStakeholder(approved)).toBe(true);
  });

  it("the schema carries an approval_state column from the first migration", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../db/migrations/0001_init.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toMatch(/approval_state text NOT NULL DEFAULT 'unreviewed'/);
  });
});
