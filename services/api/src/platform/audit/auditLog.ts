import { createHash } from "node:crypto";
import type { Clock } from "../clock";
import { newId } from "../ids";

/**
 * Append-only, hash-chained audit log (Foundational Decision 3).
 *
 * Every AI action and significant admin action is recorded here. Each row
 * stores a hash of the previous row (`prevHash`) plus a hash over its own
 * canonical content (`rowHash = sha256(prevHash + canonical(payload))`), so any
 * insertion, deletion, or edit anywhere in the chain is detectable by
 * `verifyChain`.
 *
 * The application only ever APPENDS. There is deliberately no update or delete
 * method on this recorder. In production the same guarantee is enforced at the
 * database level: the app role is granted INSERT + SELECT only (see
 * db/migrations/0002_audit_log_grants.sql), and retention-driven deletion runs
 * as a separate privileged, itself-logged job.
 */

export interface AuditInput {
  /** Dotted action name, e.g. "school.created", "invite.teacher.created". */
  action: string;
  /** Acting user id, or null for system actions. */
  actorId: string | null;
  /** Type of the entity the action concerns, e.g. "school", "user". */
  subjectType: string;
  subjectId: string;
  /**
   * Minimal, non-PII contextual facts. The audited FACT is retained forever
   * (Decision 6), so this must not contain erasable personal data — reference
   * subjects by id, not by name/email.
   */
  metadata?: Record<string, unknown>;
}

export interface AuditEntry extends Required<AuditInput> {
  id: string;
  seq: number;
  at: string;
  prevHash: string;
  rowHash: string;
}

const GENESIS_HASH = "0".repeat(64);

/** Stable JSON: object keys sorted recursively so the hash is deterministic. */
function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Content that is hashed into the chain (everything except the row hash). */
function hashRow(entry: Omit<AuditEntry, "rowHash">): string {
  const content = canonical({
    id: entry.id,
    seq: entry.seq,
    at: entry.at,
    action: entry.action,
    actorId: entry.actorId,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    metadata: entry.metadata,
    prevHash: entry.prevHash,
  });
  return createHash("sha256").update(content).digest("hex");
}

export class AuditRecorder {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly clock: Clock) {}

  /** Append a new row to the chain and return it. This is the ONLY mutator. */
  append(input: AuditInput): AuditEntry {
    const prev = this.entries[this.entries.length - 1];
    const base: Omit<AuditEntry, "rowHash"> = {
      id: newId(),
      seq: this.entries.length,
      at: this.clock.isoNow(),
      action: input.action,
      actorId: input.actorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: input.metadata ?? {},
      prevHash: prev ? prev.rowHash : GENESIS_HASH,
    };
    const entry: AuditEntry = { ...base, rowHash: hashRow(base) };
    this.entries.push(entry);
    return entry;
  }

  /** Read-only snapshot (SELECT). Returns copies so callers cannot mutate. */
  list(): AuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  find(predicate: (e: AuditEntry) => boolean): AuditEntry[] {
    return this.list().filter(predicate);
  }

  /** Verify this recorder's own chain. */
  verifyChain(): boolean {
    return AuditRecorder.verifyEntries(this.entries);
  }

  /**
   * Verify an arbitrary ordered list of entries. Detects reordering,
   * insertion, deletion, or field tampering anywhere in the chain.
   */
  static verifyEntries(entries: readonly AuditEntry[]): boolean {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.seq !== i) return false;
      if (e.prevHash !== prevHash) return false;
      const expected = hashRow({
        id: e.id,
        seq: e.seq,
        at: e.at,
        action: e.action,
        actorId: e.actorId,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        metadata: e.metadata,
        prevHash: e.prevHash,
      });
      if (e.rowHash !== expected) return false;
      prevHash = e.rowHash;
    }
    return true;
  }
}
