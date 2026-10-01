import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { validateDeckManifest } from "../../app/src/decks/manifest";
import { createArcanaAdapter, InMemoryArcanaHostStore } from "../src/hostStore";
import { createArcanaMcpServer } from "../src/server";
import { CatalogResolvingArcanaToolAdapter } from "../src/catalogResolvingAdapter";
import { InMemoryUserDeckCatalogRepository, restoreUserDeckRecords } from "../src/userDeckCatalog";

// Archived source remains test-only. Mint authentic old links to prove the public runtime
// rejects their identities rather than merely hiding the landing-page tiles.
const formerDecks = Object.values(BUNDLED_DECK_MANIFESTS);
const publicAdapter = createArcanaAdapter();
assert.deepEqual(await publicAdapter.call("list_decks"), []);
const hosts = new InMemoryArcanaHostStore();
assert.deepEqual(await hosts.get("new-owner").call("list_decks"), []);
const catalog = new InMemoryUserDeckCatalogRepository();
const server = createArcanaMcpServer({ catalog, adapter: publicAdapter, includeStatefulTools: false });
const client = new Client({ name: "retired-bundled-decks", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
try {
  for (const manifest of formerDecks) {
    const fixture = createArcanaAdapter();
    const deck = fixture.engine.decks.registerDeck(manifest);
    const reading = await fixture.call("cast_reading", { deckId: deck.id, spread: "single" }) as { token: string };
    for (const deckId of new Set([deck.id, ...(deck.aliases ?? [])])) {
      for (const name of ["get_deck", "get_card", "analyze_card", "query_cards", "list_spreads", "cast_reading", "list_visual_packs", "get_card_art"]) {
        const response = await client.callTool({ name, arguments: { deckId, cardSlug: deck.cards[0].slug, spread: "single" } });
        assert.equal(response.isError, true, `${name} must not resolve retired deck ${deckId}`);
      }
    }
    for (const name of ["resolve_reading", "interpretation_context", "render_reading"]) {
      const response = await client.callTool({ name, arguments: { token: reading.token } });
      assert.equal(response.isError, true, `${name} must not resolve a retired reading for ${deck.id}`);
    }
  }
  assert.deepEqual((await client.callTool({ name: "list_decks", arguments: {} })).structuredContent, { result: [] });
  assert.deepEqual((await client.callTool({ name: "list_public_decks", arguments: {} })).structuredContent, { result: [] });
} finally {
  await client.close();
  await server.close();
}

// Retirement removes defaults; it must not ban a user-owned authored slug or delete catalog rows.
const userManifest = structuredClone(formerDecks[0]);
userManifest.data.name = "An owner's existing deck";
const validated = validateDeckManifest(userManifest);
if (!validated.ok) throw new Error(validated.error);
const record = await catalog.createImported("owner", validated.manifest);
await catalog.setVisibility("owner", record.id, "public");
assert.equal((await catalog.get(record.id))?.manifest.data.name, "An owner's existing deck");
assert.deepEqual((await catalog.listPublic()).map(({ id }) => id), [record.id]);
const owner = createArcanaAdapter();
restoreUserDeckRecords(owner, "owner", await catalog.listOwned("owner"));
assert.equal((await owner.call("get_deck", { deckId: userManifest.data.slug }) as { id: string }).id, record.id,
  "Existing account decks keep authored slug compatibility even when it matches a retired source");
const shared = new CatalogResolvingArcanaToolAdapter(createArcanaAdapter(), catalog, null);
assert.equal((await shared.call("get_deck", { deckId: record.id }) as { id: string }).id, record.id);
const userReading = await shared.call("cast_reading", { deckId: record.id, spread: "single" }) as { token: string };
assert.equal((await shared.call("resolve_reading", { token: userReading.token }) as { deckId: string }).deckId, record.id);
assert.deepEqual(await createArcanaAdapter().call("list_decks"), []);
console.log("Retired bundled deck discovery, direct IDs, old reading links, and user catalog preservation passed");
