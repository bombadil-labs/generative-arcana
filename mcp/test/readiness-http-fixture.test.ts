import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { startReadinessHttp, stopChild, waitForListening } from "./readiness-http-fixture";

test("concurrent real runtimes own distinct listeners even with the configured port occupied", async () => {
  const occupied = createServer((_req, res) => { res.end("unrelated listener"); });
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  const fixtures: Awaited<ReturnType<typeof startReadinessHttp>>[] = [];
  try {
    // Keep this socket bound throughout startup: no reserve/release race or retry.
    const results = await Promise.allSettled([0, 1, 2].map(async (index) => {
      const fixture = await startReadinessHttp({ PORT: String(address.port), ARCANA_BUILD_ID: `fixture-${index}` });
      fixtures.push(fixture);
      assert.notEqual(new URL(fixture.base).port, String(address.port));
      const response = await fetch(`${fixture.base}/healthz`);
      assert.equal(response.status, 200);
      const body = await response.json() as { build: { id: string } };
      assert.equal(body.build.id, `fixture-${index}`, "health must belong to this subprocess");
    }));
    for (const result of results) if (result.status === "rejected") throw result.reason;
    assert.equal(new Set(fixtures.map(({ base }) => base)).size, 3);
  } finally {
    await Promise.all(fixtures.map(({ child }) => stopChild(child)));
    await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
  }
});

test("fixture still runs production PORT validation", async () => {
  await assert.rejects(startReadinessHttp({ PORT: "0" }), /PORT must be an integer from 1 to 65535/);
});

test("startup requires a valid owned loopback listener message", async () => {
  for (const message of [null, "noise", {},
    { type: "other", address: "127.0.0.1", port: 1234 },
    { type: "arcana-test-listening", address: "0.0.0.0", port: 1234 },
    ...[0, -1, 65536, 1.5, "1234"].map((port) => ({ type: "arcana-test-listening", address: "127.0.0.1", port })),
  ]) {
    const child = new ChildProcess();
    const listening = waitForListening(child, () => "fixture stderr");
    child.emit("message", message);
    await assert.rejects(listening, /Invalid HTTP fixture listener message\nfixture stderr/);
    assertNoStartupListeners(child);
  }
});

test("startup reports errors, normal exits, signal exits, and timeout without leaking listeners", async () => {
  for (const mode of ["error", "exit", "signal", "already-exited", "timeout"]) {
    const child = new ChildProcess();
    if (mode === "already-exited") Object.defineProperty(child, "signalCode", { value: "SIGKILL" });
    const listening = waitForListening(child, () => "startup diagnostics", 10);
    if (mode === "error") child.emit("error", new Error("spawn failed"));
    if (mode === "exit") { Object.defineProperty(child, "exitCode", { value: 1 }); child.emit("exit", 1, null); }
    if (mode === "signal") { Object.defineProperty(child, "signalCode", { value: "SIGTERM" }); child.emit("exit", null, "SIGTERM"); }
    await assert.rejects(listening, mode === "timeout" ? /Timed out.*\nstartup diagnostics/ : /(?:failed to start|exited before listening).*\nstartup diagnostics/);
    assertNoStartupListeners(child);
  }
});

test("shutdown waits for graceful exit and forced SIGKILL exit, including already signaled children", async () => {
  for (const graceful of [true, false]) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { createServer } from "node:http";
      process.on("SIGTERM", () => { ${graceful ? "process.exit(0);" : "/* deliberately ignore graceful shutdown */"} });
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        process.send({ type: "arcana-test-listening", address: address.address, port: address.port });
      });
    `], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    try {
      const base = await waitForListening(child, () => stderr);
      let observedExit = false;
      child.once("exit", () => { observedExit = true; });
      await stopChild(child, graceful ? 1_000 : 25);
      assert.equal(observedExit, true, "shutdown must not return immediately after sending SIGKILL");
      assert.equal(child.exitCode, graceful ? 0 : null);
      assert.equal(child.signalCode, graceful ? null : "SIGKILL");
      await assert.rejects(fetch(base, { signal: AbortSignal.timeout(1_000) }));
      await stopChild(child, graceful ? 1_000 : 25);
      assert.equal(child.listenerCount("exit"), 0, "already-exited children must not acquire an exit waiter");
    } finally {
      await stopChild(child, graceful ? 1_000 : 25);
    }
  }
});

function assertNoStartupListeners(child: ChildProcess): void {
  for (const event of ["message", "error", "exit"]) assert.equal(child.listenerCount(event), 0, event);
}
