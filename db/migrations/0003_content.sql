-- Pathfinder — Milestone 1: Content Studio + Knowledge Engine.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
-- Source objects live in Amazon S3 (ap-southeast-2); rows here hold metadata +
-- the storage key. The teacher-approval gate is load-bearing: only rows whose
-- governance_status = 'approved' (plus rights_attested, scan-clean, ingested,
-- classification approved) are read by downstream features.

-- Department-scoped content sharing (FR-CONT-004).
ALTER TABLE memberships ADD COLUMN department text;

CREATE TABLE content_items (
  id                 text PRIMARY KEY,
  school_id          text NOT NULL REFERENCES schools(id),
  owner_teacher_id   text NOT NULL REFERENCES users(id),
  title              text NOT NULL,
  current_version_id text NOT NULL,
  governance_status  text NOT NULL DEFAULT 'draft',
  approved_by        text,
  approved_at        timestamptz,
  published_at       timestamptz,
  rights_attested    boolean NOT NULL DEFAULT false,
  archived           boolean NOT NULL DEFAULT false,
  share_type         text NOT NULL DEFAULT 'private',
  share_class_id     text REFERENCES classes(id),
  share_department   text,
  created_at         timestamptz NOT NULL
);
CREATE INDEX content_items_school_idx ON content_items(school_id);

CREATE TABLE content_versions (
  id                     text PRIMARY KEY,
  content_item_id        text NOT NULL REFERENCES content_items(id),
  version_number         bigint NOT NULL,
  file_type              text NOT NULL,
  size_bytes             bigint NOT NULL,
  content_hash           text NOT NULL,
  storage_key            text NOT NULL,
  uploaded_by_teacher_id text NOT NULL REFERENCES users(id),
  scan_status            text NOT NULL,
  ingestion_status       text NOT NULL,
  created_at             timestamptz NOT NULL
);
CREATE INDEX content_versions_item_idx ON content_versions(content_item_id);

CREATE TABLE classifications (
  id                     text PRIMARY KEY,
  content_item_id        text NOT NULL REFERENCES content_items(id),
  subject                text NOT NULL,
  year                   bigint NOT NULL,
  topic                  text NOT NULL,
  outcome                text NOT NULL,
  difficulty             text NOT NULL,
  confidence             text NOT NULL,
  low_confidence         boolean NOT NULL,
  status                 text NOT NULL,
  reviewed_by_teacher_id text REFERENCES users(id)
);

CREATE TABLE chunks (
  id                 text PRIMARY KEY,
  content_version_id text NOT NULL REFERENCES content_versions(id),
  heading            text NOT NULL,
  text               text NOT NULL,
  "order"            bigint NOT NULL
);
CREATE INDEX chunks_version_idx ON chunks(content_version_id);

CREATE TABLE concepts (
  id                 text PRIMARY KEY,
  content_version_id text NOT NULL REFERENCES content_versions(id),
  name               text NOT NULL
);
CREATE INDEX concepts_version_idx ON concepts(content_version_id);

CREATE TABLE outcomes (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  code        text NOT NULL,
  description text NOT NULL,
  deprecated  boolean NOT NULL DEFAULT false
);

CREATE TABLE questions (
  id          text PRIMARY KEY,
  school_id   text NOT NULL REFERENCES schools(id),
  text        text NOT NULL,
  outcome_ids jsonb NOT NULL
);

CREATE TABLE lessons (
  id           text PRIMARY KEY,
  school_id    text NOT NULL REFERENCES schools(id),
  title        text NOT NULL,
  question_ids jsonb NOT NULL,
  outcome_ids  jsonb NOT NULL
);

CREATE TABLE content_references (
  id              text PRIMARY KEY,
  content_item_id text NOT NULL REFERENCES content_items(id),
  ref_type        text NOT NULL,
  ref_id          text NOT NULL,
  active          boolean NOT NULL
);
CREATE INDEX content_references_item_idx ON content_references(content_item_id);
