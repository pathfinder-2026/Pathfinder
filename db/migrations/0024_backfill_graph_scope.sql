-- Pathfinder — backfill subject/year on curriculum graphs imported before those
-- columns existed (0020 added them; the import-time derivation came later).
--
-- Without this, a school whose only graph predates the change sees the skill
-- picker drop its Year level entirely — the picker correctly refuses to invent
-- a year it has no data for, so the data has to be filled in rather than faked.
--
-- Both statements are idempotent and only touch rows still NULL, so re-running
-- is safe and a graph an admin has already scoped explicitly is never overwritten.

-- Subject: the graph's own subject node is the authority.
UPDATE skill_graph_versions v
SET subject = (
  SELECT n.label FROM skill_nodes n
  WHERE n.graph_version_id = v.id AND n.type = 'subject'
  ORDER BY n.id LIMIT 1
)
WHERE v.subject IS NULL;

-- Year: curriculum sources state it in prose far more often than in a field
-- ("Pathfinder Skill Graph - NSW Year 8 Mathematics"). Only a plausible school
-- year (1-13) is accepted.
UPDATE skill_graph_versions
SET year_level = CAST(substring(name from 'Year ([0-9]{1,2})') AS integer)
WHERE year_level IS NULL
  AND name ~ 'Year [0-9]{1,2}'
  AND CAST(substring(name from 'Year ([0-9]{1,2})') AS integer) BETWEEN 1 AND 13;
