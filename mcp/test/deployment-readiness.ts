import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReadinessHttp, stopChild } from "./readiness-http-fixture";
import {
  accountDeploymentReadiness,
  createDeploymentDependencyMonitor,
  deploymentBuildIdentity,
  type DeploymentDependencies,
} from "../src/deploymentReadiness";

async function main(): Promise<void> {
  const configured = { durableCatalog: true, mcpOAuth: true, browserAuth: true, webApp: true, alphaAuth: false };
  const unchecked = accountDeploymentReadiness(configured);
  assert.equal(unchecked.configurationReady, true);
  assert.equal(unchecked.productionAccounts, false, "configuration must not masquerade as verified dependencies");
  assert.deepEqual(unchecked.missing, ["databaseConnectivity", "issuerDiscovery"]);

  let now = Date.parse("2026-09-30T00:00:00Z");
  let databaseCalls = 0;
  let issuerCalls = 0;
  let failIssuer = false;
  const monitor = createDeploymentDependencyMonitor({
    databaseConnectivity: async () => { databaseCalls++; },
    issuerDiscovery: async () => {
      issuerCalls++;
      if (failIssuer) throw new Error("SECRET database URL or upstream error that must never be exposed");
    },
  }, { now: () => now, cacheMs: 100 });
  assert.equal(monitor.snapshot().databaseConnectivity.status, "not_checked");
  assert.equal(databaseCalls, 0, "liveness snapshots must not probe dependencies");
  const first = monitor.check();
  assert.equal(monitor.check(), first, "concurrent readiness requests must share a single probe");
  const evidence = await first;
  const healthy = accountDeploymentReadiness(configured, evidence);
  assert.equal(healthy.productionAccounts, true);
  assert.equal(healthy.crossHostIdentity, true);
  assert.equal(healthy.webAccountLibrary, true);
  assert.deepEqual(healthy.missing, []);
  assert.equal(accountDeploymentReadiness({ ...configured, alphaAuth: true }, evidence).productionAccounts, false);
  assert.equal(accountDeploymentReadiness({ ...configured, webApp: false }, evidence).productionAccounts, false);
  assert.equal(evidence.issuerDiscovery.checkedAt, "2026-09-30T00:00:00.000Z");
  await monitor.check();
  assert.equal(databaseCalls, 1);
  assert.equal(issuerCalls, 1);
  evidence.databaseConnectivity.status = "unhealthy";
  assert.equal(monitor.snapshot().databaseConnectivity.status, "healthy", "returned snapshots cannot mutate cached health");

  now += 100;
  assert.equal(monitor.snapshot().databaseConnectivity.status, "stale");
  assert.equal(accountDeploymentReadiness(configured, monitor.snapshot()).productionAccounts, false);
  failIssuer = true;
  const failed = await monitor.check();
  assert.equal(databaseCalls, 2);
  assert.equal(issuerCalls, 2);
  assert.equal(failed.issuerDiscovery.status, "unhealthy");
  assert.equal(JSON.stringify(failed).includes("SECRET"), false);
  assert.equal(accountDeploymentReadiness(configured, failed).productionAccounts, false);
  await monitor.check();
  assert.equal(issuerCalls, 2, "failed probes must also be cached to bound load");
  now += 100;
  failIssuer = false;
  assert.equal(accountDeploymentReadiness(configured, await monitor.check()).productionAccounts, true, "readiness must recover after dependencies recover");

  let aborted = false;
  const slow = createDeploymentDependencyMonitor({ databaseConnectivity: async (signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    await new Promise(() => {});
  } }, { timeoutMs: 10 });
  const timed = await slow.check();
  assert.equal(timed.databaseConnectivity.status, "timed_out");
  assert.equal(aborted, true, "timeout must abort downstream I/O");
  assert.equal(timed.issuerDiscovery.status, "not_configured");
  assert.equal(accountDeploymentReadiness(configured, timed).productionAccounts, false);
  assert.deepEqual(await createDeploymentDependencyMonitor({}).check(), {
    databaseConnectivity: { status: "not_configured", checkedAt: null },
    issuerDiscovery: { status: "not_configured", checkedAt: null },
  });

  const sha = "1234567890abcdef1234567890abcdef12345678";
  assert.deepEqual(deploymentBuildIdentity({}), { sha: null, shaSource: null, id: null, idSource: null });
  assert.equal(deploymentBuildIdentity({ VERCEL_GIT_COMMIT_SHA: sha }).sha, sha);
  assert.equal(deploymentBuildIdentity({ ARCANA_BUILD_SHA: " abcdef1 ", VERCEL_GIT_COMMIT_SHA: sha }).sha, "abcdef1");
  assert.equal(deploymentBuildIdentity({ ARCANA_BUILD_SHA: "not-a-sha", VERCEL_GIT_COMMIT_SHA: sha }).shaSource, "VERCEL_GIT_COMMIT_SHA");
  assert.equal(deploymentBuildIdentity({ ARCANA_BUILD_ID: "release-2026.09_1" }).id, "release-2026.09_1");
  assert.equal(deploymentBuildIdentity({ ARCANA_BUILD_ID: "https://secret@example.com" }).id, null);
  assert.equal(deploymentBuildIdentity({ DATABASE_URL: "SECRET", BETTER_AUTH_SECRET: "SECRET" }).sha, null);

  await testHttpDiagnostics(sha);
  await testConfiguredHttpDiagnostics();
  console.log("Deployment readiness tests passed (bounded probes, build metadata, machine-path JSON boundaries).");
}

