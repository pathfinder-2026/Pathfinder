-- Append-only, hash-chained audit log — database-level enforcement.
-- Foundational Decision 3: the application role holds INSERT + SELECT only
-- (no UPDATE, no DELETE); retention-driven deletion runs as a separate,
-- privileged, itself-logged job; rows are hash-chained so tampering is
-- detectable.

-- ---------------------------------------------------------------------------
-- 1. Application role: INSERT + SELECT on audit_log ONLY.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pathfinder_app') THEN
    CREATE ROLE pathfinder_app NOLOGIN;
  END IF;
END $$;

-- Start from no privileges, then grant exactly INSERT + SELECT.
REVOKE ALL ON audit_log FROM pathfinder_app;
GRANT INSERT, SELECT ON audit_log TO pathfinder_app;
-- Deliberately NOT granted: UPDATE, DELETE, TRUNCATE.

-- Separate privileged role for retention-driven deletion (itself logged).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pathfinder_audit_retention') THEN
    CREATE ROLE pathfinder_audit_retention NOLOGIN;
  END IF;
END $$;
GRANT SELECT, DELETE ON audit_log TO pathfinder_audit_retention;

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: block UPDATE/TRUNCATE, and block DELETE unless the
--    caller is the retention role. Defense-in-depth on top of the grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_block_mutations() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: UPDATE is not permitted';
  ELSIF TG_OP = 'DELETE' THEN
    IF current_user <> 'pathfinder_audit_retention' THEN
      RAISE EXCEPTION 'audit_log rows may only be deleted by the retention job';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutations();

CREATE TRIGGER audit_log_guard_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutations();

-- ---------------------------------------------------------------------------
-- 3. Hash-chain integrity on INSERT: seq must be monotonic and prev_hash must
--    equal the previous row's row_hash (genesis = 64 zeros for the first row).
--    The application computes row_hash over canonical content; this trigger
--    enforces ordering and linkage so no row can be inserted out of chain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_enforce_chain() RETURNS trigger AS $$
DECLARE
  last_seq   bigint;
  last_hash  text;
  genesis    text := repeat('0', 64);
BEGIN
  SELECT seq, row_hash INTO last_seq, last_hash
  FROM audit_log ORDER BY seq DESC LIMIT 1;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 0 THEN
      RAISE EXCEPTION 'first audit row must have seq = 0';
    END IF;
    IF NEW.prev_hash <> genesis THEN
      RAISE EXCEPTION 'first audit row prev_hash must be the genesis hash';
    END IF;
  ELSE
    IF NEW.seq <> last_seq + 1 THEN
      RAISE EXCEPTION 'audit seq must be contiguous (expected %)', last_seq + 1;
    END IF;
    IF NEW.prev_hash <> last_hash THEN
      RAISE EXCEPTION 'audit prev_hash must match the previous row_hash';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_enforce_chain();
