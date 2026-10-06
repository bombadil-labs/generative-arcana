import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const target = Object.freeze({
  repository: 'bombadil-labs/generative-arcana', repositoryId: 1291398116,
  neonProject: 'blue-pond-70470746', neonBranch: 'br-solitary-shape-b7f1tpxs',
  host: 'ep-purple-hill-b7kz7n0g.c-13.us-east-1.aws.neon.tech', database: 'neondb',
  team: 'team_o9WQj6YpCF9JSk9wpVGfAmyb', project: 'prj_PqzZBpZubFnrl3nmW12SmtDX3MfM',
});
export function ensure(value, message) { if (!value) throw new Error(message); }
export function config(env) {
  const sha = env.REVIEWED_SHA;
  ensure(/^[a-f0-9]{40}$/.test(sha || ''), 'Full reviewed SHA required');
  ensure(['plan', 'status', 'apply', 'release'].includes(env.OPERATION), 'Unknown operation');
  ensure(env.GITHUB_REPOSITORY === target.repository && env.GITHUB_REF === 'refs/heads/main', 'Dispatch from repository main only');
  const writes = ['apply', 'release'].includes(env.OPERATION);
  if (writes) {
    ensure(env.STAGING_WRITES_ENABLED === 'true', 'Staging writes remain disabled');
    ensure(env.CONFIRMATION === `${env.OPERATION.toUpperCase()} ${sha}`, 'Exact operation/SHA confirmation required');
    ensure(/^[a-f0-9]{64}$/.test(env.PLAN_DIGEST || ''), 'Reviewed plan digest required');
    ensure(env.RECOVERY_REFERENCE && env.RECOVERY_REFERENCE.length <= 256 && !/[\r\n\0]/.test(env.RECOVERY_REFERENCE) && !env.RECOVERY_REFERENCE.startsWith('disposable-staging:'), 'Reviewed recovery evidence required; no inherited disposable waiver');
  }
  return { sha, operation: env.OPERATION, writes };
}
export function planDigest(sha, role, plan) {
  return createHash('sha256').update(JSON.stringify({ sha, target, role, recordedThrough: plan.recordedThrough, pending: plan.pending, baselineRequired: plan.baselineRequired === true })).digest('hex');
}
export async function request(url, token, body, fetcher = fetch) {
  const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  ensure(response.ok, `Remote request failed (${response.status}); inspect operator console`);
  return response.json();
}
export async function verifyCandidate(env, gh) {
  const c = config(env);
  ensure((await gh('/git/ref/heads/staging')).object?.sha === c.sha, 'Staging candidate superseded');
  const runs = await gh(`/actions/workflows/ci.yml/runs?event=push&branch=staging&head_sha=${c.sha}&per_page=100`);
  const latest = runs.workflow_runs?.filter(r => r.head_sha === c.sha && r.head_branch === 'staging' && r.event === 'push').sort((a,b) => b.id - a.id)[0];
  ensure(latest?.status === 'completed' && latest.conclusion === 'success', 'Latest exact staging SHA validation must pass');
  return c;
}
export function migration(env, execute = execFileSync) {
  const c = config(env), role = env.STAGING_MIGRATION_ROLE;
  ensure(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(role || ''), 'Reviewed staging migration role required');
  const uri = new URL(env.DATABASE_MIGRATION_URL || 'invalid:');
  ensure(['postgres:', 'postgresql:'].includes(uri.protocol) && uri.hostname === target.host && uri.pathname === `/${target.database}` && decodeURIComponent(uri.username) === role && (!uri.port || uri.port === '5432'), 'Pinned staging database target mismatch');
  const args = ['--target', 'preview', '--expected-host', target.host, '--expected-database', target.database, '--expected-user', role];
  const run = operation => JSON.parse(execute(process.execPath, ['--import', 'tsx', 'scripts/migrate-domain.ts', operation, ...args,
    ...(operation === 'apply' ? ['--backup-reference', env.RECOVERY_REFERENCE] : [])], { cwd: 'candidate/mcp', encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 }));
  if (c.operation === 'status') return run('status');
  const plan = run('plan');
  ensure(!plan.baselineRequired, 'Schema adoption requires a separately reviewed operation');
  const digest = planDigest(c.sha, role, plan);
  console.log(JSON.stringify({ sha: c.sha, planDigest: digest, plan }, null, 2));
  if (c.writes) {
    ensure(digest === env.PLAN_DIGEST, 'Plan changed; review a fresh plan before applying');
    run('apply');
    return run('status');
  }
  return { planDigest: digest };
}
export function deploymentConfig(env) {
  ensure(env.STAGING_DEPLOY_ENABLED === 'true', 'Staging deployment remains disabled');
  ensure(/^env_[a-zA-Z0-9]+$/.test(env.STAGING_ENVIRONMENT_ID || ''), 'Verified custom environment ID required');
  ensure(/^[a-z0-9][a-z0-9.-]+\.[a-z]+$/.test(env.STAGING_ALIAS || '') && env.STAGING_ALIAS !== 'generative-arcana.vercel.app', 'Verified non-production staging alias required');
  ensure(env.STAGING_MAPPING_REVIEW && env.STAGING_MANUAL_ALIAS_REVIEW, 'Platform mapping and manual alias review required');
}
export function verifyEnvironment(value, env) {
  ensure(value.id === env.STAGING_ENVIRONMENT_ID && value.slug === 'staging' && value.type === 'preview', 'Custom staging environment mismatch');
  // A custom-environment domain automatically tracks newest deployments, bypassing our readiness gate.
  ensure(Array.isArray(value.domains) && value.domains.length === 0, 'Custom environment must have no automatically assigned domains');
  ensure(!value.branchMatcher || (value.branchMatcher.type === 'equals' && value.branchMatcher.pattern === 'staging'), 'Unexpected staging branch matcher');
}
export function verifyDeployment(d, env, sha) {
  ensure((d.projectId || d.project?.id) === target.project && d.customEnvironment?.id === env.STAGING_ENVIRONMENT_ID && d.target !== 'production', 'Deployment target mismatch');
  ensure(d.gitSource?.sha === sha && d.gitSource?.type === 'github' && String(d.gitSource?.repoId) === String(target.repositoryId), 'Deployment source SHA/repository mismatch');
  ensure(/^dpl_[a-zA-Z0-9]+$/.test(d.id || '') && /^[a-zA-Z0-9-]+\.vercel\.app$/.test(d.url || ''), 'Invalid deployment identity');
}
export async function deploy(env, { gh, vc, ready, candidateConfig = JSON.parse(readFileSync('candidate/vercel.json', 'utf8')), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const c = await verifyCandidate(env, gh);
  ensure(c.operation === 'release', 'Release operation required');
  deploymentConfig(env);
  const environmentPath = `/v9/projects/${target.project}/custom-environments/${env.STAGING_ENVIRONMENT_ID}`;
  ensure(candidateConfig.git?.deploymentEnabled?.staging === false, 'Candidate must disable automatic staging Git deployments');
  const verifyPlatform = async () => {
    verifyEnvironment(await vc(environmentPath), env);
    let cursor, pages = 0;
    do {
      ensure(++pages <= 20, 'Domain inventory exceeded bounded verification');
      const domains = await vc(`/v9/projects/${target.project}/domains?limit=100${cursor ? `&until=${encodeURIComponent(cursor)}` : ''}`);
      ensure(Array.isArray(domains.domains), 'Project domain mapping unavailable');
      ensure(domains.domains.every(domain => domain.gitBranch !== 'staging' && domain.customEnvironmentId !== env.STAGING_ENVIRONMENT_ID && domain.name !== env.STAGING_ALIAS), 'Staging alias must be manually managed, not attached to automatic project domain assignment');
      cursor = domains.pagination?.next;
    } while (cursor);
  };
  await verifyPlatform();
  const created = await vc('/v13/deployments', { name: 'generative-arcana', project: target.project,
    customEnvironmentSlugOrId: env.STAGING_ENVIRONMENT_ID,
    gitSource: { type: 'github', repoId: target.repositoryId, ref: 'staging', sha: c.sha } });
  ensure(/^dpl_[a-zA-Z0-9]+$/.test(created.id || ''), 'Deployment creation uncertain; inspect console before retrying');
  console.log(`Staging candidate deployment: ${created.id}`);
  let d;
  for (let attempt = 0; attempt < 90; attempt++) {
    d = await vc(`/v13/deployments/${created.id}`);
    verifyDeployment(d, env, c.sha);
    if (d.readyState === 'READY') break;
    ensure(!['ERROR', 'CANCELED'].includes(d.readyState), 'Candidate deployment failed; alias unchanged');
    ensure(attempt < 89, 'Deployment deadline exceeded; inspect console before retrying');
    await sleep(10000);
  }
  await ready(`https://${d.url}`, c.sha);
  await verifyCandidate(env, gh);
  await verifyPlatform();
  await vc(`/v2/deployments/${d.id}/aliases`, { alias: env.STAGING_ALIAS });
  const alias = await vc(`/v4/aliases/${encodeURIComponent(env.STAGING_ALIAS)}`);
  ensure(alias.deploymentId === d.id, 'Alias verification failed; inspect console');
  await ready(`https://${env.STAGING_ALIAS}`, c.sha);
  console.log(`Verified staging ${c.sha} at https://${env.STAGING_ALIAS}`);
}
export async function main(env = process.env) {
  const gh = path => request(`https://api.github.com/repos/${target.repository}${path}`, env.GITHUB_TOKEN);
  const phase = process.argv[2];
  if (phase === 'guard') { await verifyCandidate(env, gh); return; }
  if (phase === 'migrate') { await verifyCandidate(env, gh); console.log(JSON.stringify(migration(env))); return; }
  ensure(phase === 'deploy', 'Unknown release phase');
  ensure(env.VERCEL_STAGING_TOKEN, 'Staging deployment credential required');
  const vc = (path, body) => request(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${target.team}`, env.VERCEL_STAGING_TOKEN, body);
  const ready = async (origin, sha) => {
    const response = await fetch(`${origin}/readyz`, { redirect: 'error', headers: env.STAGING_PROTECTION_BYPASS ? { 'x-vercel-protection-bypass': env.STAGING_PROTECTION_BYPASS } : {}, signal: AbortSignal.timeout(30000) });
    ensure(response.ok, 'Candidate readiness failed');
    const result = await response.json();
    ensure(result.build?.sha === sha, 'Readiness build identity mismatch');
    ensure(result.readiness?.productionAccounts === true, 'Account readiness not verified');
  };
  await deploy(env, { gh, vc, ready });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Staging release stopped. Inspect phase, safe plan output and provider console. No automatic write retry or rollback.'); process.exitCode = 1; });
}
