-- Pathfinder — Milestone 7: Student Workspace + Ask for Help (highest-risk).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Ask for Help is homework/practice-only and locked out during assessments AT THE
-- TASK-STATE LAYER (never merely prompt-instructed). Transcripts are visible to the
-- assigning teacher, never to a Principal. A school with no configured safeguarding
-- contact + SLA cannot enable Ask for Help at all (FR-SAF-002 config, collected in
-- the configure-operations onboarding step).

-- Year group on classes -> drives restricted calendar-event visibility (FR-STU-004).
ALTER TABLE classes ADD COLUMN year_group text;

CREATE TABLE safeguarding_configs (
  school_id          text PRIMARY KEY REFERENCES schools(id),
  contact_name       text NOT NULL,
  contact_role       text NOT NULL,
  sla_hours          integer NOT NULL,
  after_hours_policy text NOT NULL,
  configured_by      text NOT NULL REFERENCES users(id),
  configured_at      timestamptz NOT NULL
);

CREATE TABLE student_tasks (
  id           text PRIMARY KEY,
  school_id    text NOT NULL REFERENCES schools(id),
  student_id   text NOT NULL REFERENCES users(id),
  class_id     text REFERENCES classes(id),
  teacher_id   text NOT NULL REFERENCES users(id),
  type         text NOT NULL,
  title        text NOT NULL,
  node_id      text,
  assessment_id text,
  due_date     timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'assigned',
  completed_at timestamptz,
  overdue_notified boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL,
  CONSTRAINT student_tasks_type_chk CHECK (type IN ('homework','practice','assessment')),
  CONSTRAINT student_tasks_status_chk CHECK (status IN ('assigned','completed'))
);
CREATE INDEX student_tasks_student_idx ON student_tasks(student_id);

CREATE TABLE calendar_events (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  title       text NOT NULL,
  type        text NOT NULL,
  event_date  timestamptz NOT NULL,
  year_group  text,               -- null = visible to all year groups
  source_id   text,               -- e.g. the assessment this event mirrors
  changed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL
);
CREATE INDEX calendar_events_school_idx ON calendar_events(school_id);

CREATE TABLE help_sessions (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  student_id  text NOT NULL REFERENCES users(id),
  task_id     text NOT NULL REFERENCES student_tasks(id),
  teacher_id  text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL
);
CREATE INDEX help_sessions_task_idx ON help_sessions(task_id);
CREATE INDEX help_sessions_student_idx ON help_sessions(student_id);

CREATE TABLE help_messages (
  id          text PRIMARY KEY,
  session_id  text NOT NULL REFERENCES help_sessions(id),
  role        text NOT NULL,
  text        text NOT NULL,
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL,
  CONSTRAINT help_messages_role_chk CHECK (role IN ('student','assistant'))
);
CREATE INDEX help_messages_session_idx ON help_messages(session_id);
