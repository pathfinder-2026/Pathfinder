import { buildApp } from "./http/app";
import { EmailChannel, SesTransport } from "./adapters/email/emailChannel";
import type { AuRegion } from "./platform/ai/aiServiceLayer";
import type { NotificationChannel } from "./platform/notifications/notificationService";

/**
 * Milestone 0 dev entrypoint. Runs the API on the in-memory store (no database
 * is provisioned yet). Production wiring (Postgres in ap-southeast-2) is
 * selected via configuration when the AU infrastructure exists.
 */
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

// Real email delivery is OPT-IN via env (gated on SES credentials + a verified
// sender — not present in dev). Without it, invites are delivered by the admin
// UI's copyable links; the in-memory channel always records everything.
//   PF_EMAIL_FROM     verified sender identity (enables the channel)
//   PF_APP_BASE_URL   public web-app URL for invite links (default :5174 dev)
//   PF_EMAIL_REGION   AU region override (default ap-southeast-2)
const extraChannels: NotificationChannel[] = [];
if (process.env.PF_EMAIL_FROM) {
  extraChannels.push(
    new EmailChannel(
      new SesTransport({
        from: process.env.PF_EMAIL_FROM,
        region: process.env.PF_EMAIL_REGION as AuRegion | undefined,
      }),
      { appBaseUrl: process.env.PF_APP_BASE_URL ?? "http://localhost:5174" },
    ),
  );
}

const app = buildApp({ extraChannels });
app
  .listen({ port, host })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`Pathfinder API (Milestone 0) listening on ${address}`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
