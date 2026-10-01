-- Reviewed additive migration. Apply with the migration role, never the runtime role.
-- All ownership keys are retained. No auth/account data is inferred from email.
CREATE TABLE IF NOT EXISTS arcana_external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
-- The previous schema made principal_id unique. A principal may now have multiple
-- explicitly verified identities; issuer+subject remains unique and authoritative.
ALTER TABLE arcana_external_identities
  DROP CONSTRAINT IF EXISTS arcana_external_identities_principal_id_key;
CREATE INDEX IF NOT EXISTS arcana_external_identities_principal_idx
  ON arcana_external_identities (principal_id);
CREATE TABLE IF NOT EXISTS arcana_identity_link_audit (
  id text PRIMARY KEY,
  principal_id text NOT NULL,
  source_issuer text NOT NULL,
  source_subject text NOT NULL,
  target_issuer text NOT NULL,
  target_subject text NOT NULL,
  evidence_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arcana_host_state (
  scope_id text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arcana_user_decks (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  slug text NOT NULL,
  manifest jsonb NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (owner_id, slug)
);
CREATE INDEX IF NOT EXISTS arcana_user_decks_owner_updated_idx
  ON arcana_user_decks (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS arcana_user_decks_public_published_idx
  ON arcana_user_decks (published_at DESC, updated_at DESC) WHERE visibility = 'public';
CREATE TABLE IF NOT EXISTS arcana_rate_limits (
  key text PRIMARY KEY,
  bucket bigint NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS arcana_rate_limits_expiry_idx ON arcana_rate_limits (expires_at);
