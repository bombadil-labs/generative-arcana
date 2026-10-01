-- Explicit, additive opt-in migration. Does not grant bucket access or enable uploads.
-- The deck FK revokes metadata on deck deletion. Storage garbage collection is separate.
CREATE TABLE IF NOT EXISTS arcana_card_artwork (
  deck_id text NOT NULL REFERENCES arcana_user_decks(id) ON DELETE CASCADE,
  card_slug text NOT NULL,
  asset jsonb NOT NULL,
  PRIMARY KEY (deck_id, card_slug),
  CHECK (asset->>'deckId' = deck_id AND asset->>'cardSlug' = card_slug),
  CHECK (asset->>'mediaType' = 'image/webp')
);
