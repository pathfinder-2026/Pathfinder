-- Pathfinder — Milestone 5b: Peer Benchmarking, Peer Review & Peer Testing.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Peer results follow PUBLISH-OR-WITHHOLD, never edit-then-approve. Computed
-- figures are not stored — they are derived from submissions (+ the logged
-- correction path) on read, so there is nothing to "edit". `benchmark_publish`
-- defaults to 'withheld': no comparative data reaches a student without an
-- explicit teacher decision, and never on a timer.

CREATE TABLE peer_tests (
  id                text PRIMARY KEY,
  school_id         text NOT NULL REFERENCES schools(id),
  teacher_id        text NOT NULL REFERENCES users(id),
  title             text NOT NULL,
  node_id           text NOT NULL,
  question_count    integer NOT NULL,
  rubric            text,
  cohort            jsonb NOT NULL,
  anonymity         text NOT NULL,
  accommodations    jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  benchmark_publish text NOT NULL DEFAULT 'withheld',
  scheduled_start   timestamptz,
  launched_at       timestamptz,
  closed_at         timestamptz,
  cancelled_at      timestamptz,
  warnings          jsonb NOT NULL,
  created_at        timestamptz NOT NULL,
  CONSTRAINT peer_tests_status_chk CHECK (status IN ('draft','scheduled','launched','closed','cancelled')),
  CONSTRAINT peer_tests_publish_chk CHECK (benchmark_publish IN ('withheld','published'))
);
CREATE INDEX peer_tests_school_idx ON peer_tests(school_id);

CREATE TABLE peer_test_submissions (
  id           text PRIMARY KEY,
  peer_test_id text NOT NULL REFERENCES peer_tests(id),
  student_id   text NOT NULL REFERENCES users(id),
  score        double precision NOT NULL,
  submitted_at timestamptz NOT NULL
);
CREATE INDEX peer_test_submissions_test_idx ON peer_test_submissions(peer_test_id);

-- The separate, logged correction path (never a silent edit of computed data).
CREATE TABLE peer_corrections (
  id             text PRIMARY KEY,
  peer_test_id   text NOT NULL REFERENCES peer_tests(id),
  student_id     text NOT NULL REFERENCES users(id),
  previous_score double precision NOT NULL,
  corrected_score double precision NOT NULL,
  reason         text NOT NULL,
  corrected_by   text NOT NULL REFERENCES users(id),
  at             timestamptz NOT NULL
);
CREATE INDEX peer_corrections_test_idx ON peer_corrections(peer_test_id);

CREATE TABLE peer_reviews (
  id                text PRIMARY KEY,
  school_id         text NOT NULL REFERENCES schools(id),
  peer_test_id      text NOT NULL REFERENCES peer_tests(id),
  reviewer_id       text NOT NULL REFERENCES users(id),
  target_student_id text NOT NULL REFERENCES users(id),
  text              text NOT NULL,
  moderation_state  text NOT NULL DEFAULT 'pending',
  moderated_by      text REFERENCES users(id),
  moderated_at      timestamptz,
  created_at        timestamptz NOT NULL,
  CONSTRAINT peer_reviews_state_chk CHECK (moderation_state IN ('pending','approved','rejected'))
);
CREATE INDEX peer_reviews_test_idx ON peer_reviews(peer_test_id);
CREATE INDEX peer_reviews_target_idx ON peer_reviews(target_student_id);

CREATE TABLE peer_placements (
  id           text PRIMARY KEY,
  peer_test_id text NOT NULL REFERENCES peer_tests(id),
  student_id   text NOT NULL REFERENCES users(id),
  placed_at    timestamptz NOT NULL
);
CREATE INDEX peer_placements_student_idx ON peer_placements(student_id);
CREATE INDEX peer_placements_test_idx ON peer_placements(peer_test_id);
