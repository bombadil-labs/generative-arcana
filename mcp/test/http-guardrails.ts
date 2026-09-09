import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { ARCANA_MCP_VERSION } from "../src/version";

const port = 45000 + (process.pid % 1000);
const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
const health = new URL(`http://127.0.0.1:${port}/healthz`);

async function main(): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MCP_MAX_REQUEST_BYTES: "32",
      MCP_RATE_LIMIT_PER_MINUTE: "2",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  try {
    await waitForHealth(child, health, () => stderr);
    const healthResponse = await fetch(health);
    const healthBody = await healthResponse.json() as { version?: string; limits?: { maxRequestBytes?: number; requestsPerMinute?: number } };
    assert.equal(healthBody.version, ARCANA_MCP_VERSION);
    assert.deepEqual(healthBody.limits, { maxRequestBytes: 32, requestsPerMinute: 2 });

    const oversized = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(64) }),
    });
    assert.equal(oversized.status, 413);

    const first = await invalidMcpPost();
    const second = await invalidMcpPost();
    assert.notEqual(first.status, 429);
    assert.notEqual(second.status, 429);
    const third = await invalidMcpPost();
    assert.equal(third.status, 429);
    assert.equal(third.headers.get("retry-after"), "60");
  } finally {
    await stopChild(child);
  }
}

function invalidMcpPost(): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
