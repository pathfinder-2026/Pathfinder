-- Pathfinder — Milestone 2: Skill Graph (versioned trusted infrastructure).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Foundational Decision 4:
--  - the prerequisite graph is validated acyclic on import and on every edit
--    (enforced in the service layer; cycle detection is required);
--  - difficulty is an item attribute (content_mappings.difficulty), NEVER a node
--    (skill_nodes.type is constrained to the hierarchy, excluding 'difficulty');
--  - a graph version must be curriculum-expert SIGNED OFF before content is
--    mapped against it (status = 'signed_off').

CREATE TABLE skill_graph_versions (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  curriculum     text NOT NULL,
  version        text NOT NULL,
  status         text NOT NULL DEFAULT 'draft',   -- 'draft' | 'signed_off'
  signed_off_by  text,
  signed_off_at  timestamptz,
  created_at     timestamptz NOT NULL,
  CONSTRAINT skill_graph_status_valid CHECK (status IN ('draft','signed_off'))
);

CREATE TABLE skill_nodes (
  graph_version_id text NOT NULL REFERENCES skill_graph_versions(id),
  id               text NOT NULL,
  type             text NOT NULL,
  label            text NOT NULL,
  code             text,
  parent_id        text,
  curriculum       text NOT NULL,
  foundational     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (graph_version_id, id),
  -- Difficulty can never be a node (Foundational Decision 4).
  CONSTRAINT skill_node_type_valid CHECK (
    type IN ('subject','strand','outcome','topic','concept','skill','subskill')
  )
);

CREATE TABLE skill_prerequisites (
  graph_version_id text NOT NULL REFERENCES skill_graph_versions(id),
  from_node        text NOT NULL,
  to_node          text NOT NULL,
  PRIMARY KEY (graph_version_id, from_node, to_node)
);

CREATE TABLE content_mappings (
  id                       text PRIMARY KEY,
  graph_version_id         text NOT NULL REFERENCES skill_graph_versions(id),
  content_item_id          text NOT NULL REFERENCES content_items(id),
  node_id                  text NOT NULL,
  source                   text NOT NULL,          -- 'ai' | 'teacher'
  difficulty               text NOT NULL,          -- item attribute, never a node
  overridden_from_node_id  text,
  flags                    jsonb NOT NULL,
  created_at               timestamptz NOT NULL
);
CREATE INDEX content_mappings_content_idx ON content_mappings(content_item_id);

CREATE TABLE school_curricula (
  school_id                text PRIMARY KEY REFERENCES schools(id),
  curriculum               text NOT NULL,
  custom_outcomes_defined  boolean NOT NULL DEFAULT true
);
