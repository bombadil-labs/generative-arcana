import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config, target, planDigest, migration, verifyCandidate, deploy, request } from '../staging/release.mjs';
const sha = 'a'.repeat(40);
const base = { REVIEWED_SHA: sha, OPERATION: 'plan', GITHUB_REPOSITORY: target.repository, GITHUB_REF: 'refs/heads/main', STAGING_MIGRATION_ROLE: 'staging_migrator', DATABASE_MIGRATION_URL: `postgresql://staging_migrator:fake@${target.host}/neondb?sslmode=require` };
const plan = { recordedThrough: 6, pending: [{ version: 7, file: '007-fixture.sql', sha256: 'b'.repeat(64) }] };
const write = { ...base, OPERATION: 'release', STAGING_WRITES_ENABLED: 'true', CONFIRMATION: `RELEASE ${sha}`, PLAN_DIGEST: planDigest(sha, base.STAGING_MIGRATION_ROLE, plan), RECOVERY_REFERENCE: 'reviewed-restore-test', STAGING_DEPLOY_ENABLED: 'true', STAGING_ENVIRONMENT_ID: 'env_fixture', STAGING_ALIAS: 'arcana-staging.example.com', STAGING_MAPPING_REVIEW: 'mapping-review', STAGING_MANUAL_ALIAS_REVIEW: 'alias-review' };
function github(overrides = {}) { return async path => path.startsWith('/git/ref') ? { object: { sha: overrides.sha || sha } } : { workflow_runs: [{ id: 2, head_sha: sha, head_branch: 'staging', event: 'push', status: 'completed', conclusion: overrides.conclusion || 'success' }] }; }
test('disabled writes, wrong dispatch, confirmation, recovery and candidate all fail closed', async () => {
  for (const patch of [{ STAGING_WRITES_ENABLED: '' }, { CONFIRMATION: 'release' }, { RECOVERY_REFERENCE: 'disposable-staging:old-waiver' }, { GITHUB_REF: 'refs/heads/staging' }, { REVIEWED_SHA: 'main' }]) assert.throws(() => config({ ...write, ...patch }));
  await assert.rejects(verifyCandidate(write, github({ sha: 'c'.repeat(40) })), /superseded/);
  await assert.rejects(verifyCandidate(write, github({ conclusion: 'failure' })), /validation/);
});
test('latest failed validation cannot reuse an older passing run', async () => {
  const gh = async path => path.startsWith('/git/ref') ? { object: { sha } } : { workflow_runs: [1, 2].map(id => ({ id, head_sha: sha, head_branch: 'staging', event: 'push', status: 'completed', conclusion: id === 1 ? 'success' : 'failure' })) };
  await assert.rejects(verifyCandidate(write, gh), /validation/);
});
test('plan/status never apply; reviewed writes use plan, apply, status in order', () => {
  const operations = [];
  const execute = (_, args) => { const op = args[3]; operations.push(op); assert.ok(args.includes(target.host)); return JSON.stringify(op === 'plan' ? plan : { pending: [] }); };
  migration(base, execute); assert.deepEqual(operations.splice(0), ['plan']);
  migration({ ...base, OPERATION: 'status' }, execute); assert.deepEqual(operations.splice(0), ['status']);
  migration(write, execute); assert.deepEqual(operations.splice(0), ['plan', 'apply', 'status']);
  assert.throws(() => migration({ ...write, PLAN_DIGEST: 'c'.repeat(64) }, execute), /Plan changed/); assert.deepEqual(operations.splice(0), ['plan']);
  assert.throws(() => migration(write, () => JSON.stringify({ ...plan, baselineRequired: true })), /adoption/);
  for (const uri of ['postgresql://staging_migrator:fake@production.example/neondb', `postgresql://other:fake@${target.host}/neondb`, `postgresql://staging_migrator:fake@${target.host}/other`]) assert.throws(() => migration({ ...write, DATABASE_MIGRATION_URL: uri }, execute), /target mismatch/);
});
test('failed apply or status stops the migration gate', () => {
  for (const failure of ['apply', 'status']) {
    const operations = [];
    assert.throws(() => migration(write, (_, args) => { const op = args[3]; operations.push(op); if (op === failure) throw Error('injected'); return JSON.stringify(plan); }), /injected/);
    assert.deepEqual(operations, failure === 'apply' ? ['plan', 'apply'] : ['plan', 'apply', 'status']);
  }
});
function fixture(overrides = {}) {
  const calls = [];
  const d = { id: 'dpl_fixture', url: 'fixture.vercel.app', projectId: target.project, customEnvironment: { id: write.STAGING_ENVIRONMENT_ID }, target: null, gitSource: { type: 'github', repoId: target.repositoryId, sha }, readyState: 'READY', ...overrides.deployment };
  return { calls, deps: { candidateConfig: { git: { deploymentEnabled: { staging: false } } }, gh: overrides.gh || github(), sleep: async () => {}, ready: async () => { calls.push('ready'); if (overrides.readinessFailure) throw Error('not ready'); }, vc: async (path, body) => {
    calls.push(body ? { path, body } : path);
    if (path.includes('custom-environments')) return { id: write.STAGING_ENVIRONMENT_ID, slug: 'staging', type: 'preview', domains: overrides.domains || [] };
    if (path.includes('/domains?')) return { domains: overrides.projectDomains || [] };
    if (path === '/v13/deployments') return { id: d.id };
    if (path.includes('/aliases')) return body ? { alias: body.alias } : { deploymentId: d.id };
    return d;
  } } };
}
test('exact migrated SHA deployment precedes readiness and manual alias, with final verification', async () => {
  const f = fixture(); await deploy(write, f.deps);
  const writes = f.calls.filter(x => typeof x === 'object');
  assert.equal(writes.length, 2); assert.equal(writes[0].body.gitSource.sha, sha);
  assert.equal(writes[0].body.customEnvironmentSlugOrId, write.STAGING_ENVIRONMENT_ID);
  assert.equal(writes[0].body.target, undefined);
  assert.equal(writes[1].body.alias, write.STAGING_ALIAS);
  assert.ok(f.calls.indexOf('ready') < f.calls.indexOf(writes[1]));
});
test('wrong SHA/environment, failed readiness or superseding push never promote', async () => {
  let reads = 0;
  for (const overrides of [{ deployment: { gitSource: { sha: 'b'.repeat(40) } } }, { deployment: { target: 'production' } }, { readinessFailure: true }, { deployment: { readyState: 'ERROR' } }, { gh: async path => path.startsWith('/git/ref') ? { object: { sha: ++reads > 1 ? 'c'.repeat(40) : sha } } : github()(path) }]) {
    const f = fixture(overrides); await assert.rejects(deploy(write, f.deps));
    assert.equal(f.calls.filter(x => typeof x === 'object' && x.path.includes('/aliases')).length, 0);
  }
});
test('automatic staging domain assignment or disabled configuration never creates deployment', async () => {
  for (const overrides of [{ domains: [{ name: write.STAGING_ALIAS }] }, { projectDomains: [{ gitBranch: 'staging' }] }]) {
    const f = fixture(overrides); await assert.rejects(deploy(write, f.deps));
    assert.equal(f.calls.filter(x => typeof x === 'object').length, 0);
  }
  const f = fixture(); await assert.rejects(deploy({ ...write, STAGING_DEPLOY_ENABLED: '' }, f.deps)); assert.equal(f.calls.length, 0);
});
test('provider errors stay generic and requests cannot redirect credentials', async () => {
  await assert.rejects(request('https://api.example', 'fake', undefined, async (_, options) => { assert.equal(options.redirect, 'error'); return { ok: false, status: 403, text: () => 'SECRET' }; }), error => !error.message.includes('SECRET'));
});
test('workflow has manual-only writes, shared lock, immutable refs and migration dependency', () => {
  const workflow = readFileSync('.github/workflows/staging-release.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /^  (push|pull_request|workflow_run):/m);
  assert.match(workflow, /group: arcana-preview-migration\n  cancel-in-progress: false/);
  assert.match(workflow, /needs: migration/); assert.match(workflow, /if: inputs.operation == 'release'/);
  assert.equal((workflow.match(/ref: \$\{\{ inputs.reviewed_sha \}\}/g) || []).length, 2);
  assert.match(workflow, /secrets.ARCANA_STAGING_MIGRATION_URL/); assert.doesNotMatch(workflow, /ARCANA_PRODUCTION_MIGRATION_URL|ARCANA_PREVIEW_MIGRATION_URL/);
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')); assert.equal(vercel.git.deploymentEnabled.staging, false); assert.equal(vercel.git.deploymentEnabled['dependabot/**'], false);
});
