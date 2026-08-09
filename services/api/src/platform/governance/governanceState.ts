import { ConflictError, ValidationError } from "../../domain/errors";
import type { GovernanceStatus } from "../../domain/types";

/**
 * Governance state machine (FR-GOV-001 scaffold), lifted to a platform concern
 * in Milestone 0 so every content-producing feature from Milestone 1 onward
 * inherits the same "nothing reaches anyone until a human approves it" gate.
 *
 * Lifecycle: draft -> approved -> published.
 *  - Nothing is auto-approved. `approve` REQUIRES an explicit approver id
 *    (a teacher action), enforcing Foundational Decision 7 / FR-GOV-001.
 *  - You cannot skip approval (draft -> published is rejected).
 *  - `revoke` sends an item back to draft (e.g. after an edit) so it must be
 *    re-approved before it can be published again.
 *
 * This module is intentionally content-agnostic: in Milestone 0 there is no
 * content yet, but the invariants are established and tested here so later
 * milestones bolt content onto a proven gate rather than inventing one.
 */

export interface Governed {
  status: GovernanceStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
}

export function newDraft(): Governed {
  return { status: "draft", approvedBy: null, approvedAt: null, publishedAt: null };
}

const ALLOWED: Record<GovernanceStatus, GovernanceStatus[]> = {
  draft: ["approved"],
  approved: ["published", "draft"],
  published: ["draft"],
};

export function canTransition(from: GovernanceStatus, to: GovernanceStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Approve a draft. Requires an explicit approver — never automatic. */
export function approve(item: Governed, approverId: string, at: string): Governed {
  if (!approverId) {
    throw new ValidationError("Approval requires an explicit approver (teacher action).");
  }
  if (!canTransition(item.status, "approved")) {
    throw new ConflictError(
      "GOVERNANCE_TRANSITION",
      `Cannot approve an item in "${item.status}" state.`,
    );
  }
  return { ...item, status: "approved", approvedBy: approverId, approvedAt: at };
}

/** Publish an approved item. Draft -> published is rejected (no skipping the gate). */
export function publish(item: Governed, at: string): Governed {
  if (!canTransition(item.status, "published")) {
    throw new ConflictError(
      "GOVERNANCE_TRANSITION",
      `Cannot publish an item in "${item.status}" state; it must be approved first.`,
    );
  }
  return { ...item, status: "published", publishedAt: at };
}

/** Send an item back to draft (e.g. after edits), clearing prior approval. */
export function revoke(item: Governed): Governed {
  return { ...item, status: "draft", approvedBy: null, approvedAt: null, publishedAt: null };
}
