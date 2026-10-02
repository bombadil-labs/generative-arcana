import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { createDeckManifest } from "../../app/src/decks/manifest";
import {
  deckEditInputSchema,
  editOwnedDeck,
  registerDeckEditTools,
  type RegisterDeckEditToolsOptions,
} from "../src/deckEditTools";
import {
  CatalogPersistingArcanaToolAdapter,
  InMemoryUserDeckCatalogRepository,
  UserDeckRevisionConflictError,
  type UserDeckCatalogRepository,
} from "../src/userDeckCatalog";
import { NeonUserDeckCatalogRepository } from "../src/neonUserDeckCatalog";
import { createArcanaAdapter } from "../src/hostStore";
import { neutralManifest, textContent, toolResult } from "./protocol-fixtures";

const oauth = { resourceMetadataUrl: "https://arcana.example/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };

await repositoryContract(new InMemoryUserDeckCatalogRepository());
const db = new PGlite();
try {
  await db.exec(await readFile(new URL("../migrations/001-domain.sql", import.meta.url), "utf8"));
  const statements: string[] = [];
  const sql = async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const statement = strings.reduce((all, part, index) => all + (index ? `$${index}` : "") + part, "");
    statements.push(statement);
    return (await db.query<Record<string, unknown>>(statement, params)).rows;
  };
  await repositoryContract(new NeonUserDeckCatalogRepository("test-only", sql));
  assert.ok(statements.some((statement) => /WHERE id = \$\d+ AND owner_id = \$\d+ AND revision = \$\d+/.test(statement)),
    "the SQL write itself must check both ownership and revision");
} finally { await db.close(); }
await typedEditContract();
await legacyImportContract();
await toolContract();
console.log("Bounded typed deck edits, owner isolation, atomic revisions and PostgreSQL CAS tests passed.");

async function repositoryContract(catalog: UserDeckCatalogRepository): Promise<void> {
  const created = await catalog.createImported("alice", neutralManifest());
  const publicDeck = await catalog.setVisibility("alice", created.id, "public");
  const changed = { ...publicDeck.manifest, tagline: "A revision-safe change." };
  const updated = await catalog.replaceOwned("alice", created.id, publicDeck.revision, changed);
  assert.equal(updated.id, created.id);
  assert.equal(updated.revision, publicDeck.revision + 1);
  assert.equal(updated.visibility, "public");
  assert.equal(updated.publishedAt, publicDeck.publishedAt);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.manifest.tagline, changed.tagline);

  await assert.rejects(catalog.replaceOwned("bob", created.id, updated.revision, changed), /Unknown owned user deck/);
  await assert.rejects(catalog.replaceOwned("alice", "absent", updated.revision, changed), /Unknown owned user deck/);
  await assert.rejects(catalog.replaceOwned("alice", created.id, publicDeck.revision, changed),
    (error: unknown) => error instanceof UserDeckRevisionConflictError && error.currentRevision === updated.revision);
  await assert.rejects(catalog.replaceOwned("alice", created.id, updated.revision, { ...changed, tagline: "" }), /tagline/);
  for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(catalog.replaceOwned("alice", created.id, revision, changed), /positive safe integer/);
  }
  assert.deepEqual(await catalog.get(created.id), updated, "failed writes must not mutate content or revision");

  const writes = await Promise.allSettled([
    catalog.replaceOwned("alice", created.id, updated.revision, { ...changed, tagline: "First competitor" }),
    catalog.replaceOwned("alice", created.id, updated.revision, { ...changed, tagline: "Second competitor" }),
  ]);
  assert.equal(writes.filter((write) => write.status === "fulfilled").length, 1);
  assert.equal(writes.filter((write) => write.status === "rejected" && write.reason instanceof UserDeckRevisionConflictError).length, 1);
  const winner = (await catalog.get(created.id))!;
  assert.equal(winner.revision, updated.revision + 1);

  await catalog.createImported("alice", neutralManifest("already-owned"));
  await assert.rejects(catalog.replaceOwned("alice", created.id, winner.revision, neutralManifest("already-owned")), /already owned/);
  assert.equal((await catalog.get(created.id))?.revision, winner.revision);
  const renamed = await catalog.replaceOwned("alice", created.id, winner.revision, neutralManifest("renamed-deck"));
  assert.equal(renamed.id, created.id, "authored slug changes never change resource identity");
  assert.equal(renamed.slug, "renamed-deck");
  assert.equal(renamed.manifest.data.slug, "renamed-deck");
  assert.equal(renamed.visibility, "public");
}

