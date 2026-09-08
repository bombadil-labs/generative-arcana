import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const REQUIRED_HTTP_TOOLS = [
  "list_decks",
  "get_deck",
  "get_card",
  "analyze_card",
  "query_cards",
  "list_spreads",
  "cast_reading",
  "resolve_reading",
  "interpretation_context",
];

const port = 43000 + (process.pid % 1000);
const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
const health = new URL(`http://127.0.0.1:${port}/healthz`);

async function main(): Promise<void> {
  const child = spawn("npx", ["tsx", "src/http.ts"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  try {
    await waitForHealth(child, health, () => stderr);

    const client = new Client({ name: "generative-arcana-http-smoke", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(endpoint);
    try {
      await client.connect(transport);

      const listed = await client.listTools();
      const names = new Set(listed.tools.map((tool) => tool.name));
      for (const name of REQUIRED_HTTP_TOOLS) assert.ok(names.has(name), `missing HTTP MCP tool: ${name}`);
      assert.equal(names.has("import_deck"), false, "stateless HTTP must not expose persistent import_deck");

      const result = await client.callTool({ name: "list_decks", arguments: {} });
      assert.equal(result.isError, undefined);
      const text = result.content.find((part) => part.type === "text");
      assert.ok(text && text.type === "text", "list_decks returned no text content over HTTP");
      const decks = JSON.parse(text.text) as Array<{ id: string }>;
      assert.equal(decks.length, 7);
    } finally {
      await client.close();
    }
  } finally {
    await stopChild(child);
  }
}

async function waitForHealth(child: ChildProcess, url: URL, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`HTTP MCP exited before health check.\n${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for HTTP MCP health check.\n${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
