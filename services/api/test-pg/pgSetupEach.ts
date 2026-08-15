import postgres, { type Sql } from "postgres";
import { afterAll, beforeEach } from "vitest";

/**
 * Truncate every table before each test so the shared Postgres database gives
 * each acceptance test a clean slate (the in-memory backend gets a fresh store
 * per test; this mirrors that for Postgres).
 */
const TABLES = [
  "behavioural_observations", "cocurricular_records", "teacher_comments", "licences",
  "branded_reports", "branding_logo_assets", "branding_configs",
  "sso_configs", "school_policies", "parent_children",
  "help_messages", "help_sessions", "calendar_events", "student_tasks", "safeguarding_configs",
  "agent_suggestions",
  "peer_placements", "peer_corrections", "peer_reviews", "peer_test_submissions", "peer_tests",
  "focus_dismissals", "group_assignments",
  "mastery_records", "misconception_signals",
  "assessment_attempts", "assessment_questions", "assessment_versions", "assessments",
  "content_mappings", "skill_prerequisites", "skill_nodes", "skill_graph_versions",
  "school_curricula", "skill_mastery_refs", "content_references", "chunks", "concepts",
  "classifications", "content_versions", "content_items", "user_onboarding", "onboarding_progress",
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