async function typedEditContract(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const original = neutralManifest();
  original.data.extra_authored_field = { retained: true };
  original.spreads = [{ id: "authored-one", name: "One", description: "Before", positions: [{ name: "Center", prompt: "Look here" }] }];
  const created = await catalog.createImported("alice", original);
  const warmedHost = new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(), "alice", catalog);
  await warmedHost.call("get_deck", { deckId: created.id });
  const card = { ...created.manifest.data.cards["major-0"]!, name: "A Changed Circle" };
  const edited = await editOwnedDeck(catalog, "alice", {
    deckId: created.id, expectedRevision: created.revision,
    metadata: { name: "New title", tagline: "New tagline", theme: { creator: "New creator" } },
    cards: { upsert: [card], remove: ["major-6"] },
    spreads: { upsert: [{ id: "authored-one", name: "Replacement", description: "After", positions: [{ name: "New", prompt: "New prompt" }] }] },
  });
  assert.equal(edited.revision, 2);
  assert.equal(edited.manifest.data.name, "New title");
  assert.equal(edited.manifest.tagline, "New tagline");
  assert.equal(edited.manifest.data.theme.name, original.data.theme.name);
  assert.equal(edited.manifest.data.theme.creator, "New creator");
  assert.deepEqual(edited.manifest.data.extra_authored_field, { retained: true }, "untouched extensions survive");
  assert.equal(edited.manifest.data.cards["major-0"]?.name, card.name);
  assert.equal(edited.manifest.data.cards["major-6"], undefined);
  assert.equal(edited.manifest.spreads?.[0]?.deckId, original.data.slug, "spread ownership comes from the manifest");
  assert.equal((await warmedHost.call("get_deck", { deckId: created.id }) as { name: string }).name, "New title",
    "an already-open catalog host refreshes immediately after a typed edit");

  const base = { deckId: edited.id, expectedRevision: edited.revision };
  for (const bad of [
    { ...base, ownerId: "bob", metadata: { name: "Oops" } },
    { ...base, metadata: { slug: "injected" } },
    { ...base, metadata: { name: "nul\0value" } },
    { ...base, metadata: { tagline: "unpaired\ud800" } },
    { ...base, metadata: { theme: { ownerId: "bob" } } },
    { ...base, cards: { upsert: [{ ...card, arbitrary_extension: true }] } },
    { ...base, cards: { upsert: [{ ...card, visuals: { detailed_description: "OK", ownerId: "bob" } }] } },
    { ...base, cards: { upsert: [{ ...card, suit_slug: "lines" }] } },
    { ...base, cards: { upsert: [{ ...card, factorization: { character: "prime", gloss: "x", factors: [1] } }] } },
    { ...base, spreads: { upsert: [{ ...original.spreads[0], deckId: "another-deck" }] } },
    { ...base, cards: { upsert: [card], remove: [card.slug] } },
    { ...base, cards: { remove: [card.slug, card.slug] } },
    { ...base, spreads: { remove: ["same", "same"] } },
    { ...base, cards: { remove: Array.from({ length: 21 }, (_, index) => `card-${index}`) } },
    { ...base, cards: { remove: Array.from({ length: 11 }, (_, index) => `card-${index}`) }, spreads: { remove: Array.from({ length: 10 }, (_, index) => `spread-${index}`) } },
    { ...base, metadata: {} },
    { ...base, metadata: { theme: {} } },
    { ...base, cards: { upsert: [] } },
    { ...base },
  ]) await assert.rejects(editOwnedDeck(catalog, "alice", bad), /./);

  const injected = JSON.parse(JSON.stringify({ ...base, metadata: { name: "Injected" } }).replace('"name":"Injected"', '"name":"Injected","__proto__":{"polluted":true}'));
  await assert.rejects(editOwnedDeck(catalog, "alice", injected), /Unrecognized key/);
  const large = deckEditInputSchema.safeParse({
    ...base,
    cards: { upsert: Array.from({ length: 5 }, (_, index) => ({ ...card, slug: `new-${index}`, visuals: { detailed_description: "é".repeat(8192) } })) },
  });
  assert.equal(large.success, false);
  if (!large.success) assert.ok(large.error.issues.some((issue) => issue.message.includes("UTF-8 JSON bytes")));

  await assert.rejects(editOwnedDeck(catalog, "alice", { ...base, cards: { upsert: [{ ...card, station_slug: "missing-station" }] } }), /unknown station/);
  await assert.rejects(editOwnedDeck(catalog, "alice", { ...base, cards: { remove: Object.keys(edited.manifest.data.cards) } }), /no cards/);
  await assert.rejects(editOwnedDeck(catalog, "alice", { ...base, metadata: { name: "must roll back" }, cards: { remove: ["missing-card"] } }), /Unknown card/);
  await assert.rejects(editOwnedDeck(catalog, "alice", { ...base, spreads: { remove: ["absent"] } }), /Unknown native spread/);
  await assert.rejects(editOwnedDeck(catalog, "alice", { ...base, spreads: { upsert: [{ ...original.spreads[0], id: "single" }] } }), /generic spread/);
  await assert.rejects(editOwnedDeck(catalog, "bob", { ...base, metadata: { name: "Owner attack" } }), /Unknown owned user deck/);
  assert.deepEqual(await catalog.get(edited.id), edited, "all rejected edits leave the whole record unchanged");

  const parallel = await Promise.allSettled([
    editOwnedDeck(catalog, "alice", { ...base, metadata: { name: "A" } }),
    editOwnedDeck(catalog, "alice", { ...base, metadata: { name: "B" } }),
  ]);
  assert.equal(parallel.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(parallel.filter((attempt) => attempt.status === "rejected" && attempt.reason instanceof UserDeckRevisionConflictError).length, 1);
  const current = (await catalog.get(edited.id))!;
  const removed = await editOwnedDeck(catalog, "alice", { deckId: current.id, expectedRevision: current.revision, spreads: { remove: ["authored-one"] } });
  assert.deepEqual(removed.manifest.spreads, []);
  // The output must still be a canonical, fully importable manifest.
  const validated = createDeckManifest(removed.manifest.data, { tagline: removed.manifest.tagline, spreads: removed.manifest.spreads });
  assert.deepEqual(validated, removed.manifest);
}

