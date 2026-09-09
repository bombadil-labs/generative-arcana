import assert from "node:assert/strict";
import deepTime from "../../decks/deep-time/deck.json";
import type { DeckDataFile } from "../../app/src/decks/types";
import type { ArcanaHostState, ArcanaHostStateRepository } from "../src/hostState";
import { PersistentArcanaHostStore } from "../src/hostStore";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { canResolveUserDeck, isDiscoverableUserDeck, type UserDeckManifest } from "../../app/src/decks/catalog";

async function main(): Promise<void> {
  await repositoryContract();
  await hostMigrationAndPersistence();
}

async function repositoryContract(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const firstManifest = manifest("shared-slug", "first");
  const created = await catalog.createImported("alice", firstManifest);
  assert.equal(created.visibility, "private");
  assert.equal(created.revision, 1);
  assert.equal(canResolveUserDeck(created, "alice"), true);
  assert.equal(canResolveUserDeck(created, "bob"), false);
  assert.equal(isDiscoverableUserDeck(created), false);

  await assert.rejects(
    catalog.createImported("alice", manifest("shared-slug", "duplicate")),
    /already owned by this account/,
    "ordinary create must not silently overwrite an owned slug",
  );
  assert.equal((await catalog.listOwned("alice"))[0]?.revision, 1);

  const replaced = await catalog.upsertImported("alice", manifest("shared-slug", "second"));
  assert.equal(replaced.id, created.id, "replacement must preserve stable resource identity");
  assert.equal(replaced.revision, 2);
  assert.equal(replaced.visibility, "private", "replacement must preserve publication state");
  assert.equal(replaced.manifest.tagline, "second");

  const unlisted = await catalog.setVisibility("alice", created.id, "unlisted");
  assert.equal(canResolveUserDeck(unlisted, "bob"), true);
  assert.equal(isDiscoverableUserDeck(unlisted), false);
  assert.equal((await catalog.listPublic()).length, 0);

  const publicDeck = await catalog.setVisibility("alice", created.id, "public");
  assert.equal(publicDeck.revision, 4);
  assert.ok(publicDeck.publishedAt);
  assert.equal(isDiscoverableUserDeck(publicDeck), true);
  assert.deepEqual((await catalog.listPublic()).map((deck) => deck.id), [created.id]);

  const bob = await catalog.createImported("bob", firstManifest);
  assert.notEqual(bob.id, created.id, "different owners may import the same manifest slug independently");
  assert.equal(await catalog.deleteOwned("alice", bob.id), false, "owners cannot delete another user's deck");
  assert.equal((await catalog.listOwned("bob")).length, 1);
}

