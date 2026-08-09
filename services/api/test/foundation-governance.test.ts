import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../src/domain/errors";
import {
  approve,
  canTransition,
  newDraft,
  publish,
  revoke,
} from "../src/platform/governance/governanceState";

/**
 * Governance state machine (FR-GOV-001 scaffold), draft -> approved -> published.
 * Nothing is auto-approved; the gate cannot be skipped.
 */
describe("Foundation — governance state machine", () => {
  const AT = "2026-02-01T00:00:00.000Z";

  it("new items start in draft", () => {
    expect(newDraft().status).toBe("draft");
  });

  it("cannot publish a draft without approval (no skipping the gate)", () => {
    expect(() => publish(newDraft(), AT)).toThrow(ConflictError);
  });

  it("approval requires an explicit approver (never automatic)", () => {
    expect(() => approve(newDraft(), "", AT)).toThrow(ValidationError);
  });

  it("draft -> approved -> published with an approver", () => {
    const approved = approve(newDraft(), "teacher-1", AT);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("teacher-1");
    const published = publish(approved, AT);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBe(AT);
  });

  it("revoke sends an item back to draft and clears approval", () => {
    const published = publish(approve(newDraft(), "teacher-1", AT), AT);
    const back = revoke(published);
    expect(back.status).toBe("draft");
    expect(back.approvedBy).toBeNull();
  });

  it("transition table forbids draft -> published", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("approved", "published")).toBe(true);
  });
});
