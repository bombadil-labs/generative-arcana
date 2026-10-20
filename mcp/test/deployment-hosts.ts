import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { hostHeaderValidation } from '@modelcontextprotocol/node';
import { deploymentAllowedHosts } from '../src/deploymentHosts';

const env = { VERCEL_URL: 'candidate.vercel.app', BETTER_AUTH_URL: 'https://staging.example.com' };
const hosts = deploymentAllowedHosts('0.0.0.0', env);
assert.deepEqual(hosts, ['candidate.vercel.app', 'staging.example.com']);
assert.deepEqual(deploymentAllowedHosts('0.0.0.0', { ...env, MCP_ALLOWED_HOSTS: 'only.example.com' }), ['only.example.com']);
assert.deepEqual(deploymentAllowedHosts('0.0.0.0', { ...env, MCP_ALLOWED_HOSTS: '' }), []);
assert.deepEqual(deploymentAllowedHosts('0.0.0.0', {}), []);
assert.deepEqual(deploymentAllowedHosts('127.0.0.1', {}), ['localhost', '127.0.0.1', '[::1]']);
assert.deepEqual(deploymentAllowedHosts('0.0.0.0', { ...env, BETTER_AUTH_URL: 'https://candidate.vercel.app' }), ['candidate.vercel.app']);
for (const url of ['https://*.example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com/#fragment', 'http://public.example.com']) {
  assert.throws(() => deploymentAllowedHosts('0.0.0.0', { BETTER_AUTH_URL: url }));
}
const validate = hostHeaderValidation(hosts);
const server = createServer((req, res) => { if (validate(req, res)) { res.writeHead(200); res.end('accepted'); } });
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  for (const [host, expected] of [['candidate.vercel.app', 200], ['staging.example.com', 200], ['attacker.example.com', 403], ['staging.example.com.attacker.test', 403]]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${address.port}/readyz`, { headers: { host: String(host), 'x-forwarded-host': 'staging.example.com' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(status, expected);
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('Exact deployment/auth hosts accepted; unrelated hosts and forwarded-header spoofing rejected; explicit overrides preserved.');
