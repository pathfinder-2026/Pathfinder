import { describe, expect, it } from "vitest";
import { makeMappedContent, seedMastery, setupParentSchool } from "./helpers";

/**
 * Milestone 8 — FR-PAR-004: a single weekly consolidated cadence. Safeguarding is
 * the ONLY off-cadence path (immediate, via FR-SAF-002) — there is no separate
 * "urgent" parent-notification class.
 */
describe("M8 FR-PAR-004 — notification cadence", () => {
  const RECENT = "2025-12-29T00:00:00.000Z"; // within the digest week ending 2026-01-01

  async function verified() {
    const s = await setupParentSchool();
    const link = await s.ctx.parents.linkChild(s.adminId, s.schoolId, { parentId: s.parentId, studentId: s.studentId, relationship: "parent" });
    await s.ctx.parents.verifyLink(s.adminId, s.schoolId, link.id);
    return s;
  }

  it("happy path — a week with new activity yields ONE consolidated notification, not one per item", async () => {
    const s = await verified();
    // Several separate pieces of activity in the week.
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.fractionsNode.id, 0.8, RECENT);
    await seedMastery(s.ctx, s.schoolId, s.studentId, s.integersNode.id, 0.3, RECENT);
    await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, { studentId: s.studentId, type: "homework", title: "Task", dueDate: RECENT })
      .then((t) => s.ctx.studentWorkspace.completeTask(s.studentId, t.id));

    const result = await s.ctx.parents.runWeeklyDigest(s.schoolId);
    expect(result.sent).toBe(1);
    const digests = s.ctx.notificationChannel.delivered.filter((m) => m.type === "parent.digest" && m.to === s.parentId);
    expect(digests).toHaveLength(1); // consolidated, not one per item
  });

  it("edge — a week with nothing to report sends no notification", async () => {
    const s = await verified();
    const result = await s.ctx.parents.runWeeklyDigest(s.schoolId);
    expect(result.sent).toBe(0);
    expect(result.skippedNoActivity).toBe(1);
    expect(s.ctx.notificationChannel.delivered.filter((m) => m.type === "parent.digest")).toHaveLength(0);
  });

  it("resolved (v1.3) — safeguarding escalates immediately, independent of the digest cadence", async () => {
    const s = await verified();
    // Configure safeguarding + a homework task so Ask for Help is enabled.
    await s.ctx.safeguarding.setConfig(s.adminId, s.schoolId, { contactName: "DSL", contactRole: "Lead", slaHours: 24, afterHoursPolicy: "on-call" });
    await makeMappedContent(s.ctx, s.schoolId, s.teacherId, s.fractionsNode.id, { title: "Pack", sections: 1 });
    const task = await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, { studentId: s.studentId, type: "homework", title: "Practice", nodeId: s.fractionsNode.id, dueDate: RECENT });

    // A disclosure escalates IMMEDIATELY (not queued for the weekly digest).
    const res = await s.ctx.askForHelp.ask(s.studentId, task.id, "I want to hurt myself");
    expect(res.available && res.kind).toBe("safeguarding");
    expect(s.ctx.notificationChannel.delivered.some((m) => m.type === "alert.safeguarding")).toBe(true);

    // The weekly digest carries progress only — no safeguarding, no separate urgent class.
    await s.ctx.parents.runWeeklyDigest(s.schoolId);
    const parentMsgs = s.ctx.notificationChannel.delivered.filter((m) => m.to === s.parentId);
    expect(parentMsgs.every((m) => m.type === "parent.digest")).toBe(true);
    expect(s.ctx.notificationChannel.delivered.some((m) => m.type === "alert.safeguarding" && m.to === s.parentId)).toBe(false);
  });
});
