-- Fully additive: the existing arcana_card_artwork table, keys and JSON remain unchanged.
-- Old deployments can keep writing the default set during rollout and after rollback.
-- No existing asset is copied, rewritten or deleted, and no private blob is touched.
CREATE TABLE IF NOT EXISTS arcana_visual_packs (
  deck_id text NOT NULL REFERENCES arcana_user_decks(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  label text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, pack_id),
  CHECK (pack_id <> 'saved-artwork'),
  CHECK (length(pack_id) BETWEEN 1 AND 80 AND pack_id ~ '^[a-z0-9]+([-_.][a-z0-9]+)*$'),
  CHECK (length(label) BETWEEN 1 AND 80),
  CHECK (description IS NULL OR length(description) <= 500)
);
CREATE TABLE IF NOT EXISTS arcana_visual_pack_artwork (
  deck_id text NOT NULL,
  pack_id text NOT NULL,
  card_slug text NOT NULL,
  asset jsonb NOT NULL,
  PRIMARY KEY (deck_id,pack_id,card_slug),
  FOREIGN KEY (deck_id,pack_id) REFERENCES arcana_visual_packs(deck_id,pack_id) ON DELETE CASCADE,
  CHECK (asset->>'deckId' IS NOT NULL AND asset->>'deckId'=deck_id),
  CHECK (asset->>'packId' IS NOT NULL AND asset->>'packId'=pack_id),
  CHECK (asset->>'cardSlug' IS NOT NULL AND asset->>'cardSlug'=card_slug),
  CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')
);
