import postgres, { type Sql } from "postgres";
import { afterAll, beforeEach } from "vitest";

/**
 * Truncate every table before each test so the shared Postgres database gives
 * each acceptance test a clean slate (the in-memory backend gets a fresh store
 * per test; this mirrors that for Postgres).
 */
const TABLES = [
  "content_mappings", "skill_prerequisites", "skill_nodes", "skill_graph_versions",
  "school_curricula", "skill_mastery_refs", "content_references", "chunks", "concepts",
  "classifications", "content_versions", "content_items", "onboarding_progress",
  "sessions", "credentials", "notifications", "audit_log", "inference_records",
  "enrolment_history", "enrolments", "invites", "memberships", "personal_data",
  "users", "classes", "terms", "academic_years", "campuses", "lessons", "questions",
  "outcomes", "schools",
];

let sql: Sql | undefined;

beforeEach(async () => {
  if (process.env.PATHFINDER_TEST_BACKEND !== "pg") return;
  sql ??= postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql.unsafe(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});
