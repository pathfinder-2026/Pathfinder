-- Pathfinder -- Appendix Milestone A: CSV import + SSO (FR-ADM-003 / FR-INT-001).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- CSV import needs no new tables (it creates ordinary users/memberships/enrolments
-- through the existing schema). SSO needs one small per-school config table: which
-- provider a school federates with, and the single email domain permitted to sign
-- in. A sign-in for an email outside `domain` is denied (FR-ADM-003 mismatch row);
-- an upstream-revoked account is handled at the application layer by deleting the
-- user's sessions (FR-INT-001) -- no schema change, the sessions table already exists.

CREATE TABLE sso_configs (
  school_id     text PRIMARY KEY REFERENCES schools(id),
  -- 'google' (Google Workspace) or 'microsoft' (Microsoft Entra ID).
  provider      text NOT NULL,
  -- Permitted email domain, stored lower-cased without a leading '@'.
  domain        text NOT NULL,
  configured_by text NOT NULL REFERENCES users(id),
  configured_at timestamptz NOT NULL
);