async function testHttpDiagnostics(sha: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "arcana-readiness-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Arcana SPA fixture</title>");
  let child: ChildProcess | undefined;
  try {
    const fixture = await startReadinessHttp({ ARCANA_WEB_DIST_DIR: dir, ARCANA_BUILD_SHA: sha, ARCANA_BUILD_ID: "test-build" });
    child = fixture.child;
    const { base } = fixture;
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    const healthBody = await health.json() as {
      build: ReturnType<typeof deploymentBuildIdentity>;
      readiness: { configurationReady: boolean; productionAccounts: boolean; dependencies: DeploymentDependencies };
    };
    assert.equal(healthBody.build.sha, sha);
    assert.equal(healthBody.build.shaSource, "ARCANA_BUILD_SHA");
    assert.equal(healthBody.build.id, "test-build");
    assert.equal(healthBody.readiness.productionAccounts, false);
    assert.equal(healthBody.readiness.configurationReady, false);
    assert.equal(healthBody.readiness.dependencies.databaseConnectivity.status, "not_configured");

    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 503);
    assert.equal(ready.headers.get("cache-control"), "no-store");
    const readyBody = await ready.json() as { ok: boolean; build: unknown };
    assert.equal(readyBody.ok, false);
    assert.deepEqual(readyBody.build, healthBody.build);

    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration", "//api/missing", "///.well-known/missing", "/api", "/api/missing", "/auth/missing", "/mcp/missing", "/healthz/missing", "/readyz/missing", "/%61pi/missing"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404, `${path} must not return a successful SPA response`);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      assert.deepEqual(await response.json(), { error: "not_found" });
    }
    for (const [path, error] of [["/auth/session", "browser_auth_unavailable"], ["/api/me/decks", "catalog_unavailable"], ["/api/decks/public", "catalog_unavailable"]]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 503);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      assert.deepEqual(await response.json(), { error });
    }
    for (const method of ["HEAD", "POST", "OPTIONS"]) {
      const response = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, { method });
      assert.equal(response.status, 404);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    }
    const spa = await fetch(`${base}/some/browser/route`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /Arcana SPA fixture/);
  } finally {
    if (child) await stopChild(child);
    await rm(dir, { recursive: true, force: true });
  }
}

