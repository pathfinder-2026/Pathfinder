-- Pathfinder -- Milestone 9: Principal Dashboard (school-level).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Sensitive comparison views (e.g. teacher-to-teacher) are configurable per school
-- policy (FR-PDB-006): disabled by default, and a mid-term change applies going
-- forward. The principal dashboard NEVER reaches Ask-for-Help transcripts -- that
-- is enforced structurally in PrincipalService, which does not read the help store.

CREATE TABLE school_policies (
  school_id                   text PRIMARY KEY REFERENCES schools(id),
  teacher_comparison_enabled  boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL
);

-- Make the AI edit-rate metric real (FR-PDB-001): a Teacher-Agent draft is flagged
-- edited when the teacher changes it before use.
ALTER TABLE agent_suggestions ADD COLUMN edited boolean NOT NULL DEFAULT false;
