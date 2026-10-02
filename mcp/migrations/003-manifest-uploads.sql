-- Additive private staging only. No changes to existing decks, accounts or artwork.
CREATE TABLE IF NOT EXISTS arcana_manifest_uploads (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  ticket_hash text NOT NULL,
  expected_bytes integer NOT NULL CHECK (expected_bytes BETWEEN 1 AND 2000000),
  expected_sha256 text CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$'),
  raw_json text,
  sha256 text,
  byte_length integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  import_request jsonb,
  import_result jsonb,
  CHECK (raw_json IS NULL OR octet_length(raw_json) <= 2000000),
  CHECK (byte_length IS NULL OR byte_length BETWEEN 1 AND 2000000),
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((import_request IS NULL) = (import_result IS NULL))
);
CREATE INDEX IF NOT EXISTS arcana_manifest_uploads_owner_expiry ON arcana_manifest_uploads(owner_id, expires_at);
CREATE INDEX IF NOT EXISTS arcana_manifest_uploads_expiry ON arcana_manifest_uploads(expires_at);
