import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import deepTime from "../../decks/deep-time/deck.json";
import { FileArcanaHostStateRepository } from "../src/fileHostStateRepository";
import { PersistentArcanaHostStore } from "../src/hostStore";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "generative-arcana-state-"));
  try {
    const repository = new FileArcanaHostStateRepository(root);
    const firstProcess = new PersistentArcanaHostStore(repository);

    const alice = await firstProcess.get("alice");
    const custom = structuredClone(deepTime);
    custom.slug = "alice-persisted-deck";
    custom.name = "Alice Persisted Deck";
    await alice.call("import_deck", { data: custom, tagline: "survives restart" });

    const bob = await firstProcess.get("bob");
    const bobDecks = await bob.call("list_decks") as Array<{ id: string }>;
    assert.equal(bobDecks.some((deck) => deck.id === custom.slug), false, "Bob must never see Alice's persisted deck");

    // Simulate a fresh process: no in-memory host cache is shared.
    const secondProcess = new PersistentArcanaHostStore(new FileArcanaHostStateRepository(root));
    const restoredAlice = await secondProcess.get("alice");
    const restoredDecks = await restoredAlice.call("list_decks") as Array<{ id: string }>;
    assert.equal(restoredDecks.some((deck) => deck.id === custom.slug), true, "custom deck must survive a new host-store instance");

    const restored = await restoredAlice.call("get_deck", { deckId: custom.slug }) as { tagline: string; custom?: boolean };
    assert.equal(restored.tagline, "survives restart");
    assert.equal(restored.custom, true);

    assert.equal(await secondProcess.delete("alice"), true);
    const thirdProcess = new PersistentArcanaHostStore(new FileArcanaHostStateRepository(root));
    const freshAlice = await thirdProcess.get("alice");
    const freshDecks = await freshAlice.call("list_decks") as Array<{ id: string }>;
    assert.equal(freshDecks.some((deck) => deck.id === custom.slug), false, "deleting durable scope must remove restored custom state");

    // Repository rows are untrusted: unsupported envelopes fail closed on restore.
    const badScope = "corrupt";
    await writeFile(join(root, `${digest(badScope)}.json`), JSON.stringify({ v: 999, customDecks: [] }), "utf8");
    const corruptedStore = new PersistentArcanaHostStore(new FileArcanaHostStateRepository(root));
    await assert.rejects(corruptedStore.get(badScope), /unsupported persisted Arcana host state version/i);
    // A failed load must not poison the cache forever.
    await assert.rejects(corruptedStore.get(badScope), /unsupported persisted Arcana host state version/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function digest(scope: string): string {
  return createHash("sha256").update(scope, "utf8").digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
