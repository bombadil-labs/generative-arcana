import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createArcanaMcpServer } from "../src/server";
import { assertAuthoringGuide } from "./authoring-guide-contract";

const server = createArcanaMcpServer({ includeStatefulTools: false, oauth: {
  principal: null, resourceMetadataUrl: "https://arcana.example/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"],
} });
const client = new Client({ name: "authoring-guide-test", version: "1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await assertAuthoringGuide(client, true);
  const decks = await client.callTool({ name: "list_decks", arguments: {} });
  assert.deepEqual((decks.structuredContent as Record<string, unknown>).result, [], "reading the guide must not register a deck or touch account data");
  console.log("Complete authoring guide: public tool/resource, source parity, discovery and lossless chunks passed.");
} finally {
  await client.close();
  await server.close();
}
