import { defineConfig } from "vitest/config";

/**
 * Real-Postgres integration tests. Separate from the fast in-memory suite
 * because each boots an embedded PostgreSQL cluster. Run with `npm run test:db`.
 */
export default defineConfig({
  test: {
    include: ["test-pg/**/*.pg.test.ts"],
    environment: "node",
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // One worker: embedded clusters bind ports and must not race.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
