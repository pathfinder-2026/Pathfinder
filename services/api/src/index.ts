import { buildApp } from "./http/app";

/**
 * Milestone 0 dev entrypoint. Runs the API on the in-memory store (no database
 * is provisioned yet). Production wiring (Postgres in ap-southeast-2) is
 * selected via configuration when the AU infrastructure exists.
 */
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();
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
