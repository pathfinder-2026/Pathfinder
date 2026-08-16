-- Pathfinder — readable material on student tasks ("where is the worksheet?").
-- A task can now carry one approved content item; the student task view renders
-- its sections. Approved-pool membership is enforced at assign time and
-- re-checked at read time (Decision 7 — only teacher-approved material ever
-- reaches a student).

ALTER TABLE student_tasks ADD COLUMN content_id text REFERENCES content_items(id);
