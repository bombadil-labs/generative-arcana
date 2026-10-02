-- Additive MCP-only draft metadata on the existing private staging table.
-- No deck, account, artwork, permission or existing upload content changes.
-- Nullable columns leave legacy immutable uploads and receipts unchanged.
-- Editing content never occupies raw_json, so even old replicas cannot import it.
ALTER TABLE arcana_manifest_uploads ADD COLUMN IF NOT EXISTS draft_version integer;
ALTER TABLE arcana_manifest_uploads ADD COLUMN IF NOT EXISTS draft_key text;
ALTER TABLE arcana_manifest_uploads ADD COLUMN IF NOT EXISTS draft_history jsonb;
ALTER TABLE arcana_manifest_uploads ADD COLUMN IF NOT EXISTS draft_json text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='arcana_manifest_draft_bounds' AND conrelid='arcana_manifest_uploads'::regclass) THEN
    ALTER TABLE arcana_manifest_uploads ADD CONSTRAINT arcana_manifest_draft_bounds CHECK (
      (draft_version IS NULL AND draft_key IS NULL AND draft_history IS NULL AND draft_json IS NULL) OR
      (draft_version IS NOT NULL AND draft_key IS NOT NULL AND draft_history IS NOT NULL
       AND draft_version BETWEEN 1 AND 513
       AND length(draft_key) BETWEEN 1 AND 80 AND draft_key ~ '^[A-Za-z0-9_-]+$'
       AND jsonb_typeof(draft_history)='object' AND octet_length(draft_history::text)<=131072
       AND raw_json IS NULL AND (draft_json IS NULL OR octet_length(draft_json)<=2000000)
       AND ((draft_json IS NULL) = (import_result IS NOT NULL)))
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS arcana_manifest_drafts_owner_key
  ON arcana_manifest_uploads(owner_id,draft_key) WHERE draft_key IS NOT NULL;
