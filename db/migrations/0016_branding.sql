-- Pathfinder -- Appendix Milestone B: White-label / multi-tenant branding (FR-WL-001..004).
-- Target: Amazon RDS/Aurora PostgreSQL, ap-southeast-2 (Foundational Decision 1).
--
-- Branding touches ONLY the themeable brand layer (Foundational Decision 5) -- there is
-- no column here for a governance-status colour, by design (FR-WL-004). Per-school config
-- holds the brand colour (stored only after passing the WCAG-AA floor), the sanitised logo
-- reference, and the white-label toggle. Logo assets are tracked separately so a missing
-- asset can be detected (text fallback, FR-WL-003). Reports are point-in-time artifacts:
-- each stores the branding snapshot resolved at issue, so a later branding change never
-- rebrands it (FR-WL-002 / FR-WL-003).

CREATE TABLE branding_configs (
  school_id           text PRIMARY KEY REFERENCES schools(id),
  product_name        text NOT NULL,
  primary_color       text NOT NULL,
  accent_color        text NOT NULL,
  white_label_enabled boolean NOT NULL DEFAULT false,
  logo_key            text,
  logo_format         text,
  configured_by       text NOT NULL REFERENCES users(id),
  updated_at          timestamptz NOT NULL
);

CREATE TABLE branding_logo_assets (
  key        text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  format     text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE branded_reports (
  id         text PRIMARY KEY,
  school_id  text NOT NULL REFERENCES schools(id),
  kind       text NOT NULL,
  branding   jsonb NOT NULL,
  payload    jsonb,
  issued_at  timestamptz NOT NULL
);
