import assert from "node:assert/strict";
import deepTime from "../../decks/deep-time/deck.json";
import { InMemoryArcanaHostStore } from "../src/hostStore";

async function main(): Promise<void> {
  const store = new InMemoryArcanaHostStore();

  const alice = store.get("alice");
  assert.strictEqual(store.get("alice"), alice, "same scope must reuse one Arcana host");

  const bob = store.get("bob");
  assert.notStrictEqual(bob, alice, "different scopes must not share Arcana hosts");
  assert.equal(store.size, 2);

  const custom = structuredClone(deepTime);
  custom.slug = "alice-custom-deck";
  custom.name = "Alice Custom Deck";
  await alice.call("import_deck", { data: custom });

  const aliceDecks = await alice.call("list_decks") as Array<{ id: string }>;
  const bobDecks = await bob.call("list_decks") as Array<{ id: string }>;
  assert.equal(aliceDecks.some((deck) => deck.id === custom.slug), true);
  assert.equal(bobDecks.some((deck) => deck.id === custom.slug), false, "custom import must remain scoped to its owner");

  assert.equal(store.delete("alice"), true);
  const replacement = store.get("alice");
  assert.notStrictEqual(replacement, alice, "deleted scope must receive a fresh host");
  const replacementDecks = await replacement.call("list_decks") as Array<{ id: string }>;
  assert.equal(replacementDecks.some((deck) => deck.id === custom.slug), false);

  assert.throws(() => store.get("   "), /non-empty string/);
  store.clear();
  assert.equal(store.size, 0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
