-- Additive cover/back slots. Card-front tables, counts and legacy JSON are unchanged.
-- The default saved-artwork pack is virtual, so ownership is anchored to the deck;
-- named-pack existence is checked under that same deck lock before each attachment.
CREATE TABLE IF NOT EXISTS arcana_visual_pack_assets (
  deck_id text NOT NULL REFERENCES arcana_user_decks(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  slot text NOT NULL CHECK (slot IN ('cover','cardBack')),
  asset jsonb NOT NULL,
  PRIMARY KEY (deck_id,pack_id,slot),
  CHECK (length(pack_id) BETWEEN 1 AND 80 AND pack_id ~ '^[a-z0-9]+([-_.][a-z0-9]+)*$'),
  CHECK (asset->>'deckId' IS NOT NULL AND asset->>'deckId'=deck_id),
  CHECK (asset->>'packId' IS NOT NULL AND asset->>'packId'=pack_id),
  CHECK (asset->>'slot' IS NOT NULL AND asset->>'slot'=slot),
  CHECK (NOT asset ? 'cardSlug'),
  CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')
);
