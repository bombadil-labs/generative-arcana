#!/usr/bin/env node
// Read-only, anonymous deployment evidence. No credentials, account/deck mutations, or host logins.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function smokeProduction({ baseUrl, expectedSha, fetcher = fetch }) {
  const base = new URL(baseUrl);
  assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Use a base URL without credentials, query, or fragment');
  assert.equal(base.pathname, '/', 'Use the canonical origin, without /mcp');
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)), 'HTTPS required except for loopback tests');
  const evidence = { checkedAt: new Date().toISOString(), origin: base.origin, expectedSha: expectedSha ?? null, checks: [], ok: false };
  async function check(name, action) {
    try { await action(); evidence.checks.push({ name, ok: true }); }
    catch (error) { evidence.checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  async function request(path, init) {
    return fetcher(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(10_000), ...init });
  }
  async function json(path, status = 200) {
    const response = await request(path);
    assert.equal(response.status, status, `${path}: expected HTTP ${status}, got ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/i, `${path}: expected JSON, not an HTML fallback`);
    return response.json();
  }
  await check('health and deployed revision', async () => {
    const health = await json('/healthz');
    evidence.health = health;
    assert.equal(health.ok, true);
    assert.equal(health.auth, 'oauth-oidc');
    assert.equal(health.browserAuth, 'better-auth');
    assert.equal(health.state, 'neon');
    assert.match(health.build?.sha ?? '', /^[a-f0-9]{7,64}$/i, 'Deployment must expose a commit SHA');
    if (expectedSha) assert.equal(health.build.sha, expectedSha, 'Deployed SHA differs from the expected revision');
  });
  await check('production account readiness and dependency evidence', async () => {
    const readiness = await json('/readyz');
    evidence.readiness = readiness;
    assert.equal(readiness.ok, true);
    assert.equal(readiness.readiness?.productionAccounts, true);
    assert.equal(readiness.readiness?.configurationReady, true);
    for (const check of ['durableCatalog', 'mcpOAuth', 'browserAuth', 'webApp', 'alphaDisabled', 'databaseConnectivity', 'issuerDiscovery']) {
      assert.equal(readiness.readiness?.checks?.[check], true, `Readiness check ${check} must pass`);
    }
    for (const name of ['databaseConnectivity', 'issuerDiscovery']) {
      assert.equal(readiness.readiness?.dependencies?.[name]?.status, 'healthy');
      assert.ok(Number.isFinite(Date.parse(readiness.readiness.dependencies[name].checkedAt)), `Missing ${name} check timestamp`);
    }
  });
  let issuer;
  await check('protected resource discovery', async () => {
    const resource = await json('/.well-known/oauth-protected-resource/mcp');
    evidence.resource = resource;
    assert.equal(resource.resource, new URL('/mcp', base).href);
    assert.ok(Array.isArray(resource.authorization_servers) && resource.authorization_servers.length > 0);
    issuer = resource.authorization_servers[0];
    assert.equal(new URL(issuer).protocol, 'https:');
    for (const scope of ['decks:read', 'decks:write']) assert.ok(resource.scopes_supported?.includes(scope), `Missing scope ${scope}`);
    const root = await json('/.well-known/oauth-protected-resource');
    assert.deepEqual(root, resource, 'Root and path-specific discovery must agree');
  });
  await check('authorization server metadata', async () => {
    const metadata = await json('/.well-known/oauth-authorization-server');
    evidence.authorizationServer = metadata;
    assert.ok(issuer, 'Protected-resource discovery did not provide an issuer');
    assert.equal(metadata.issuer, issuer);
    for (const field of ['authorization_endpoint', 'token_endpoint']) assert.equal(new URL(metadata[field]).protocol, 'https:');
    assert.ok(metadata.code_challenge_methods_supported?.includes('S256'), 'PKCE S256 support missing');
  });
  await check('anonymous browser session', async () => {
    const session = await json('/auth/session');
    assert.equal(session.authenticated, false);
  });
  await check('reserved machine routes cannot serve the SPA', async () => {
    for (const path of ['/.well-known/arcana-smoke-missing', '/api/arcana-smoke-missing', '/auth/arcana-smoke-missing', '/mcp/arcana-smoke-missing']) {
      const body = await json(path, 404);
      assert.equal(body.error, 'not_found');
    }
  });
  await check('anonymous MCP tool discovery and protected authoring metadata', async () => {
    let sessionId;
    let protocolVersion = '2025-11-25';
    async function rpc(id, method, params) {
      const response = await request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': protocolVersion, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      assert.equal(response.status, 200, `MCP ${method}: HTTP ${response.status}`);
      sessionId ??= response.headers.get('mcp-session-id') ?? undefined;
      const body = await response.text();
      const messages = response.headers.get('content-type')?.includes('text/event-stream')
        ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
        : [JSON.parse(body)];
      const message = messages.find(message => message.id === id);
      assert.ok(message && !message.error, `MCP ${method}: missing or error response`);
      return message.result;
    }
    const initialized = await rpc(1, 'initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'arcana-production-smoke', version: '1.0.0' } });
    protocolVersion = initialized.protocolVersion;
    const notified = await request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': protocolVersion, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.ok(notified.status === 200 || notified.status === 202 || notified.status === 204);
    const listed = await rpc(2, 'tools/list', {});
    evidence.tools = listed.tools.map(tool => tool.name);
    for (const name of ['get_deck_authoring_spec', 'validate_deck_manifest', 'cast_reading', 'resolve_reading', 'render_reading', 'list_public_decks', 'import_deck', 'list_my_decks', 'set_deck_visibility', 'delete_my_deck']) {
      const tool = listed.tools.find(tool => tool.name === name);
      assert.ok(tool, `Missing tool ${name}`);
      if (['import_deck', 'list_my_decks', 'set_deck_visibility', 'delete_my_deck'].includes(name)) {
        const schemes = tool._meta?.securitySchemes;
        assert.ok(schemes?.some(scheme => scheme.type === 'oauth2' && scheme.scopes?.includes('decks:read')), `${name} must advertise OAuth deck scopes`);
      }
    }
  });
  evidence.ok = evidence.checks.every(check => check.ok);
  evidence.limitations = 'Anonymous smoke only. Does not prove account signup, credentials, database writes, OAuth login in Claude/ChatGPT, private isolation, or durable cross-host journeys.';
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://generative-arcana.vercel.app' }, 'expected-sha': { type: 'string' } } });
    const evidence = await smokeProduction({ baseUrl: values.url, expectedSha: values['expected-sha'] });
    console.log(JSON.stringify(evidence, null, 2));
    if (!evidence.ok) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