async function legacyImportContract(): Promise<void> {
  const plain = createArcanaAdapter();
  await assert.rejects(plain.call("import_deck", { manifest: neutralManifest(), replaceExisting: true, expectedRevision: 1 }), /requires a catalog-backed account/);
  assert.equal(plain.engine.listDecks().length, 0, "a plain host must not silently ignore optimistic concurrency");
  const catalog = new InMemoryUserDeckCatalogRepository();
  const adapter = new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(), "alice", catalog);
  const manifest = neutralManifest();
  const imported = await adapter.call("import_deck", { manifest }) as { id: string; revision: number };
  assert.equal(imported.revision, 1);
  const updated = await adapter.call("import_deck", { manifest, replaceExisting: true, expectedRevision: 1 }) as { id: string; revision: number };
  assert.equal(updated.id, imported.id);
  assert.equal(updated.revision, 2);
  await assert.rejects(adapter.call("import_deck", { manifest, replaceExisting: true, expectedRevision: 1 }), UserDeckRevisionConflictError);
  await assert.rejects(adapter.call("import_deck", { manifest, expectedRevision: 2 }), /requires replaceExisting/);
  await assert.rejects(adapter.call("import_deck", { manifest, replaceExisting: true, expectedRevision: 0 }), /positive safe integer/);
  await assert.rejects(adapter.call("import_deck", { manifest, replaceExisting: true, deckId: imported.id, expectedRevision: 2 }), /deckId is only supported/);
  await assert.rejects(adapter.call("import_deck", { manifest: neutralManifest("absent"), replaceExisting: true, expectedRevision: 1 }), /Unknown owned/);
  assert.equal((await catalog.get(imported.id))?.revision, 2);
  const bob = new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(), "bob", catalog);
  await assert.rejects(bob.call("import_deck", { manifest, replaceExisting: true, expectedRevision: 2 }), /Unknown owned/);
  assert.equal((await catalog.get(imported.id))?.revision, 2);
  const legacy = await adapter.call("import_deck", { manifest, replaceExisting: true }) as { id: string; revision: number };
  assert.equal(legacy.id, imported.id);
  assert.equal(legacy.revision, 3, "unconditional legacy replacement remains backward compatible");
}

