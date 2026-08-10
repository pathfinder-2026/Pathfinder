-- Pathfinder — Milestone 5a: Teacher Dashboard, Cohorts, Class-Focus, Adaptive.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- The intelligence layer reads the Milestone 4 mastery substrate. Two additive,
-- nullable columns let it show a TREND (not just the latest point) and reconcile
-- INDEPENDENT vs ASSISTED signals — without disturbing the M4 quarantine schema.

ALTER TABLE mastery_records ADD COLUMN history jsonb;
ALTER TABLE mastery_records ADD COLUMN assisted_score double precision;

-- Focus-area suggestions a Teacher dismissed. Recording the below-mastery
-- fraction AT dismissal lets a suggestion stay hidden next session, yet reappear
-- if the underlying data significantly worsens again (FR-TDB-002).
CREATE TABLE focus_dismissals (
  id                        text PRIMARY KEY,
  school_id                 text NOT NULL REFERENCES schools(id),
  class_id                  text NOT NULL REFERENCES classes(id),
  teacher_id                text NOT NULL REFERENCES users(id),
  node_id                   text NOT NULL,
  below_fraction_at_dismiss double precision NOT NULL,
  dismissed_at              timestamptz NOT NULL
);
CREATE INDEX focus_dismissals_class_idx ON focus_dismissals(school_id, class_id);

-- A Teacher's explicit assignment of work to an (edited) group. The membership
-- is stored as it was at assign time, so removing a student before assigning
-- means only the remaining students receive the work (FR-COH-002). Student ids
-- ride as jsonb (not a FK) so synthetic-student deletion never breaks history.
CREATE TABLE group_assignments (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  class_id    text NOT NULL REFERENCES classes(id),
  teacher_id  text NOT NULL REFERENCES users(id),
  group_type  text NOT NULL,
  node_id     text,
  student_ids jsonb NOT NULL,
  content_id  text,
  created_at  timestamptz NOT NULL
);
CREATE INDEX group_assignments_class_idx ON group_assignments(school_id, class_id);
