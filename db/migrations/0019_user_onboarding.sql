-- Pathfinder — persist per-user role onboarding (FR-ONB-001).
-- Non-admin personas (teacher/principal/student/parent) previously tracked
-- their "Getting started" checklist only in client state, so every login
-- showed the checklist again from scratch. This table records which steps a
-- user has completed and when they entered their workspace, mirroring what
-- onboarding_progress already does for the school-level Admin flow.

CREATE TABLE user_onboarding (
  user_id         text PRIMARY KEY REFERENCES users(id),
  completed_steps jsonb NOT NULL,
  entered_at      timestamptz
);
