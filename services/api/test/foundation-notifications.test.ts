import { describe, expect, it, vi } from "vitest";
import { makeHarness, seedSchoolWithAdmin } from "./helpers";

/**
 * The single notification/event service (Milestone 0). The Teacher invite is
 * its first consumer — the invite is delivered THROUGH the service, not via
 * ad-hoc email code.
 */
describe("Foundation — notification/event service", () => {
  it("routes the Teacher invite through the notification service", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);

    const res = await ctx.invites.inviteTeacher(school.id, {
      email: "newteacher@springfield.edu",
      firstName: "Nadia",
      lastName: "New",
    });

    const delivered = ctx.notificationChannel.delivered;
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.type).toBe("invite.teacher");
    expect(delivered[0]?.to).toBe("newteacher@springfield.edu");
    expect(delivered[0]?.context.inviteId).toBe(res.invite.id);
  });

  it("delivers events to subscribers of the internal event stream", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const spy = vi.fn();
    ctx.notifications.subscribe(spy);

    await ctx.invites.inviteTeacher(school.id, {
      email: "sub@springfield.edu",
      firstName: "Sub",
      lastName: "Scriber",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps PII (the email address) out of the audit log", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    await ctx.invites.inviteTeacher(school.id, {
      email: "secret@springfield.edu",
      firstName: "Sec",
      lastName: "Ret",
    });
    const auditJson = JSON.stringify(ctx.audit.list());
    expect(auditJson).not.toContain("secret@springfield.edu");
  });
});
