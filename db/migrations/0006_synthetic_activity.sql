-- Pathfinder — Milestone 4: synthetic student activity + quarantine.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Quarantine (v1.3): synthetic students are flagged at the SCHEMA level; they are
-- excluded from any parent-facing surface, real report/export, and FR-GOV-004
-- pipeline, and are deletable before pilot go-live.

ALTER TABLE users ADD COLUMN synthetic boolean NOT NULL DEFAULT false;

CREATE TABLE mastery_records (
  id               text PRIMARY KEY,
  student_id       text NOT NULL REFERENCES users(id),
  school_id        text NOT NULL REFERENCES schools(id),
  node_id          text NOT NULL,
  level            text NOT NULL,
  score            double precision NOT NULL,
  data_points      bigint NOT NULL,
  last_activity_at timestamptz NOT NULL,
  synthetic        boolean NOT NULL DEFAULT false
);
CREATE INDEX mastery_records_school_idx ON mastery_records(school_id);
CREATE INDEX mastery_records_node_idx ON mastery_records(school_id, node_id);

CREATE TABLE misconception_signals (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES users(id),
  school_id     text NOT NULL REFERENCES schools(id),
  node_id       text NOT NULL,
  misconception text NOT NULL,
  occurrences   bigint NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  synthetic     boolean NOT NULL DEFAULT false
);
CREATE INDEX misconception_signals_school_idx ON misconception_signals(school_id);
