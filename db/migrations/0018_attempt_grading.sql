-- Pathfinder — real grading on assessment attempt submission.
-- Submitting an attempt now grades every answered question against its model
-- answer/rubric through the AI service layer and records the result on the
-- attempt (reviewable by the Teacher at any time, never sent to the student)
-- as well as one real (non-synthetic) mastery data point per skill-graph node
-- -- previously the only way mastery data existed at all was the test-only
-- synthetic seeder, so Class Insights (heatmap/focus-areas/cohorts/adaptive)
-- had no real signal to work from regardless of how many students submitted.

ALTER TABLE assessment_attempts ADD COLUMN graded_score numeric;
ALTER TABLE assessment_attempts ADD COLUMN graded_results jsonb;
ALTER TABLE assessment_attempts ADD COLUMN graded_at timestamptz;
