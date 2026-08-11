-- Pathfinder -- Milestone 8: Parent Dashboard.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Verification-before-data: a parent sees NO student data until `verified` is true,
-- and only ever their own linked child. `last_digest_at` drives the single weekly
-- consolidated notification cadence (FR-PAR-004). Synthetic students hold no PII and
-- have no parent link, so they can never appear on a parent surface (M4 quarantine).

CREATE TABLE parent_children (
  id             text PRIMARY KEY,
  school_id      text NOT NULL REFERENCES schools(id),
  parent_id      text NOT NULL REFERENCES users(id),
  student_id     text NOT NULL REFERENCES users(id),
  relationship   text NOT NULL,
  verified       boolean NOT NULL DEFAULT false,
  verified_at    timestamptz,
  last_digest_at timestamptz,
  created_at     timestamptz NOT NULL,
  UNIQUE (parent_id, student_id)
);
CREATE INDEX parent_children_parent_idx ON parent_children(parent_id);
CREATE INDEX parent_children_school_idx ON parent_children(school_id);
