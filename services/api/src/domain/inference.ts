import { newId } from "../platform/ids";
import type { InferenceRecord } from "./types";

/**
 * Inference-record helpers (Foundational Decision 7). AI claims about a student
 * carry an approvable state field from the first schema so a review/sign-off
 * step can later gate them before they surface to parents (M8) or principals
 * (M9) — without a schema migration. No records are produced in Milestone 0;
 * these helpers exist so the gate's shape is proven and tested now.
 */

export interface NewInferenceInput {
  studentId: string;
  schoolId: string;
  kind: InferenceRecord["kind"];
  claim: string;
  createdAt: string;
}

/** Create an inference record. Always starts "unreviewed" — never auto-approved. */
export function newInferenceRecord(input: NewInferenceInput): InferenceRecord {
  return {
    id: newId(),
    studentId: input.studentId,
    schoolId: input.schoolId,
    kind: input.kind,
    claim: input.claim,
    approvalState: "unreviewed",
    createdAt: input.createdAt,
  };
}

/** Approve a claim (an explicit human action gating it for stakeholders). */
export function approveInference(record: InferenceRecord): InferenceRecord {
  return { ...record, approvalState: "approved" };
}

export function rejectInference(record: InferenceRecord): InferenceRecord {
  return { ...record, approvalState: "rejected" };
}

/**
 * Whether an AI claim about a student may be surfaced to a parent/principal.
 * Only approved claims pass; unreviewed and rejected claims are withheld
 * (Foundational Decision 7 / FR-GOV-001).
 */
export function canSurfaceToStakeholder(record: InferenceRecord): boolean {
  return record.approvalState === "approved";
}
