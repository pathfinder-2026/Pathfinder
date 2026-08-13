import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { AU_REGIONS, type AuRegion } from "../../platform/ai/aiServiceLayer";
import { ValidationError } from "../../domain/errors";
import type {
  NotificationChannel,
  NotificationMessage,
} from "../../platform/notifications/notificationService";

/**
 * Real email delivery behind the notification port.
 *
 * The NotificationService fans every message out to its channels; this channel
 * turns a NotificationMessage into an outbound email. It follows the same
 * pattern as the BedrockProvider (ADR-0013): the adapter is real, compiled and
 * fully tested against a fake transport, but it is NOT wired in by default —
 * live sending is gated on AWS SES credentials + a verified sender identity,
 * neither of which exists in this environment. The in-memory channel (and the
 * admin UI's copyable invite links) remain the working delivery path until then.
 *
 * Transport seam: `EmailTransport` is the low-level "send one email" interface.
 * SES (ap-southeast-2, Foundational Decision 1) is the first implementation; an
 * SMTP transport (e.g. nodemailer against a school's relay) can implement the
 * same seam later — do NOT hand-roll SMTP here.
 */

/** One outbound email. `to` is PII in transit — never persist or log it. */
export interface OutboundEmail {
  to: string;
  subject: string;
  textBody: string;
}

export interface EmailTransport {
  send(email: OutboundEmail): Promise<void>;
  /** Where/what this transport is, for compliance checks — never includes PII. */
  describe(): { kind: string; region?: string };
}

/**
 * SES transport, pinned to an approved AU region (Foundational Decision 1 —
 * same residency rule as the AI layer). Constructing it with an offshore
 * region is refused outright.
 */
export class SesTransport implements EmailTransport {
  private readonly client: SESv2Client;
  private readonly region: AuRegion;

  constructor(private readonly options: { from: string; region?: AuRegion }) {
    const region = options.region ?? "ap-southeast-2";
    if (!AU_REGIONS.includes(region)) {
      throw new ValidationError(
        `Email region "${region}" is not an approved AU region (${AU_REGIONS.join(", ")}). ` +
          `No personal data may transit an offshore email endpoint.`,
      );
    }
    this.region = region;
    this.client = new SESv2Client({ region });
  }

  describe(): { kind: string; region: string } {
    return { kind: "ses", region: this.region };
  }

  async send(email: OutboundEmail): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.options.from,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: { Text: { Data: email.textBody, Charset: "UTF-8" } },
          },
        },
      }),
    );
  }
}

/**
 * A delivery failure record. Deliberately PII-free: it carries ids and a reason,
 * never the recipient address, subject or body.
 */
export interface EmailDeliveryFailure {
  notificationId: string;
  type: string;
  reason: string;
  at: string;
}

export interface EmailChannelOptions {
  /**
   * Public base URL of the web app, used to compose invite-acceptance links
   * (e.g. https://app.school.example). The invite token travels in the message
   * context (ids only) — the link is composed here, at the edge.
   */
  appBaseUrl: string;
}

export class EmailChannel implements NotificationChannel {
  /** Count of successfully handed-off emails (ops signal, no PII). */
  sentCount = 0;
  /** PII-free failure records for ops/monitoring (e.g. safeguarding SLA checks). */
  readonly failures: EmailDeliveryFailure[] = [];

  constructor(
    private readonly transport: EmailTransport,
    private readonly options: EmailChannelOptions,
  ) {}

  /**
   * Best-effort delivery: a transport outage must never break the domain action
   * that emitted the notification (the invite still exists; the admin UI's
   * copyable link still works; the in-memory channel still recorded it).
   * Failures are recorded — without PII — so operations can monitor them;
   * alerting on safeguarding-type failures is part of productionisation.
   */
  async deliver(message: NotificationMessage): Promise<void> {
    try {
      await this.transport.send({
        to: message.to,
        subject: message.subject,
        textBody: this.composeBody(message),
      });
      this.sentCount += 1;
    } catch (err) {
      this.failures.push({
        notificationId: message.id,
        type: message.type,
        reason: err instanceof Error ? err.message : String(err),
        at: message.at,
      });
    }
  }

  /** The message body, plus the accept link for invites (token -> URL here at the edge). */
  private composeBody(message: NotificationMessage): string {
    const token = message.context["token"];
    if (message.type.startsWith("invite.") && typeof token === "string" && token.length > 0) {
      const base = this.options.appBaseUrl.replace(/\/+$/, "");
      return `${message.body}\n\nAccept your invite: ${base}/?token=${encodeURIComponent(token)}\n\nThis link is single-use.`;
    }
    return message.body;
  }
}
