-- Pathfinder — the assign-work flow (teacher UI review, task #9).
-- Teachers can now assign one piece of work to many students in one action,
-- including a BASELINE diagnostic when starting a new concept: its graded
-- results become the first real mastery data points, giving the growth report
-- a genuine starting line instead of 0% → 0% and un-cold-starting the heatmap.

ALTER TABLE student_tasks ADD COLUMN baseline boolean NOT NULL DEFAULT false;
