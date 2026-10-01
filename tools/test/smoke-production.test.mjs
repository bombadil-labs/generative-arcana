import assert from 'node:assert/strict';
import test from 'node:test';
import { smokeProduction } from '../smoke-production.mjs';
const sha = '1234567890abcdef1234567890abcdef12345678';
const origin = 'https://arcana.example';
const issuer = 'https://identity.example';
const tools = ['get_deck_authoring_spec', 'validate_deck_manifest', 'cast_reading', 'resolve_reading', 'render_reading', 'list_public_decks', 'import_deck', 'list_my_decks', 'set_deck_visibility', 'delete_my_deck'].map(name => ({ name, _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['decks:read', 'decks:write'] }] } }));
const resource = { resource: `${origin}/mcp`, authorization_servers: [issuer], scopes_supported: ['decks:read', 'decks:write'] };
const ready = { ok: true, readiness: { productionAccounts: true, configurationReady: true,
  checks: Object.fromEntries(['durableCatalog', 'mcpOAuth', 'browserAuth', 'webApp', 'alphaDisabled', 'databaseConnectivity', 'issuerDiscovery'].map(name => [name, true])),
  dependencies: Object.fromEntries(['databaseConnectivity', 'issuerDiscovery'].map(name => [name, { status: 'healthy', checkedAt: new Date().toISOString() }])) } };
function fixture(overrides = {}, sse = false) {
  const paths = {
    '/healthz': { ok: true, auth: 'oauth-oidc', browserAuth: 'better-auth', state: 'neon', build: { sha } },
    '/readyz': ready,
    '/.well-known/oauth-protected-resource/mcp': resource,
    '/.well-known/oauth-protected-resource': resource,
    '/.well-known/oauth-authorization-server': { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, code_challenge_methods_supported: ['S256'] },
    '/auth/session': { authenticated: false },
    ...overrides,
  };
  const calls = [];
  return { calls, fetcher: async (url, init) => {
    calls.push({ path: url.pathname, init });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.equal(init.headers?.authorization, undefined, 'smoke never sends credentials');
    if (url.pathname === '/mcp') {
      const { id, method } = JSON.parse(init.body);
      assert.ok(['initialize', 'notifications/initialized', 'tools/list'].includes(method), 'smoke never calls a mutating tool');
      if (method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = method === 'initialize' ? { protocolVersion: '2025-11-25' } : { tools };
      const body = JSON.stringify({ jsonrpc: '2.0', id, result });
      return new Response(sse ? `event: message\ndata: ${body}\n\n` : body, { headers: { 'content-type': sse ? 'text/event-stream' : 'application/json' } });
    }
    if (paths[url.pathname] instanceof Response) return paths[url.pathname].clone();
    return new Response(JSON.stringify(paths[url.pathname] ?? { error: 'not_found' }), { status: url.pathname in paths ? 200 : 404, headers: { 'content-type': 'application/json' } });
  } };
}

test('passing anonymous smoke collects evidence without any mutation or credentials', async () => {
  for (const sse of [false, true]) {
    const mock = fixture({}, sse);
    const report = await smokeProduction({ baseUrl: origin, expectedSha: sha, fetcher: mock.fetcher });
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.checks.length, 7);
    assert.deepEqual(report.tools, tools.map(tool => tool.name));
    assert.match(report.limitations, /Does not prove account signup/);
  }
});

test('records configuration, SHA, discovery HTML and readiness failures without hiding later checks', async () => {
  const mock = fixture({
    '/healthz': { ok: true, auth: 'alpha-bearer', state: 'neon' },
    '/readyz': new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'content-type': 'application/json' } }),
    '/.well-known/oauth-protected-resource/mcp': new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } }),
  });
  const report = await smokeProduction({ baseUrl: origin, expectedSha: sha, fetcher: mock.fetcher });
  assert.equal(report.ok, false);
  assert.equal(report.checks.length, 7);
  assert.ok(report.checks.some(check => !check.ok && check.error.includes('HTML fallback')));
  assert.ok(report.checks.some(check => !check.ok && check.error.includes('503')));
  assert.equal(report.checks.at(-1).ok, true, 'remaining checks still run');
});

test('rejects wrong revision and misleading anonymous session response', async () => {
  const report = await smokeProduction({ baseUrl: origin, expectedSha: 'abcdef0', fetcher: fixture({ '/auth/session': { status: 'anonymous' } }).fetcher });
  assert.equal(report.checks[0].ok, false);
  assert.equal(report.checks.find(check => check.name === 'anonymous browser session').ok, false);
});

test('rejects insecure destinations and embedded credentials before any network action', async () => {
  for (const baseUrl of ['http://arcana.example', 'https://user:secret@arcana.example', `${origin}/mcp`, `${origin}/?token=secret`]) {
    await assert.rejects(smokeProduction({ baseUrl, fetcher: async () => { throw new Error('must never be called'); } }));
  }
});
