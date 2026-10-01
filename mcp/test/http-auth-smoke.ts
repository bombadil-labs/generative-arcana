import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertFormerDecksUnavailable, neutralManifest, textContent, toolResult } from "./protocol-fixtures";

const port = 44000 + (process.pid % 1000);
const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
const health = new URL(`http://127.0.0.1:${port}/healthz`);
const token = "alpha-smoke-secret";
const customSlug = "authenticated-restart-deck";

async function main(): Promise<void> {
  const stateDir = await mkdtemp(join(tmpdir(), "generative-arcana-http-auth-"));
  try {
    let readingToken = "";
    let server = spawnServer(stateDir);
    try {
      await waitForHealth(server.child, health, () => server.stderr);
      await assertAnonymousSurface();
      readingToken = await importAuthenticatedDeck();
    } finally {
      await stopChild(server.child);
    }

    // Fresh process, same durable state directory.
    server = spawnServer(stateDir);
    try {
      await waitForHealth(server.child, health, () => server.stderr);
      await assertAuthenticatedDeckRestored(readingToken);
    } finally {
      await stopChild(server.child);
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function assertAnonymousSurface(): Promise<void> {
  await withClient(undefined, async (client) => {
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "import_deck"), false);
    assert.deepEqual(toolResult(await client.callTool({ name: "list_decks", arguments: {} })), []);
    await assertFormerDecksUnavailable(client);
  });
}

async function importAuthenticatedDeck(): Promise<string> {
  let readingToken = "";
  await withClient(token, async (client) => {
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "import_deck"), true, "authenticated HTTP must expose import_deck");
    assert.deepEqual(toolResult(await client.callTool({ name: "list_decks", arguments: {} })), [], "fresh authenticated hosts also start empty");

    const imported = toolResult<{ id: string }>(await client.callTool({
      name: "import_deck", arguments: { manifest: neutralManifest(customSlug) },
    }));
    assert.equal(imported.id, customSlug);
    const listed = await client.callTool({ name: "list_decks", arguments: {} });
    assert.deepEqual(readDeckIds(listed), new Set([customSlug]));

    const reading = toolResult<{ token: string; deckId: string; placements: unknown[] }>(await client.callTool({
      name: "cast_reading", arguments: { deckId: customSlug, spread: "three-card", question: "Keep this reading across restart." },
    }));
    assert.equal(reading.deckId, customSlug);
    assert.equal(reading.placements.length, 3);
    readingToken = reading.token;
    const resolved = toolResult(await client.callTool({ name: "resolve_reading", arguments: { token: readingToken } }));
    assert.deepEqual(resolved, reading);
  });
  return readingToken;
}

async function assertAuthenticatedDeckRestored(readingToken: string): Promise<void> {
  await withClient(token, async (client) => {
    const listed = await client.callTool({ name: "list_decks", arguments: {} });
    assert.deepEqual(readDeckIds(listed), new Set([customSlug]), "only the explicitly imported deck must survive HTTP server restart");
    const restored = toolResult<{ token: string; deckId: string; question: string; placements: unknown[] }>(await client.callTool({
      name: "resolve_reading", arguments: { token: readingToken },
    }));
    assert.equal(restored.token, readingToken);
    assert.equal(restored.deckId, customSlug);
    assert.equal(restored.question, "Keep this reading across restart.");
    assert.equal(restored.placements.length, 3);
    assert.deepEqual(toolResult(await client.callTool({ name: "list_visual_packs", arguments: { deckId: customSlug } })), []);
    const rendered = await client.callTool({ name: "render_reading", arguments: { token: readingToken } });
    assert.equal(rendered.isError, true);
    assert.match(textContent(rendered), /no server-renderable visual/);
  });
  await withClient(undefined, async (client) => {
    const listed = await client.callTool({ name: "list_decks", arguments: {} });
    assert.deepEqual(readDeckIds(listed), new Set(), "anonymous surface must remain empty after authenticated import/restart");
    const privateReading = await client.callTool({ name: "resolve_reading", arguments: { token: readingToken } });
    assert.equal(privateReading.isError, true, "anonymous callers must not resolve an authenticated deck's reading");
    assert.match(textContent(privateReading), /unknown deck/i);
  });
}

async function withClient(tokenValue: string | undefined, fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "generative-arcana-auth-smoke", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, tokenValue ? {
    requestInit: { headers: { Authorization: `Bearer ${tokenValue}` } },
  } : undefined);
  try {
    await withTimeout(client.connect(transport), 10_000, "authenticated HTTP MCP connect");
    await fn(client);
  } finally {
    await withTimeout(transport.terminateSession(), 2_000, "authenticated HTTP session termination").catch(() => undefined);
    await withTimeout(client.close(), 2_000, "authenticated HTTP client close").catch(() => undefined);
  }
}

function readDeckIds(result: Awaited<ReturnType<Client["callTool"]>>): Set<string> {
  return new Set(toolResult<Array<{ id: string }>>(result).map((deck) => deck.id));
}

function spawnServer(stateDir: string): { child: ChildProcess; stderr: string } {
  const result = { stderr: "" } as { child: ChildProcess; stderr: string };
  result.child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MCP_ALPHA_TOKEN: token,
      MCP_ALPHA_PRINCIPAL_ID: "alpha-smoke-principal",
      MCP_STATE_DIR: stateDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  result.child.stderr?.on("data", (chunk) => { result.stderr += String(chunk); });
  return result;
}

async function waitForHealth(child: ChildProcess, url: URL, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`HTTP MCP exited before health check.\n${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for HTTP MCP health check.\n${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
