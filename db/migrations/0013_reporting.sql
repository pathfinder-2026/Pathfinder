-- Pathfinder -- Milestone 10: Reporting (academic, co-curricular, behavioural/social).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Behavioural/social data lives in its OWN model, separate from academic mastery
-- everywhere it is displayed. The v1.3 MVP default: four observation categories
-- only, teacher-authored notes, NO AI inference; collection is disabled for any
-- school whose parental-consent mechanism is not yet configured; Parent visibility
-- is off until the school enables it. Co-curricular capability uses its own simpler
-- structure (domain + free-text skill), not the academic skill graph.

-- Behavioural/social consent + parent-visibility gates live on the school policy.
ALTER TABLE school_policies ADD COLUMN behavioural_consent_configured boolean NOT NULL DEFAULT false;
ALTER TABLE school_policies ADD COLUMN behavioural_parent_visible boolean NOT NULL DEFAULT false;

CREATE TABLE behavioural_observations (
  id                text PRIMARY KEY,
  school_id         text NOT NULL REFERENCES schools(id),
  student_id        text NOT NULL REFERENCES users(id),
  category          text NOT NULL,
  note              text NOT NULL,
  author_teacher_id text NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL,
  CONSTRAINT behavioural_category_chk
    CHECK (category IN ('collaboration','communication','resilience','participation'))
);
CREATE INDEX behavioural_observations_student_idx ON behavioural_observations(student_id);

CREATE TABLE cocurricular_records (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  student_id  text NOT NULL REFERENCES users(id),
  domain      text NOT NULL,
  skill       text NOT NULL,
  level       text NOT NULL,
  teacher_id  text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL,
  CONSTRAINT cocurricular_domain_chk CHECK (domain IN ('sport','arts','music'))
);
CREATE INDEX cocurricular_records_student_idx ON cocurricular_records(student_id);

CREATE TABLE teacher_comments (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  student_id  text NOT NULL REFERENCES users(id),
  teacher_id  text NOT NULL REFERENCES users(id),
  text        text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX teacher_comments_student_idx ON teacher_comments(student_id);

-- Licences drive the prorated cost report (FR-REP-002 partial-month billing).
CREATE TABLE licences (
  id           text PRIMARY KEY,
  school_id    text NOT NULL REFERENCES schools(id),
  seats        integer NOT NULL,
  monthly_rate double precision NOT NULL,
  start_date   date NOT NULL,
  end_date     date,
  created_at   timestamptz NOT NULL
);
CREATE INDEX licences_school_idx ON licences(school_id);
