-- Pathfinder — official syllabus documents (Content Studio extension).
-- A content item can be tagged as THE official syllabus for a subject + year
-- level, with a reference link to where it came from (NESA's curriculum site
-- has no public API — see docs/decisions.md ADR-0035 — so this is a stored
-- reference link the uploader provides, never a guessed/generated URL).
-- Tagging is orthogonal to the existing governance pipeline: a tagged item
-- still must pass ingestion, classification approval, rights attestation and
-- governance approval before it enters the approved pool / can be mapped or
-- used for AI grounding, exactly like any other content item.

ALTER TABLE content_items ADD COLUMN syllabus_subject text;
ALTER TABLE content_items ADD COLUMN syllabus_year_level integer;
ALTER TABLE content_items ADD COLUMN syllabus_source_url text;

-- Fast "is there already an official syllabus for this subject+year" lookup.
-- Partial index — only rows actually tagged as a syllabus are indexed.
CREATE INDEX content_items_official_syllabus_idx
  ON content_items(school_id, syllabus_subject, syllabus_year_level)
  WHERE syllabus_subject IS NOT NULL;
