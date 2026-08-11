-- Pathfinder -- Milestone 11: Governance / audit hardening pass.
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- A configurable retention period (FR-GOV-003). The retention job deletes data
-- older than this and logs its OWN deletions to the append-only audit (Decision 3).
-- Data-subject erasure (FR-GOV-006) removes PII from personal_data while the
-- id-only, hash-chained audit rows persist unchanged, preserving the chain.

ALTER TABLE school_policies ADD COLUMN retention_days integer;
