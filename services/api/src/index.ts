import { buildApp } from "./http/app";
import { EmailChannel, SesTransport } from "./adapters/email/emailChannel";
import { createSql } from "./adapters/postgres/pgClient";
import { buildPgStores } from "./adapters/postgres/pgContext";
import type { BuildContextOptions } from "./context";
import type { AuRegion } from "./platform/ai/aiServiceLayer";
import type { NotificationChannel } from "./platform/notifications/notificationService";

/**
 * Server entrypoint. Storage backend is selected by configuration:
 *   - PF_DATABASE_URL (or DATABASE_URL) set -> the real PostgreSQL adapters
 *     (e.g. a Supabase project — which MUST be in ap-southeast-2 Sydney,
 *     Foundational Decision 1). Apply the schema first: `npm run db:migrate`.
 *   - unset -> the in-memory store (dev default; state resets on restart,
 *     re-seed with `npm run demo`).
 * Audit + notifications stay in-memory in both modes for now (see README).
 */
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const options: BuildContextOptions = {};

const databaseUrl = process.env.PF_DATABASE_URL ?? process.env.DATABASE_URL;
let backend = "in-memory (state resets on restart; `npm run demo` re-seeds)";
if (databaseUrl) {
  const sql = createSql(databaseUrl);
  Object.assign(options, buildPgStores(sql));
  // Never log the URL itself — it carries the database password.
  backend = `PostgreSQL @ ${(() => { try { return new URL(databaseUrl).hostname; } catch { return "configured URL"; } })()}`;
}

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

const app = buildApp({ ...options, extraChannels });
app
  .listen({ port, host })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`Pathfinder API listening on ${address} — storage: ${backend}`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