async function toolContract(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const deck = await catalog.createImported("alice", neutralManifest());
  const anonymous = await connect({ catalog });
  try { assert.equal((await anonymous.client.listTools()).tools.some((tool) => tool.name === "edit_deck"), false); }
  finally { await anonymous.close(); }
  for (const principal of [null, { id: "alice", scopes: ["decks:read"] }, { id: "alice", scopes: ["decks:write"] }]) {
    const denied = await connect({ catalog, oauth, principal });
    try {
      const listing = await denied.client.listTools();
      const edit = listing.tools.find((tool) => tool.name === "edit_deck");
      assert.ok(edit, "OAuth tools remain discoverable before sign-in");
      assert.deepEqual(edit._meta?.securitySchemes, [{ type: "oauth2", scopes: ["decks:read", "decks:write"] }]);
      const result = await denied.client.callTool({ name: "edit_deck", arguments: { deckId: deck.id, expectedRevision: 1, metadata: { name: "Denied" } } });
      assert.equal(result.isError, true);
      assert.ok(JSON.stringify(result._meta).includes("mcp/www_authenticate"));
      assert.equal((await catalog.get(deck.id))?.revision, 1);
    } finally { await denied.close(); }
  }
  const observed: string[] = [];
  const owner = await connect({ catalog, oauth, principal: { id: "alice", scopes: ["decks:read", "decks:write"] }, onToolCall: (event) => observed.push(`${event.tool}:${event.ok}`) });
  try {
    const input = { deckId: deck.id, expectedRevision: 1, metadata: { name: "Edited over MCP" } };
    const changed = toolResult<{ id: string; revision: number; cardCount: number }>(await owner.client.callTool({ name: "edit_deck", arguments: input }));
    assert.equal(changed.id, deck.id);
    assert.equal(changed.revision, 2);
    assert.equal(changed.cardCount, 4);
    assert.equal(JSON.stringify(changed).includes("ownerId"), false);
    assert.equal(JSON.stringify(changed).includes("manifest"), false);
    const conflict = await owner.client.callTool({ name: "edit_deck", arguments: input });
    assert.equal(conflict.isError, true);
    assert.match(textContent(conflict), /revision conflict/);
    assert.deepEqual(conflict.structuredContent, { error: { code: "revision_conflict", expectedRevision: 1, currentRevision: 2 } });
    const malformed = await owner.client.callTool({ name: "edit_deck", arguments: { deckId: deck.id, expectedRevision: 2, metadata: { name: "Denied", ownerId: "bob" } } });
    assert.equal(malformed.isError, true);
    assert.equal((await catalog.get(deck.id))?.revision, 2);
    assert.deepEqual(observed, ["edit_deck:true", "edit_deck:false"]);
  } finally { await owner.close(); }
  const other = await connect({ catalog, principal: { id: "bob", scopes: [] } });
  try {
    const result = await other.client.callTool({ name: "edit_deck", arguments: { deckId: deck.id, expectedRevision: 1, metadata: { name: "Attack" } } });
    assert.equal(result.isError, true);
    assert.match(textContent(result), /Unknown owned/);
    assert.equal(JSON.stringify(result).includes("currentRevision"), false, "other owners cannot learn the current revision");
  } finally { await other.close(); }
}

async function connect(options: RegisterDeckEditToolsOptions) {
  const server = new McpServer({ name: "edit-tests", version: "1" });
  server.registerTool("test_probe", { description: "Establish tools capability for the anonymous fixture." }, async () => ({ content: [] }));
  registerDeckEditTools(server, options);
  const client = new Client({ name: "edit-tests", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
