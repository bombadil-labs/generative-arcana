import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage, type ArtworkMetadata } from "../src/cardArtwork";
import { createArcanaMcpServer } from "../src/server";
import { StaticVisualStore, type ServerVisualPackSummary, type ServerVisualStore } from "../src/staticVisuals";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { neutralManifest, textContent, toolResult } from "./protocol-fixtures";

type Response = Awaited<ReturnType<Client["callTool"]>>;
const png = await sharp({ create: { width: 16, height: 24, channels: 3, background: "purple" } }).png().toBuffer();
const catalog = new InMemoryUserDeckCatalogRepository();
const manifest = neutralManifest("visual-selection");
let deck = await catalog.createImported("alice", manifest);
const artwork = new CardArtworkService(catalog, new InMemoryArtworkRepository(catalog), new InMemoryArtworkStorage());
const createInput = { ownerId: "alice", deckId: deck.id, expectedDeckRevision: 1 };
const uploadInput = { ...createInput, expectedArtworkId: null, mediaType: "image/png", bytes: png };
const principal = { id: "alice", scopes: ["decks:read", "decks:write"] };
let activeVisuals = new StaticVisualStore([]);
const loadedPackIds: Array<string | undefined> = [];
const visuals: ServerVisualStore = {
  listPacks: deckId => activeVisuals.listPacks(deckId),
  loadCardArt: async (deckId, cardSlug, packId) => {
    loadedPackIds.push(packId);
    return activeVisuals.loadCardArt(deckId, cardSlug, packId);
  },
  resolveSpreadScene: (deckId, spreadId, packId) => activeVisuals.resolveSpreadScene(deckId, spreadId, packId),
};
const server = createArcanaMcpServer({ catalog, artwork, principal, visuals });
const client = new Client({ name: "visual-pack-selection", version: "1" });
const [left, right] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(left), client.connect(right)]);
const dir = await mkdtemp(join(tmpdir(), "arcana-pack-selection-"));
const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
const art = (cardSlug = "major-0", packId?: string) => call("get_card_art", { deckId: deck.id, cardSlug, ...(packId ? { packId } : {}) });
const render = (token: string, packId?: string) => call("render_reading", { token, ...(packId ? { packId } : {}) });
function result<T>(response: Response): T {
  assert.equal(response.isError, undefined, textContent(response));
  return (response.structuredContent as { result: T }).result;
}
function failure(response: Response, message: RegExp) {
  assert.equal(response.isError, true, textContent(response));
  assert.match(textContent(response), message);
  assert.ok(!response.content.some(part => part.type === "image"), "failed selections must not leak partial artwork");
}
function selectedArt(response: Response, packId: string) {
  assert.equal(result<{ packId: string }>(response).packId, packId);
  assert.ok(response.content.some(part => part.type === "image"));
}
function selectedReading(response: Response, packId: string, kind = "flow") {
  const value = result<{ layout: { kind: string; packId: string }; placements: Array<{ packId?: string }> }>(response);
  assert.equal(value.layout.kind, kind);
  assert.equal(value.layout.packId, packId);
  if (kind === "flow") assert.ok(value.placements.every(placement => placement.packId === packId));
}
async function tokenFor(cardSlugs: string[]): Promise<string> {
  const cast = toolResult<{ token: string }>(await call("cast_reading", { deckId: deck.id, spread: cardSlugs.length === 1 ? "single" : "three-card" }));
  const token = JSON.parse(Buffer.from(cast.token, "base64url").toString());
  token.c = cardSlugs.map(slug => [slug, 0]);
  return Buffer.from(JSON.stringify(token)).toString("base64url");
}
try {
  const single = await tokenFor(["major-0"]);
  const missingSingle = await tokenFor(["major-6"]);
  const three = await tokenFor(["major-0", "major-6", "lines-1"]);

  // Zero usable packs, including the synthetic legacy set and empty named metadata.
  failure(await art(), /no server-renderable card-art pack/);
  failure(await render(single), /no server-renderable visual/);
  await artwork.createPack({ ...createInput, packId: "empty", label: "Empty" });
  await artwork.createPack({ ...createInput, packId: "only-art", label: "Only artwork" });
  failure(await art(), /no server-renderable card-art pack/);
  failure(await render(single), /no server-renderable visual/);
  const listed = toolResult<ServerVisualPackSummary[]>(await call("list_visual_packs", { deckId: deck.id }));
  assert.deepEqual(listed.map(pack => pack.id), ["empty", "only-art"], "empty named sets remain discoverable, empty legacy metadata stays hidden");

  // The sole populated named set is selected even with several empty metadata entries.
  const named = await artwork.upload({ ...uploadInput, cardSlug: "major-0", packId: "only-art" });
  selectedArt(await art(), "only-art");
  selectedReading(await render(single), "only-art");
  failure(await art("major-6"), /only-art.*no artwork/);
  failure(await render(missingSingle), /only-art.*missing art/);
  failure(await art("major-0", "saved-artwork"), /saved-artwork.*no artwork/);
  failure(await render(single, "saved-artwork"), /saved-artwork.*missing art/);
  failure(await art("major-0", "empty"), /empty.*no artwork/);
  failure(await render(single, "empty"), /empty.*missing art/);
  failure(await art("major-0", "unknown"), /Unknown visual set/);
  failure(await render(single, "unknown"), /Unknown visual set/);

  // Upload/metadata compatibility is deliberately separate from visual default selection.
  failure(await call("get_card_artwork", { deckId: deck.id, cardSlug: "major-0" }), /unavailable/);
  const saved = toolResult<ArtworkMetadata>(await call("set_card_artwork", {
    deckId: deck.id, cardSlug: "major-6", expectedDeckRevision: 1, expectedArtworkId: null,
    mediaType: "image/png", base64: png.toString("base64"),
  }));
  assert.equal(saved.packId, "saved-artwork", "omitted upload packId must never write to the auto-selected named set");
  assert.equal(toolResult<ArtworkMetadata>(await call("get_card_artwork", { deckId: deck.id, cardSlug: "major-6", includeImage: false })).id, saved.id);
  assert.equal((await artwork.metadata("alice", deck.id, "major-0", "only-art")).id, named.id);
  assert.equal((await artwork.readableCards("alice", deck.id)).packId, "saved-artwork");
  failure(await art(), /Multiple visual sets.*Specify packId:.*saved-artwork.*only-art/);
  failure(await render(three), /Multiple visual sets.*Specify packId/);
  selectedArt(await art("major-0", "only-art"), "only-art");
  selectedArt(await art("major-6", "saved-artwork"), "saved-artwork");
  failure(await render(three, "only-art"), /only-art.*missing art/);
  failure(await render(single, "saved-artwork"), /saved-artwork.*missing art/);

  // Use a fresh catalog deck to isolate server static and Living Spread capabilities.
  await catalog.deleteOwned("alice", deck.id);
  const cleanDeck = await catalog.createImported("alice", neutralManifest("server-visual-selection"));
  deck = cleanDeck;
  const serverSingle = await tokenFor(["major-0"]);
  const serverThree = await tokenFor(["major-0", "major-6", "lines-1"]);
  await mkdir(join(dir, "full"));
  await mkdir(join(dir, "partial"));
  for (const cardSlug of Object.keys(manifest.data.cards)) await writeFile(join(dir, "full", `${cardSlug}.png`), png);
  await writeFile(join(dir, "partial", "major-0.png"), png);
  const full = { deckId: deck.id, id: "full", label: "Full", mimeType: "image/png", extension: ".png", directory: pathToFileURL(`${dir}/full/`), complete: true };
  const partial = { ...full, id: "partial", label: "Partial", directory: pathToFileURL(`${dir}/partial/`), complete: false, cardCount: 1 };
  const empty = { ...full, id: "empty-static", label: "Empty static", directory: pathToFileURL(`${dir}/empty/`), complete: false, cardCount: 0 };
  const scene = { deckId: deck.id, id: "scene", label: "Scene", format: "generative-arcana/custom-test@1", spreadIds: ["single"] };
  const otherScene = { ...scene, id: "other-scene", label: "Other scene", spreadIds: ["three-card"] };

  activeVisuals = new StaticVisualStore([empty]);
  failure(await art(), /No card art/);
  failure(await render(serverSingle), /no server-renderable visual/);
  activeVisuals = new StaticVisualStore([empty, full]);
  selectedArt(await art(), "full");
  selectedReading(await render(serverThree), "full");
  assert.ok(loadedPackIds.every(id => id === "full"), "even legacy static summaries without cardCount receive a fixed explicit pack id");
  failure(await art("major-0", "empty-static"), /empty-static.*no artwork/);
  failure(await render(serverSingle, "empty-static"), /empty-static.*missing art/);

  // Multiple server packs require selection before any per-card asset reads.
  activeVisuals = new StaticVisualStore([partial, full]);
  loadedPackIds.length = 0;
  failure(await art("major-6"), /Multiple visual sets.*Specify packId/);
  failure(await render(serverThree), /Multiple visual sets.*Specify packId/);
  assert.deepEqual(loadedPackIds, []);
  selectedArt(await art("major-0", "partial"), "partial");
  failure(await art("major-6", "partial"), /partial.*no artwork/);
  failure(await render(serverThree, "partial"), /partial.*missing art/);
  selectedReading(await render(serverThree, "full"), "full");

  // A lone partial server pack is selected as a unit, then reports its missing card.
  activeVisuals = new StaticVisualStore([partial, empty]);
  selectedReading(await render(serverSingle), "partial");
  failure(await render(serverThree), /partial.*missing art/);

  // Living Spreads compete only when usable for this operation and requested spread.
  activeVisuals = new StaticVisualStore([empty], [otherScene, scene]);
  failure(await art(), /No card art/);
  selectedReading(await render(serverSingle), "scene", "living-spread");
  selectedReading(await render(serverThree), "other-scene", "living-spread");
  failure(await render(serverSingle, "other-scene"), /no server-renderable visual/);
  activeVisuals = new StaticVisualStore([full], [otherScene, scene]);
  selectedArt(await art(), "full");
  failure(await render(serverSingle), /Multiple visual sets.*Specify packId: full, scene/);
  selectedReading(await render(serverSingle, "full"), "full");
  selectedReading(await render(serverSingle, "scene"), "scene", "living-spread");
  activeVisuals = new StaticVisualStore([full], [otherScene]);
  selectedReading(await render(serverSingle), "full");
  activeVisuals = new StaticVisualStore([], [scene, { ...scene, id: "second-scene" }]);
  failure(await render(serverSingle), /Multiple visual sets.*Specify packId/);

  // Two capabilities for the same set are one choice, and preserve scene rendering.
  activeVisuals = new StaticVisualStore([full], [{ ...scene, id: "full" }]);
  selectedReading(await render(serverSingle), "full", "living-spread");
  selectedReading(await render(serverThree), "full");
  selectedArt(await art(), "full");

  // An empty saved set sharing a host id cannot steal the implicitly selected source.
  for (const id of ["saved-artwork", "collision"]) {
    if (id !== "saved-artwork") await artwork.createPack({ ownerId: "alice", deckId: deck.id, expectedDeckRevision: 1, packId: id, label: "Empty collision" });
    activeVisuals = new StaticVisualStore([{ ...full, id }]);
    const hostArt = await art();
    selectedArt(hostArt, id);
    assert.equal(result<{ packLabel: string }>(hostArt).packLabel, "Full");
    selectedReading(await render(serverThree), id);
    failure(await art("major-0", id), /no artwork/);
    failure(await render(serverSingle, id), /missing art/);

    activeVisuals = new StaticVisualStore([], [{ ...scene, id }]);
    selectedReading(await render(serverSingle), id, "living-spread");
    failure(await art("major-0", id), /no artwork/);
    failure(await render(serverSingle, id), /missing art/);
    const publicPacks = toolResult<ServerVisualPackSummary[]>(await call("list_visual_packs", { deckId: deck.id }));
    assert.ok(publicPacks.every(pack => !("saved" in pack) && !("pack" in pack)), "source provenance stays internal");
  }
  activeVisuals = new StaticVisualStore([full], [{ ...scene, id: "full" }]);

  // Saved artwork and server-renderable sets obey the same ambiguity rule.
  await artwork.createPack({ ownerId: "alice", deckId: deck.id, expectedDeckRevision: 1, packId: "named", label: "Named" });
  await artwork.upload({ ...uploadInput, deckId: deck.id, cardSlug: "major-0", packId: "named" });
  failure(await art(), /Multiple visual sets.*Specify packId/);
  failure(await render(serverSingle), /Multiple visual sets.*Specify packId/);
  selectedArt(await art("major-0", "named"), "named");
  selectedReading(await render(serverSingle, "named"), "named");
  failure(await art("major-6", "named"), /named.*no artwork/);
  failure(await render(serverThree, "named"), /named.*missing art/);
  failure(await render(serverSingle, "saved-artwork"), /saved-artwork.*missing art/);

  // Populated saved and host sources compete even with the same id; explicit selection stays saved-first.
  activeVisuals = new StaticVisualStore([{ ...full, id: "named" }], [{ ...scene, id: "named" }]);
  failure(await art(), /Multiple visual sets.*Specify packId: named/);
  failure(await render(serverSingle), /Multiple visual sets.*Specify packId: named/);
  const savedArt = await art("major-0", "named");
  selectedArt(savedArt, "named");
  assert.equal(result<{ packLabel: string }>(savedArt).packLabel, "Named");
  selectedReading(await render(serverSingle, "named"), "named");
  failure(await art("major-6", "named"), /named.*no artwork/);
  failure(await render(serverThree, "named"), /named.*missing art/);
} finally {
  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
console.log("Visual pack selection: zero/one/multiple saved and server packs, strict selections, Living Spreads, and legacy upload defaults passed.");
