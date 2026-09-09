import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import deepTime from "../../decks/deep-time/deck.json";
import { createArcanaMcpServer } from "../src/server";
import { createArcanaAuthoringRequestHandler } from "../src/authoringApi";

async function main(): Promise<void> {
  await httpContract();
  await realHttpRoutingContract();
  await mcpContract();
}

async function httpContract(): Promise<void> {
  const handler = createArcanaAuthoringRequestHandler({ maxRequestBytes: 2_000_000 });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("authoring API test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    let response = await fetch(`${base}/api/authoring/spec`);
    assert.equal(response.status, 200);
    const spec = await response.json() as { spec: { kind: string }; validation: { mcpTool: string } };
    assert.equal(spec.spec.kind, "generative-arcana/deck-manifest");
    assert.equal(spec.validation.mcpTool, "validate_deck_manifest");

    response = await fetch(`${base}/api/authoring/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: deepTime, tagline: "HTTP canonical" }),
    });
    assert.equal(response.status, 200);
    const canonical = await response.json() as { valid: boolean; canonical: boolean; summary: { slug: string }; normalizedManifest?: unknown };
    assert.equal(canonical.valid, true);
    assert.equal(canonical.canonical, true);
    assert.equal(canonical.summary.slug, deepTime.slug);
    assert.equal(canonical.normalizedManifest, undefined);

    response = await fetch(`${base}/api/authoring/validate?includeNormalizedManifest=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deepTime),
    });
    const legacy = await response.json() as { valid: boolean; canonical: boolean; inputKind: string; normalizedManifest?: { data: { slug: string } } };
    assert.equal(legacy.valid, true);
    assert.equal(legacy.canonical, false);
    assert.equal(legacy.inputKind, "legacy-raw-deck");
    assert.equal(legacy.normalizedManifest?.data.slug, deepTime.slug);

    response = await fetch(`${base}/api/authoring/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: deepTime, tagline: "" }),
    });
    const invalid = await response.json() as { valid: boolean; error?: string };
    assert.equal(response.status, 200, "domain-invalid authored content is a repair result, not a transport error");
    assert.equal(invalid.valid, false);
    assert.match(invalid.error ?? "", /tagline/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function realHttpRoutingContract(): Promise<void> {
  const port = 47000 + (process.pid % 1000);
  const child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MCP_RATE_LIMIT_PER_MINUTE: "100",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(child, `${base}/healthz`, () => stderr);
    let response = await fetch(`${base}/api/authoring/spec`);
    assert.equal(response.status, 200, "authoring spec is routed by the real account-free HTTP server");

    response = await fetch(`${base}/api/authoring/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: deepTime, tagline: "Real HTTP route" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { valid?: boolean }).valid, true);
  } finally {
    await stopChild(child);
  }
}

async function waitForHealth(child: ChildProcess, url: string, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`HTTP MCP exited before health check.\n${stderr()}`);
    try {
      if ((await fetch(url)).ok) return;
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

async function mcpContract(): Promise<void> {
  const server = createArcanaMcpServer({ includeStatefulTools: false });
  const client = new Client({ name: "authoring-contract-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_deck_authoring_spec"));
    assert.ok(tools.tools.some((tool) => tool.name === "validate_deck_manifest"));

    const spec = await client.callTool({ name: "get_deck_authoring_spec", arguments: {} });
    assert.equal(spec.isError, undefined);
    const specResult = (spec.structuredContent as { result?: { kind?: string } } | undefined)?.result;
    assert.equal(specResult?.kind, "generative-arcana/deck-manifest");

    const validated = await client.callTool({
      name: "validate_deck_manifest",
      arguments: { manifest: { data: deepTime, tagline: "MCP canonical" } },
    });
    assert.equal(validated.isError, undefined);
    const result = (validated.structuredContent as { result?: { valid?: boolean; canonical?: boolean } } | undefined)?.result;
    assert.equal(result?.valid, true);
    assert.equal(result?.canonical, true);

    const invalid = await client.callTool({
      name: "validate_deck_manifest",
      arguments: { manifest: { data: deepTime, tagline: "" } },
    });
    assert.equal(invalid.isError, undefined, "invalid authored content remains structured repair data");
    assert.equal((invalid.structuredContent as { result?: { valid?: boolean } } | undefined)?.result?.valid, false);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
