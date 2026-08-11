-- Pathfinder — Milestone 6: Teacher Agent.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Every suggestion records its approved-content grounding (FR-TAG-004) as a jsonb
-- snapshot, so the link survives even if a source is later archived. Drafts
-- persist unsent (`sent` defaults false); sensitive behavioural/social material is
-- separated into `sensitive_sections` and flagged for extra teacher review.

CREATE TABLE agent_suggestions (
  id                  text PRIMARY KEY,
  school_id           text NOT NULL REFERENCES schools(id),
  teacher_id          text NOT NULL REFERENCES users(id),
  kind                text NOT NULL,
  title               text NOT NULL,
  content             text NOT NULL,
  grounding           jsonb NOT NULL,
  sensitive_sections  jsonb NOT NULL,
  requires_extra_review boolean NOT NULL DEFAULT false,
  personalised        boolean NOT NULL DEFAULT true,
  personalisation_note text,
  sent                boolean NOT NULL DEFAULT false,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL,
  CONSTRAINT agent_suggestions_kind_chk
    CHECK (kind IN ('unit_sequence','lesson_plan','differentiation','parent_summary','feedback'))
);
CREATE INDEX agent_suggestions_school_idx ON agent_suggestions(school_id);
CREATE INDEX agent_suggestions_teacher_idx ON agent_suggestions(teacher_id);
