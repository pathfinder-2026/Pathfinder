-- Pathfinder — teacher question editing + manual assessment authoring (task #6).
-- Teachers can now edit or delete AI-drafted questions while an assessment is a
-- draft, and write their own assessments from scratch. Authorship is recorded:
-- an edited question is no longer verbatim-grounded, and a teacher-authored one
-- never was — both facts are honest metadata on the question, not hidden.

ALTER TABLE assessment_questions ADD COLUMN teacher_edited boolean NOT NULL DEFAULT false;
ALTER TABLE assessment_questions ADD COLUMN teacher_authored boolean NOT NULL DEFAULT false;
