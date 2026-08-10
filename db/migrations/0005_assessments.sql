-- Pathfinder — Milestone 3: Assessment Builder.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
-- All generated output stays DRAFT until a teacher publishes (FR-ASM-004);
-- generation is grounded only in the approved + mapped pool.

CREATE TABLE assessments (
  id                  text PRIMARY KEY,
  school_id           text NOT NULL REFERENCES schools(id),
  teacher_id          text NOT NULL REFERENCES users(id),
  title               text NOT NULL,
  request             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'draft',
  generation_status   text NOT NULL,
  published_at        timestamptz,
  scheduled_start     timestamptz,
  review_acknowledged boolean NOT NULL DEFAULT false,
  shortfall           jsonb,
  flags               jsonb NOT NULL,
  created_at          timestamptz NOT NULL,
  CONSTRAINT assessment_status_valid CHECK (status IN ('draft','published'))
);
CREATE INDEX assessments_teacher_idx ON assessments(teacher_id);

CREATE TABLE assessment_versions (
  id            text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES assessments(id),
  label         text NOT NULL,
  created_at    timestamptz NOT NULL
);
CREATE INDEX assessment_versions_assessment_idx ON assessment_versions(assessment_id);

CREATE TABLE assessment_questions (
  id                    text PRIMARY KEY,
  version_id            text NOT NULL REFERENCES assessment_versions(id),
  "order"               bigint NOT NULL,
  type                  text NOT NULL,
  prompt                text NOT NULL,
  options               jsonb,
  model_answer          text,
  rubric                text,
  difficulty            text NOT NULL,
  grounding_content_ids jsonb NOT NULL,
  reviewed              boolean NOT NULL DEFAULT false
);
CREATE INDEX assessment_questions_version_idx ON assessment_questions(version_id);

CREATE TABLE assessment_attempts (
  id             text PRIMARY KEY,
  assessment_id  text NOT NULL REFERENCES assessments(id),
  student_id     text NOT NULL REFERENCES users(id),
  status         text NOT NULL,
  saved_answers  jsonb NOT NULL,
  last_saved_at  timestamptz NOT NULL,
  interrupted    boolean NOT NULL DEFAULT false,
  resume_deadline timestamptz NOT NULL,
  created_at     timestamptz NOT NULL
);
CREATE INDEX assessment_attempts_assessment_idx ON assessment_attempts(assessment_id);