async function hostMigrationAndPersistence(): Promise<void> {
  const legacy = new MemoryHostStateRepository();
  const catalog = new InMemoryUserDeckCatalogRepository();
  const oldManifest = manifest("legacy-deck", "legacy");
  await legacy.save("alice", { v: 1, customDecks: [oldManifest] });

  // A newer catalog row must win over stale legacy JSON during a retry/partial migration.
  const current = await catalog.upsertImported("alice", manifest("legacy-deck", "newer catalog"));
  assert.equal(current.revision, 1);

  const firstProcess = new PersistentArcanaHostStore(legacy, undefined, catalog);
  const alice = await firstProcess.get("alice");
  const restoredByLegacySlug = await alice.call("get_deck", { deckId: "legacy-deck" }) as { id: string; tagline: string };
  assert.equal(restoredByLegacySlug.id, current.id, "legacy slug is only a compatibility alias after migration");
  assert.equal(restoredByLegacySlug.tagline, "newer catalog", "legacy migration must not overwrite an existing catalog row");
  const restoredByResourceId = await alice.call("get_deck", { deckId: current.id }) as { id: string };
  assert.equal(restoredByResourceId.id, current.id);
  assert.equal(await legacy.load("alice"), null, "legacy state is deleted only after successful migration");

  const beforeInvalid = (await catalog.listOwned("alice")).length;
  await assert.rejects(
    alice.call("import_deck", { data: {} }),
    /required|must|missing|deck/i,
    "invalid imports must fail validation before catalog persistence",
  );
  assert.equal((await catalog.listOwned("alice")).length, beforeInvalid);

  const importedData = structuredClone(deepTime);
  importedData.slug = "catalog-persisted";
  importedData.name = "Catalog Persisted";
  const importResult = await alice.call("import_deck", {
    data: importedData,
    tagline: "catalog backed",
  }) as { id: string; slug: string; name: string; cardCount: number; custom: boolean };

  const owned = await catalog.listOwned("alice");
  assert.equal(owned.length, 2);
  const persisted = owned.find((deck) => deck.manifest.data.slug === importedData.slug);
  if (!persisted) throw new Error("Imported catalog deck was not persisted.");
  assert.equal(importResult.id, persisted.id, "tool result exposes the stable catalog resource id");
  assert.equal(importResult.slug, importedData.slug, "authored slug remains separate presentation metadata");
  assert.notEqual(importResult.id, importResult.slug);
  assert.equal(persisted.visibility, "private", "new imports start private");
  assert.equal((await alice.call("get_deck", { deckId: persisted.id }) as { id: string }).id, persisted.id);
  assert.equal((await alice.call("get_deck", { deckId: importedData.slug }) as { id: string }).id, persisted.id,
    "unique authored slug remains a backwards-compatible lookup alias");

  await assert.rejects(
    alice.call("import_deck", { data: importedData, tagline: "should not overwrite" }),
    /already owned by this account/,
    "replaceExisting=false preserves create semantics even though runtime identity differs from slug",
  );
  assert.equal((await catalog.get(persisted.id))?.revision, 1);

  const published = await catalog.setVisibility("alice", persisted.id, "public");
  const replacedResult = await alice.call("import_deck", {
    data: importedData,
    tagline: "replacement",
    replaceExisting: true,
  }) as { id: string; slug: string };
  const replacedRecord = await catalog.get(persisted.id);
  assert.equal(replacedResult.id, persisted.id, "explicit replacement preserves runtime resource identity");
  assert.equal(replacedRecord?.id, persisted.id);
  assert.equal(replacedRecord?.visibility, "public", "replacement preserves publication state");
  assert.equal(replacedRecord?.publishedAt, published.publishedAt);
  assert.equal(replacedRecord?.revision, published.revision + 1);
  assert.equal(replacedRecord?.manifest.tagline, "replacement");

  // Simulate a new process: runtime state is reconstructed only from first-class catalog rows.
  const secondProcess = new PersistentArcanaHostStore(legacy, undefined, catalog);
  const restoredAlice = await secondProcess.get("alice");
  const decks = await restoredAlice.call("list_decks") as Array<{ id: string }>;
  assert.equal(decks.some((deck) => deck.id === persisted.id), true, "runtime catalogs primary resource ids, not authored slugs");
  assert.equal(decks.some((deck) => deck.id === importedData.slug), false);
  assert.equal((await restoredAlice.call("get_deck", { deckId: importedData.slug }) as { id: string }).id, persisted.id);

  const bob = await secondProcess.get("bob");
  const bobDecks = await bob.call("list_decks") as Array<{ id: string }>;
  assert.equal(bobDecks.some((deck) => deck.id === persisted.id), false, "catalog restore remains owner scoped");

  assert.equal(await secondProcess.delete("alice"), true);
  assert.equal((await catalog.listOwned("alice")).length, 0, "deleting an owner scope removes owned catalog decks");
  const thirdProcess = new PersistentArcanaHostStore(legacy, undefined, catalog);
  const freshAlice = await thirdProcess.get("alice");
  const freshDecks = await freshAlice.call("list_decks") as Array<{ id: string }>;
  assert.equal(freshDecks.some((deck) => deck.id === persisted.id), false);
}

function manifest(slug: string, tagline: string): UserDeckManifest {
  const data = structuredClone(deepTime) as unknown as DeckDataFile;
  data.slug = slug;
  data.name = slug;
  return { data, tagline };
}

class MemoryHostStateRepository implements ArcanaHostStateRepository {
  private readonly values = new Map<string, unknown>();

  async load(scopeId: string): Promise<unknown | null> {
    return this.values.has(scopeId) ? structuredClone(this.values.get(scopeId)) : null;
  }

  async save(scopeId: string, state: ArcanaHostState): Promise<void> {
    this.values.set(scopeId, structuredClone(state));
  }

  async delete(scopeId: string): Promise<boolean> {
    return this.values.delete(scopeId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
