import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import deepTime from "../../decks/deep-time/deck.json";
import { DeckRegistry } from "../../app/src/decks/registry";
import type { DeckDataFile } from "../../app/src/decks/types";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import { createBundledArcanaAdapter } from "../src/hostStore";
import { createArcanaMcpServer, type ArcanaMcpServerOptions } from "../src/server";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";

async function main(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const publicDeck = await catalog.createImported("author", manifest("deep-time", "Shared Public"));
  const unlistedDeck = await catalog.createImported("author", manifest("shared-unlisted", "Shared Unlisted"));
  const privateDeck = await catalog.createImported("author", manifest("shared-private", "Shared Private"));
  await catalog.setVisibility("author", publicDeck.id, "public");
  await catalog.setVisibility("author", unlistedDeck.id, "unlisted");

  const local = createBundledArcanaAdapter();
  assert.equal(local.engine.getDeck(publicDeck.id), undefined);

  const anonymous = await connect({
    adapter: local,
    catalog,
    principal: null,
    includeStatefulTools: false,
  });

  try {
    const localDecksBefore = result<Array<{ id: string }>>(await anonymous.client.callTool({
      name: "list_decks",
      arguments: {},
    }));
    assert.equal(localDecksBefore.some((deck) => deck.id === publicDeck.id), false);

    const shared = result<{ id: string; name: string }>(await anonymous.client.callTool({
      name: "get_deck",
      arguments: { deckId: publicDeck.id },
    }));
    assert.equal(shared.id, publicDeck.id);
    assert.equal(shared.name, "Shared Public");

    const unlisted = result<{ id: string }>(await anonymous.client.callTool({
      name: "get_deck",
      arguments: { deckId: unlistedDeck.id },
    }));
    assert.equal(unlisted.id, unlistedDeck.id, "unlisted decks are usable by stable resource id");

    const hidden = await anonymous.client.callTool({
      name: "get_deck",
      arguments: { deckId: privateDeck.id },
    });
    assert.equal(hidden.isError, true, "private shared resources fail closed for anonymous callers");

    const reading = result<{ token: string; deckId: string }>(await anonymous.client.callTool({
      name: "cast_reading",
      arguments: {
        deckId: publicDeck.id,
        spread: "single",
        question: "What is here?",
        reversalRate: 0,
      },
    }));
    assert.equal(reading.deckId, publicDeck.id, "shared readings use stable resource identity");

    const resolved = result<{ deckId: string; question: string }>(await anonymous.client.callTool({
      name: "resolve_reading",
      arguments: { token: reading.token },
    }));
    assert.equal(resolved.deckId, publicDeck.id);
    assert.equal(resolved.question, "What is here?");

    const context = result<{ deckId: string; context: string }>(await anonymous.client.callTool({
      name: "interpretation_context",
      arguments: { token: reading.token },
    }));
    assert.equal(context.deckId, publicDeck.id);
    assert.match(context.context, /Shared Public|What is here\?/);

    const packs = result<unknown[]>(await anonymous.client.callTool({
      name: "list_visual_packs",
      arguments: { deckId: publicDeck.id },
    }));
    assert.deepEqual(packs, [], "shared symbolic decks can resolve even when no server visual pack exists");

    const rendered = await anonymous.client.callTool({
      name: "render_reading",
      arguments: { token: reading.token },
    });
    assert.equal(rendered.isError, true);
    assert.match(textContent(rendered), /no server-renderable visual.*spread/i,
      "visual rendering recognizes the shared deck before reporting the spread has no renderable visual");

    // Readings minted before catalog runtime identity used the authored slug in token.d. A stable
    // resource route can safely disambiguate that legacy token; the slug alone cannot be treated as
    // a globally unique shared resource id.
    const legacyEngine = new ArcanaEngine(new DeckRegistry());
    legacyEngine.importDeck(publicDeck.manifest.data, { tagline: publicDeck.manifest.tagline });
    const legacyAdapter = new ArcanaToolAdapter(legacyEngine);
    const legacyReading = await legacyAdapter.call("cast_reading", {
      deckId: publicDeck.slug,
      spread: "single",
      question: "Old shared link",
      reversalRate: 0,
    }) as { token: string; deckId: string };
    assert.equal(legacyReading.deckId, publicDeck.slug);

    const migratedLegacy = result<{ deckId: string }>(await anonymous.client.callTool({
      name: "resolve_reading",
      arguments: { token: legacyReading.token, deckId: publicDeck.id },
    }));
    assert.equal(migratedLegacy.deckId, publicDeck.id);

    const ambiguousLegacy = await anonymous.client.callTool({
      name: "resolve_reading",
      arguments: { token: legacyReading.token },
    });
    assert.equal(ambiguousLegacy.isError, true,
      "legacy slug-only shared tokens fail closed because authored slugs are not globally unique");

    assert.equal(local.engine.getDeck(publicDeck.id), undefined,
      "shared calls must not install the resource into the caller's runtime");
    const localDecksAfter = result<Array<{ id: string }>>(await anonymous.client.callTool({
      name: "list_decks",
      arguments: {},
    }));
    assert.equal(localDecksAfter.some((deck) => deck.id === publicDeck.id), false);
  } finally {
    await anonymous.close();
  }

  const owner = await connect({
    adapter: createBundledArcanaAdapter(),
    catalog,
    principal: { id: "author" },
    includeStatefulTools: false,
  });
  try {
    const privateOwned = result<{ id: string }>(await owner.client.callTool({
      name: "get_deck",
      arguments: { deckId: privateDeck.id },
    }));
    assert.equal(privateOwned.id, privateDeck.id, "owner may resolve a private catalog resource read-through");
  } finally {
    await owner.close();
  }
}

function manifest(slug: string, name: string) {
  const data = structuredClone(deepTime) as unknown as DeckDataFile;
  data.slug = slug;
  data.name = name;
  return { data, tagline: `${name} tagline` };
}

async function connect(options: ArcanaMcpServerOptions) {
  const server = createArcanaMcpServer(options);
  const client = new Client({ name: "shared-deck-resolution-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

function result<T>(response: { structuredContent?: unknown }): T {
  const structured = response.structuredContent as { result?: unknown } | undefined;
  assert.ok(structured && "result" in structured, "tool response should contain structured result");
  return structured.result as T;
}

function textContent(response: { content?: unknown }): string {
  if (!Array.isArray(response.content)) return "";
  return response.content
    .filter((item): item is { type: "text"; text: string } => !!item && typeof item === "object"
      && (item as { type?: unknown }).type === "text"
      && typeof (item as { text?: unknown }).text === "string")
    .map((item) => item.text)
    .join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
