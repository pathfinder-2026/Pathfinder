-- Pathfinder — Milestone 0 initial schema.
-- Target: Amazon RDS/Aurora PostgreSQL in ap-southeast-2 (Foundational Decision 1).
-- Data minimisation (Decision 6): all PII is isolated in `personal_data`.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- digest() for the audit hash chain

CREATE TABLE schools (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  settings        jsonb NOT NULL,
  config_complete boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL
);

CREATE TABLE campuses (
  id             text PRIMARY KEY,
  school_id      text NOT NULL REFERENCES schools(id),
  name           text NOT NULL,
  settings       jsonb NOT NULL,
  setup_complete boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL
);

CREATE TABLE academic_years (
  id         text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  campus_id  text REFERENCES campuses(id),
  name       text NOT NULL
);

CREATE TABLE terms (
  id               text PRIMARY KEY,
  academic_year_id text NOT NULL REFERENCES academic_years(id),
  name             text NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  CONSTRAINT terms_dates_ordered CHECK (end_date > start_date)
);

CREATE TABLE classes (
  id         text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  campus_id  text NOT NULL REFERENCES campuses(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE users (
  id         text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  status     text NOT NULL,
  created_at timestamptz NOT NULL
);

-- Isolated, erasable PII (Decision 6). A data-subject erasure deletes the row
-- here while users/memberships/audit_log (the retained facts) remain.
CREATE TABLE personal_data (
  user_id    text PRIMARY KEY REFERENCES users(id),
  email      text NOT NULL,
  first_name text NOT NULL,
  last_name  text NOT NULL
);
CREATE UNIQUE INDEX personal_data_email_idx ON personal_data(email);

CREATE TABLE memberships (
  id        text PRIMARY KEY,
  user_id   text NOT NULL REFERENCES users(id),
  school_id text NOT NULL REFERENCES schools(id),
  role      text NOT NULL,
  campus_id text REFERENCES campuses(id),
  class_id  text REFERENCES classes(id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);
CREATE INDEX memberships_school_idx ON memberships(school_id);

CREATE TABLE invites (
  id         text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  role       text NOT NULL,
  token      text NOT NULL,
  user_id    text NOT NULL REFERENCES users(id),
  status     text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX invites_token_idx ON invites(token);

CREATE TABLE enrolments (
  id         text PRIMARY KEY,
  student_id text NOT NULL REFERENCES users(id),
  class_id   text NOT NULL REFERENCES classes(id),
  school_id  text NOT NULL REFERENCES schools(id),
  active     boolean NOT NULL
);

CREATE TABLE enrolment_history (
  id         text PRIMARY KEY,
  student_id text NOT NULL REFERENCES users(id),
  class_id   text NOT NULL REFERENCES classes(id),
  teacher_id text REFERENCES users(id),
  ended_at   timestamptz NOT NULL
);

-- AI claims about a student. Empty in Milestone 0. approval_state exists from
-- the first schema (Decision 7) so the review gate can be enabled later
-- WITHOUT a migration.
CREATE TABLE inference_records (
  id             text PRIMARY KEY,
  student_id     text NOT NULL REFERENCES users(id),
  school_id      text NOT NULL REFERENCES schools(id),
  kind           text NOT NULL,
  claim          text NOT NULL,
  approval_state text NOT NULL DEFAULT 'unreviewed',
  created_at     timestamptz NOT NULL
);

-- Append-only, hash-chained audit log (Decision 3). Grants + immutability
-- trigger are applied in 0002_audit_log_grants.sql.
CREATE TABLE audit_log (
  id           text PRIMARY KEY,
  seq          bigint NOT NULL,
  at           timestamptz NOT NULL,
  action       text NOT NULL,
  actor_id     text,
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  metadata     jsonb NOT NULL,
  prev_hash    text NOT NULL,
  row_hash     text NOT NULL
);
CREATE UNIQUE INDEX audit_log_seq_idx ON audit_log(seq);

CREATE TABLE notifications (
  id        text PRIMARY KEY,
  type      text NOT NULL,
  to_target text NOT NULL,
  subject   text NOT NULL,
  body      text NOT NULL,
  context   jsonb NOT NULL,
  at        timestamptz NOT NULL
);

CREATE TABLE credentials (
  user_id text PRIMARY KEY REFERENCES users(id),
  hash    text NOT NULL,
  salt    text NOT NULL
);

CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE onboarding_progress (
  school_id         text PRIMARY KEY REFERENCES schools(id),
  completed_steps   jsonb NOT NULL,
  workspace_entered boolean NOT NULL DEFAULT false
);