/** Stub only dependency transports; exercise the real runtime wiring and HTTP status decisions. */
async function testConfiguredHttpDiagnostics(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "arcana-ready-configured-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Configured fixture</title>");
  const preload = join(dir, "dependencies.mjs");
  await writeFile(preload, `
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (!init?.signal) throw new Error("Probe requests must carry an abort signal");
      if (url.pathname === "/sql" && url.hostname.endsWith(".example.test")) {
        const query = JSON.parse(init.body);
        if (!/^SELECT (principal_id FROM arcana_external_identities|id, owner_id, manifest FROM arcana_user_decks|scope_id, state FROM arcana_host_state|key, bucket, count FROM arcana_rate_limits|id,owner_id,raw_json,import_result,draft_version,draft_key,draft_history,draft_json FROM arcana_manifest_uploads) LIMIT 0$/.test(query.query) || query.params.length !== 0) throw new Error("Unexpected database query");
        if (process.env.TEST_DEPENDENCY_MODE === "database_error") throw new Error("DO_NOT_EXPOSE_DATABASE_SECRET");
        return Response.json({ command: "SELECT", rowCount: 1, fields: [{ name: "ready", dataTypeID: 23 }], rows: [["1"]] });
      }
      if (url.href === "https://issuer.example.test/.well-known/oauth-authorization-server") {
        return Response.json({ issuer: process.env.TEST_DEPENDENCY_MODE === "issuer_mismatch" ? "https://wrong.example.test/" : "https://issuer.example.test/" });
      }
      throw new Error("Unexpected outbound dependency request");
    };
  `);
  try {
    for (const mode of ["healthy", "database_error", "issuer_mismatch"]) {
      const resource = "https://resource.example.test/mcp";
      const { child, base } = await startReadinessHttp({
        ARCANA_WEB_DIST_DIR: dir,
        TEST_DEPENDENCY_MODE: mode,
        DATABASE_URL: "postgresql://test:fake@db.example.test/test",
        MCP_OAUTH_ISSUER: "https://issuer.example.test/", MCP_OAUTH_RESOURCE: resource,
      }, [preload]);
      try {
        const initialHealth = await (await fetch(`${base}/healthz`)).json() as { readiness: ReturnType<typeof accountDeploymentReadiness> };
        assert.equal(initialHealth.readiness.configurationReady, false, "external OAuth alone does not configure browser accounts");
        assert.equal(initialHealth.readiness.productionAccounts, false);
        assert.equal(initialHealth.readiness.dependencies.issuerDiscovery.status, "not_checked");
        const ready = await fetch(`${base}/readyz`);
        assert.equal(ready.status, 503, "browser accounts remain unconfigured in this external-issuer fixture");
        const readyText = await ready.text();
        assert.equal(readyText.includes("DO_NOT_EXPOSE"), false);
        const body = JSON.parse(readyText) as { ok: boolean; readiness: ReturnType<typeof accountDeploymentReadiness> };
        assert.equal(body.ok, false);
        assert.equal(body.readiness.configurationReady, false, "dependency health must not fabricate browser configuration");
        assert.equal(body.readiness.dependencies.databaseConnectivity.status, mode === "database_error" ? "unhealthy" : "healthy");
        assert.equal(body.readiness.dependencies.issuerDiscovery.status, mode === "issuer_mismatch" ? "unhealthy" : "healthy");
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200, "unhealthy dependencies must not make liveness fail");
        const healthBody = await health.json() as { readiness: unknown };
        assert.deepEqual(healthBody.readiness, body.readiness, "liveness must expose the latest cached evidence");
        const discovery = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
        assert.equal(discovery.status, 200, "configured metadata routes must remain enabled");
        assert.match(discovery.headers.get("content-type") ?? "", /^application\/json/);
        const metadata = await discovery.json() as { resource: string };
        assert.equal(metadata.resource, resource);
      } finally {
        await stopChild(child);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
