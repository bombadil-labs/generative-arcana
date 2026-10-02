import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createArcanaMcpServer } from "../src/server";
import type { ManifestDraftRepository } from "../src/manifestDrafts";
import type { ManifestToolOptions } from "../src/manifestUploadTools";
import { ManifestDraftVersionConflict, ManifestUploadError } from "../src/manifestUploads";
import { textContent, toolResult } from "./protocol-fixtures";

const draftId = "00000000-0000-4000-8000-000000000001";
const names = ["start_deck_draft", "update_deck_draft", "get_deck_draft", "validate_deck_draft", "commit_deck_draft"];
const oauth = { resourceMetadataUrl: "https://arcana.example/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };
const calls: Array<{ method: string; owner: string; input: unknown }> = [];
let createChecks = 0, operationChecks = 0, allowCreate = true, allowOperation = true;
let failure: Error | undefined;
const record = (method: string, owner: string, input: unknown) => {
  if (failure) throw failure;
  if (owner !== "alice") throw new ManifestUploadError(404, "Unknown or expired manifest draft.");
  calls.push({ method, owner, input });
};
const drafts: ManifestDraftRepository = {
  async start(owner, startKey) { record("start", owner, startKey); return { draftId, version: 1, expiresAt: "2026-10-02T16:00:00.000Z", summary: { cardCount: 0 } }; },
  async update(owner, input) { record("update", owner, input); return { draftId, version: 2, summary: { cardCount: 0 } }; },
  async read(owner, input) { record("read", owner, input); return { draftId, version: 2, summary: { cardCount: 0 } }; },
  async validate(owner, id, expectedVersion) { record("validate", owner, { draftId: id, expectedVersion }); return { draftId: id, version: expectedVersion, valid: false, errors: [{ path: "$.data.cards", message: "At least one card is required." }] }; },
  async commit(owner, id, expectedVersion, options) { record("commit", owner, { draftId: id, expectedVersion, ...options }); return { draftId: id, version: expectedVersion, id: "owned-deck", revision: 1 }; },
};
const options: Omit<ManifestToolOptions, "principal" | "oauth"> = {
  drafts,
  allowCreate: async owner => { assert.equal(owner, "alice"); createChecks++; return allowCreate; },
  allowDraftOperation: async owner => { assert.equal(owner, "alice"); operationChecks++; return allowOperation; },
};
async function connect(id: string | null, scopes = ["decks:read", "decks:write"], manifestUploads = options, withOAuth = true) {
  const principal = id ? { id, scopes } : null;
  const server = createArcanaMcpServer({ principal, ...(withOAuth ? { oauth: { ...oauth, principal } } : {}), manifestUploads });
  const client = new Client({ name: "draft-tools-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  return { client, async close() { await client.close(); await server.close(); } };
}
const alice = await connect("alice"), anon = await connect(null), reader = await connect("alice", ["decks:read"]), writerOnly = await connect("alice", ["decks:write"]);
const unconfigured = await connect("alice", undefined, {}), anonymousNoOAuth = await connect(null, undefined, options, false);
try {
  const tools = (await alice.client.listTools()).tools;
  const publicTools = (await anon.client.listTools()).tools;
  for (const name of names) {
    const descriptor = tools.find(tool => tool.name === name)!;
    assert.ok(descriptor, `${name} is registered`);
    assert.ok(publicTools.some(tool => tool.name === name), `${name} remains discoverable for OAuth sign-in`);
    assert.deepEqual(descriptor._meta?.securitySchemes, [{ type: "oauth2", scopes: ["decks:read", "decks:write"] }]);
    assert.equal(descriptor.annotations?.idempotentHint, true);
    const shape = (descriptor.inputSchema.allOf as Array<Record<string, unknown>> | undefined)?.find(schema => schema.properties) ?? descriptor.inputSchema;
    assert.equal(shape.additionalProperties, false);
  }
  assert.equal(tools.find(tool => tool.name === "get_deck_draft")?.annotations?.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "commit_deck_draft")?.annotations?.destructiveHint, true);
  const updateDescriptor = tools.find(tool => tool.name === "update_deck_draft")!.inputSchema;
  const updateSchema = (updateDescriptor.allOf as Array<Record<string, unknown>> | undefined)?.find(schema => schema.properties) ?? updateDescriptor;
  assert.deepEqual(updateSchema.required, ["draftId", "expectedVersion", "mutationId"]);
  assert.ok((updateSchema.properties as Record<string, unknown>).cards);
  assert.ok((updateSchema.properties as Record<string, unknown>).suits);
  for (const session of [unconfigured, anonymousNoOAuth]) assert.equal((await session.client.listTools()).tools.some(tool => names.includes(tool.name)), false);

  const args: Record<string, Record<string, unknown>> = {
    start_deck_draft: { startKey: "draft-retry-key" },
    update_deck_draft: { draftId, expectedVersion: 1, mutationId: "batch-1", metadata: { tagline: "A bounded authored batch." } },
    get_deck_draft: { draftId },
    validate_deck_draft: { draftId, expectedVersion: 2 },
    commit_deck_draft: { draftId, expectedVersion: 2 },
  };
  for (const session of [anon, reader, writerOnly]) for (const name of names) {
    const result = await session.client.callTool({ name, arguments: args[name] });
    assert.equal(result.isError, true, `${name} denies insufficient scopes`);
  }
  assert.equal(calls.length, 0); assert.equal(createChecks, 0); assert.equal(operationChecks, 0);
  const started = toolResult<{ draftId: string; version: number }>(await alice.client.callTool({ name: "start_deck_draft", arguments: args.start_deck_draft }));
  assert.equal(started.draftId, draftId); assert.equal(started.version, 1);
  const updated = toolResult<{ version: number }>(await alice.client.callTool({ name: "update_deck_draft", arguments: args.update_deck_draft }));
  assert.equal(updated.version, 2);
  const read = toolResult<Record<string, unknown>>(await alice.client.callTool({ name: "get_deck_draft", arguments: args.get_deck_draft }));
  assert.equal("manifest" in read, false);
  toolResult(await alice.client.callTool({ name: "get_deck_draft", arguments: { draftId, section: "cards", keys: ["major-0"], offset: 0, limit: 1 } }));
  const validation = toolResult<{ valid: boolean }>(await alice.client.callTool({ name: "validate_deck_draft", arguments: args.validate_deck_draft }));
  assert.equal(validation.valid, false, "incomplete draft validation is repair data, not a tool exception");
  toolResult(await alice.client.callTool({ name: "commit_deck_draft", arguments: { ...args.commit_deck_draft, deckId: "owned-deck", expectedRevision: 4 } }));
  assert.deepEqual(calls.map(call => call.method), ["start", "update", "read", "read", "validate", "commit"]);
  assert.ok(calls.every(call => call.owner === "alice"));
  assert.deepEqual(calls.at(-1)?.input, { draftId, expectedVersion: 2, deckId: "owned-deck", expectedRevision: 4 });
  assert.equal(createChecks, 1); assert.equal(operationChecks, 5);

  const beforeInvalid = calls.length;
  for (const [name, input] of [
    ["start_deck_draft", { startKey: "unsafe/key" }],
    ["start_deck_draft", { startKey: "x".repeat(81) }],
    ["update_deck_draft", { ...args.update_deck_draft, patch: [{ op: "replace", path: "/data", value: {} }] }],
    ["update_deck_draft", { ...args.update_deck_draft, expectedVersion: 0 }],
    ["update_deck_draft", { ...args.update_deck_draft, metadata: { data: JSON.parse('{"extension":{"__proto__":{"polluted":true}}}') } }],
    ["update_deck_draft", { ...args.update_deck_draft, metadata: { data: { extension: { constructor: "unsafe" } } } }],
    ["update_deck_draft", { ...args.update_deck_draft, metadata: { tagline: "é".repeat(32768) } }],
    ["update_deck_draft", { ...args.update_deck_draft, metadata: { data: Object.fromEntries(Array.from({length:21}, (_,index) => [`field-${index}`, "value"])) } }],
    ["get_deck_draft", { draftId, section: "manifest" }],
    ["get_deck_draft", { draftId, section: "cards", limit: 21 }],
    ["validate_deck_draft", { draftId, expectedVersion: 2, includeNormalizedManifest: true }],
    ["commit_deck_draft", { ...args.commit_deck_draft, deckId: "owned-deck" }],
    ["commit_deck_draft", { ...args.commit_deck_draft, expectedRevision: 4 }],
  ] as Array<[string, Record<string, unknown>]>) {
    assert.equal((await alice.client.callTool({ name, arguments: input })).isError, true, `${name} rejects malformed inputs: ${JSON.stringify(input)}`);
  }
  assert.equal(calls.length, beforeInvalid, "invalid inputs never reach repository");

  const extensionInput = { ...args.update_deck_draft, mutationId: "extension", metadata: { data: { extension: { nested: ["🌙", { authored: true }] } } } };
  toolResult(await alice.client.callTool({ name: "update_deck_draft", arguments: extensionInput }));
  assert.deepEqual(calls.at(-1)?.input, extensionInput, "SDK and tool parsing preserve safe authoring extensions exactly");

  allowCreate = false;
  const limitedStart = await alice.client.callTool({ name: "start_deck_draft", arguments: args.start_deck_draft });
  assert.equal(limitedStart.isError, true); assert.match(textContent(limitedStart), /rate limit/i);
  allowCreate = true; allowOperation = false;
  for (const name of ["update_deck_draft", "get_deck_draft", "validate_deck_draft", "commit_deck_draft"]) assert.equal((await alice.client.callTool({ name, arguments: args[name] })).isError, true);
  allowOperation = true;
  failure = new ManifestDraftVersionConflict(8);
  const conflict = await alice.client.callTool({ name: "update_deck_draft", arguments: args.update_deck_draft });
  assert.equal(conflict.isError, true);
  assert.deepEqual(conflict.structuredContent, { error: { code: "draft_version_conflict", currentVersion: 8 } });
  failure = new Error("database password=secret");
  const safeFailure = await alice.client.callTool({ name: "get_deck_draft", arguments: args.get_deck_draft });
  assert.equal(safeFailure.isError, true); assert.doesNotMatch(textContent(safeFailure), /secret|password/);
  console.log("MCP draft discovery, typed schemas, OAuth scopes, owner propagation, rate limits, version conflicts and safe errors passed.");
} finally {
  await Promise.all([alice, anon, reader, writerOnly, unconfigured, anonymousNoOAuth].map(session => session.close()));
}
