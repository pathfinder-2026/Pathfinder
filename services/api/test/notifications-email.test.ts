import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import {
  EmailChannel,
  SesTransport,
  type EmailTransport,
  type OutboundEmail,
} from "../src/adapters/email/emailChannel";

/**
 * Email delivery behind the notification port (adapters/email/emailChannel.ts).
 * The channel is real but NOT wired by default — live SES sending is gated on
 * credentials + a verified sender (same posture as BedrockProvider, ADR-0013).
 * These tests exercise the full composition through a fake transport.
 */

class FakeTransport implements EmailTransport {
  readonly sent: OutboundEmail[] = [];
  constructor(private readonly failWith?: string) {}
  describe() {
    return { kind: "fake" };
  }
  async send(email: OutboundEmail): Promise<void> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(email);
  }
}

const START = {
  school: {
    name: "Mailward College",
    campusName: "Main",
    academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
  },
  admin: { email: "adm@mailward.edu", firstName: "Ada", lastName: "Admin", password: "password123" },
};

function harness(transport: EmailTransport) {
  const email = new EmailChannel(transport, { appBaseUrl: "http://app.test/" });
  const ctx = buildContext({ clock: new FixedClock(), extraChannels: [email] });
  return { ctx, app: buildApp({}, ctx), email };
}

describe("Email notification channel (SES seam)", () => {
  it("fans an invite out to email with a single-use accept link, alongside the in-app record", async () => {
    const transport = new FakeTransport();
    const { ctx, app, email } = harness(transport);
    const started = (await app.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START })).json();
    const auth = { authorization: `Bearer ${started.token}` };

    const inv = await app.inject({
      method: "POST", url: `/api/v1/schools/${started.schoolId}/invites`, headers: auth,
      payload: { role: "teacher", email: "nia@mailward.edu", firstName: "Nia", lastName: "New" },
    });
    expect(inv.statusCode).toBe(201);

    // The email left through the transport, addressed to the invitee, with the
    // accept link composed from the (ids-only) context token at the edge.
    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0];
    expect(sent.to).toBe("nia@mailward.edu");
    expect(sent.subject).toContain("invited");
    const record = ctx.notificationChannel.delivered.find((m) => m.type === "invite.teacher")!;
    const token = (record.context as { token: string }).token;
    expect(sent.textBody).toContain(`http://app.test/?token=${token}`);
    expect(sent.textBody).toContain("single-use");
    expect(email.sentCount).toBe(1);

    // The in-memory (in-app) channel still recorded the message — email is additive.
    expect(record).toBeTruthy();
    await app.close();
  });

  it("a transport outage never breaks the inviting action, and the failure record holds no PII", async () => {
    const transport = new FakeTransport("SES endpoint unreachable");
    const { app, email } = harness(transport);
    const started = (await app.inject({ method: "POST", url: "/api/v1/onboarding/start", payload: START })).json();
    const auth = { authorization: `Bearer ${started.token}` };

    const inv = await app.inject({
      method: "POST", url: `/api/v1/schools/${started.schoolId}/invites`, headers: auth,
      payload: { role: "teacher", email: "nia@mailward.edu", firstName: "Nia", lastName: "New" },
    });
    // The invite was created regardless — the copyable-link path still works.
    expect(inv.statusCode).toBe(201);

    expect(email.sentCount).toBe(0);
    expect(email.failures).toHaveLength(1);
    expect(email.failures[0]).toMatchObject({ type: "invite.teacher", reason: "SES endpoint unreachable" });
    // PII discipline: the failure record never carries the address, name or body.
    const serialised = JSON.stringify(email.failures);
    expect(serialised).not.toContain("nia@mailward.edu");
    expect(serialised).not.toContain("Nia");
    await app.close();
  });

  it("non-invite notifications pass through without an invite link", async () => {
    const transport = new FakeTransport();
    const { ctx } = harness(transport);
    await ctx.notifications.send({
      type: "alert.teacher",
      to: "t@mailward.edu",
      subject: "Class focus alert",
      body: "A focus area needs your attention.",
    });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].textBody).toBe("A focus area needs your attention.");
    expect(transport.sent[0].textBody).not.toContain("token=");
  });

  it("SesTransport is pinned to AU regions (Foundational Decision 1)", () => {
    expect(() => new SesTransport({ from: "no-reply@x.edu", region: "us-east-1" as never })).toThrowError(/not an approved AU region/);
    const ok = new SesTransport({ from: "no-reply@x.edu" });
    expect(ok.describe()).toEqual({ kind: "ses", region: "ap-southeast-2" });
  });
});
