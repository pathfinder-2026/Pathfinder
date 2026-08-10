import { defineConfig } from "vitest/config";

/**
 * Runs the SAME acceptance suite (test/**) against a real embedded PostgreSQL
 * instead of the in-memory store, to prove the Postgres adapters behind the
 * ports. Run with `npm run test:pg-suite`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test-pg/pgGlobalSetup.ts"],
    setupFiles: ["test-pg/pgSetupEach.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // One worker + a truncate before each test → deterministic shared DB.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    env: {
      PATHFINDER_TEST_BACKEND: "pg",
      DATABASE_URL: "postgres://postgres:password@localhost:5439/pathfinder",
    },
  },
});
