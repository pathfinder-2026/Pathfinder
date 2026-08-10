import type { Clock } from "../clock";
import { newId } from "../ids";

/**
 * Single internal notification/event service (Milestone 0, v1.3 scaffold).
 *
 * Every feature that needs to notify a person or emit an event goes through
 * THIS service rather than writing its own email/push code. In Milestone 0 the
 * Teacher invite is its first and only consumer; Milestone 5 alerts, Milestone
 * 7 calendar updates, Milestone 8 parent cadence and FR-SAF-002 safeguarding
 * escalation will all be later consumers of the same service.
 *
 * Channels are pluggable transports. Milestone 0 ships an in-memory channel
 * (used by dev and tests); an SES-in-ap-southeast-2 email channel is wired when
 * the AU infrastructure is provisioned (Foundational Decision 1).
 */

export type NotificationType =
  | "invite.teacher"
  | "invite.student"
  | "invite.parent"
  // Milestone 5a — Teacher-facing alerts (the first non-invite consumer of the
  // single notification/event service). Escalations surface on the dashboard AND
  // notify the class Teacher rather than the engine looping remediation forever.
  | "alert.teacher";

export interface NotificationMessage {
  id: string;
  type: NotificationType;
  /** Delivery target. Treated as PII in transit; never written to the audit log. */
  to: string;
  subject: string;
  body: string;
  /** Non-PII correlation data (ids only). */
  context: Record<string, unknown>;
  at: string;
}

export interface NotificationChannel {
  deliver(message: NotificationMessage): Promise<void> | void;
}

/** In-memory channel for dev/tests: records everything it is asked to deliver. */
export class InMemoryChannel implements NotificationChannel {
  readonly delivered: NotificationMessage[] = [];
  deliver(message: NotificationMessage): void {
    this.delivered.push(message);
  }
}

export interface SendInput {
  type: NotificationType;
  to: string;
  subject: string;
  body: string;
  context?: Record<string, unknown>;
}

type Subscriber = (message: NotificationMessage) => void;

export class NotificationService {
  private readonly channels: NotificationChannel[];
  private readonly subscribers: Subscriber[] = [];

  constructor(
    private readonly clock: Clock,
    channels: NotificationChannel[],
  ) {
    this.channels = channels;
  }

  /** Fan a message out to every channel and event subscriber. */
  async send(input: SendInput): Promise<NotificationMessage> {
    const message: NotificationMessage = {
      id: newId(),
      type: input.type,
      to: input.to,
      subject: input.subject,
      body: input.body,
      context: input.context ?? {},
      at: this.clock.isoNow(),
    };
    for (const channel of this.channels) {
      await channel.deliver(message);
    }
    for (const subscriber of this.subscribers) {
      subscriber(message);
    }
    return message;
  }

  /** Subscribe to the internal event stream (future consumers). */
  subscribe(subscriber: Subscriber): void {
    this.subscribers.push(subscriber);
  }
}
