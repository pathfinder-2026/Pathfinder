-- Pathfinder — one signed-off skill graph per subject × year level.
-- Until now a school had exactly one graph (the NSW Year 8 Mathematics seed),
-- so every teacher of every subject picked from the same maths skill list and
-- an uploaded Science/Technology syllabus had nothing to map onto (topics = 0,
-- the ADR-0035 gap). Graphs now carry the subject and year they teach, and are
-- resolved against the class being taught.
--
-- Node ids stay GLOBALLY unique across graphs on purpose: mastery_records and
-- content mappings reference a bare node id, so a collision between two graphs
-- would silently merge two different skills' evidence. Enforced on import.

ALTER TABLE skill_graph_versions ADD COLUMN subject text;
ALTER TABLE skill_graph_versions ADD COLUMN year_level integer;

-- Classes name the subject they teach so the right graph can be resolved from
-- class context (year_group already exists).
ALTER TABLE classes ADD COLUMN subject text;

-- Existing rows: the only graph ever seeded is NSW Year 8 Mathematics. Left
-- NULL deliberately rather than guessed — a NULL subject means "unscoped", which
-- still serves every request, so live data keeps working until an admin states
-- the scope explicitly.
