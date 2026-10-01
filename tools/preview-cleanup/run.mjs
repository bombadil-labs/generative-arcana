#!/usr/bin/env node
// No third-party runtime dependencies, no untrusted checkout, no response-body logging.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ensure, digest, canonical, validateGit, validateProviders, makePlan, validatePlan, validateEnvironment, validateApproval, executePlan, LOSS_NOTICE } from './core.mjs';
export async function api(origin, path, token, method = 'GET', fetcher = fetch) {
  ensure(token, 'Missing required API token (never paste tokens into dispatch inputs)');
  ensure(['https://api.github.com', 'https://api.vercel.com', 'https://console.neon.tech'].includes(origin), 'Unsupported API origin');
  ensure(path.startsWith('/') && !path.startsWith('//'), 'Invalid API path');
  let response;
  try {
    response = await fetcher(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(origin === 'https://api.github.com' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) } });
  } catch { throw new Error(`${origin} ${method} request failed before a response; no automatic retry`); }
  if (response.status === 404) return null;
  ensure(response.ok, `${origin} ${method} failed with HTTP ${response.status}; no automatic retry`);
  if (response.status === 204) return {};
  try { return await response.json(); }
  catch { throw new Error(`${origin} ${method} returned invalid JSON with HTTP ${response.status}`); }
}
export async function cursorPages(getPage, key, maxPages = 50) {
  const all = [], seen = new Set(); let cursor;
  for (let page = 0; page < maxPages; page++) {
    const r = await getPage(cursor);
    ensure(r && Array.isArray(r[key]) && r.pagination && Object.hasOwn(r.pagination, 'next'), 'Incomplete provider pagination');
    all.push(...r[key]);
    const next = r.pagination.next;
    if (next === null) return all;
    ensure((typeof next === 'string' || typeof next === 'number') && !seen.has(String(next)), 'Invalid or repeated pagination cursor');
    seen.add(String(next)); cursor = next;
  }
  throw new Error('Provider page limit exceeded; inventory incomplete');
}
export function client(policy, env = process.env) {
  const gh = path => api('https://api.github.com', `/repos/${policy.repository}${path}`, env.GITHUB_TOKEN);
  const vc = (path, method = 'GET') => api('https://api.vercel.com', `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(policy.vercelTeamId)}`, method === 'DELETE' ? env.VERCEL_DELETE_TOKEN : env.VERCEL_READ_TOKEN, method);
  const neon = path => api('https://console.neon.tech', `/api/v2/projects/${encodeURIComponent(policy.neonProjectId)}${path}`, env.NEON_READ_TOKEN);
  const prs = async state => {
    const all = [];
    for (let page=1; page<=50; page++) {
      const r = await gh(`/pulls?state=${state}&per_page=100&page=${page}`);
      ensure(Array.isArray(r), 'Incomplete GitHub PR inventory'); all.push(...r);
      if (r.length < 100) return all;
    }
    throw new Error('GitHub page limit exceeded');
  };
  const repository = async () => {
    const r = await gh('');
    ensure(r?.full_name === policy.repository && r.id === policy.repositoryId && r.default_branch === policy.defaultBranch, 'Repository/default branch changed'); return r;
  };
  const git = async number => {
    await repository();
    const pr = await gh(`/pulls/${number}`);
    ensure(pr?.number === number, 'PR identity mismatch');
    const head = await gh(`/git/ref/heads/${encodeURIComponent(pr.head.ref)}`);
    ensure(head === null || /^[0-9a-f]{40}$/.test(head.object?.sha || ''), 'Malformed Git ref inventory');
    return validateGit(pr, await prs('open'), head === null ? null : head.object.sha, policy);
  };
  const target = async number => {
    const g = await git(number);
    const list = await cursorPages(cursor => vc(`/v7/deployments?projectId=${encodeURIComponent(policy.vercelProjectId)}&branch=${encodeURIComponent(g.branch)}&limit=100${cursor === undefined ? '' : `&until=${encodeURIComponent(cursor)}`}`), 'deployments');
    ensure(list.length <= policy.maxDeploymentsPerRun, 'Too many deployments; reduce scope');
    const deployments = [];
    for (const item of list) {
      ensure(item.projectId === policy.vercelProjectId && /^dpl_/.test(item.uid || ''), 'Invalid deployment-list ownership');
      const d = await vc(`/v13/deployments/${encodeURIComponent(item.uid)}?withGitRepoInfo=true`);
      ensure(d?.id === item.uid, 'Deployment disappeared or identity changed');
      const aliases = await vc(`/v2/deployments/${encodeURIComponent(d.id)}/aliases`);
      ensure(Array.isArray(aliases?.aliases), 'Missing live alias inventory');
      d.currentAliases = aliases.aliases.map(a => { ensure(typeof a.alias === 'string', 'Unknown alias'); return a.alias; });
      // A branch may contain previous deploys, but never a commit outside the merged history.
      const sha = d.meta?.githubCommitSha;
      ensure(/^[0-9a-f]{40}$/.test(sha || ''), 'Missing deployment commit');
      const comparison = await gh(`/compare/${sha}...${g.headSha}`);
      ensure(['ahead','identical'].includes(comparison?.status), 'Deployment commit is not an ancestor of the merged head');
      deployments.push(d);
    }
    const branches = await cursorPages(cursor => neon(`/branches?limit=100${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`), 'branches');
    return validateProviders(g, deployments, branches, policy);
  };
  const environment = async () => {
    const path = `/environments/${encodeURIComponent(policy.approvalEnvironment)}`;
    const e = await gh(path), b = await gh(`${path}/deployment-branch-policies?per_page=100`);
    ensure(e && b && Array.isArray(b.branch_policies) && b.total_count === b.branch_policies.length, 'Approval environment missing or policy inventory incomplete');
    validateEnvironment(e, b.branch_policies, policy);
  };
  return { gh, vc, neon, prs, repository, git, target, environment };
}
async function summary(report) {
  await writeFile('preview-cleanup-report.json', JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Preview cleanup: ${report.mode}\n\n${LOSS_NOTICE}: removing the last Vercel preview can permanently delete its Neon database. Code merges do not merge preview data into production.\n\n\`\`\`json\n${JSON.stringify(report,null,2)}\n\`\`\`\n`);
}
function jsonInput(value, name) {
  try { return JSON.parse(value); } catch { throw new Error(`Invalid JSON in ${name}`); }
}
// This path can only read providers and emit a manifest or held reason. It never
// enters the gate/apply path, even when a plan could be generated automatically.
export async function closedPrReport(number, policy, c, env = process.env) {
  const report = { mode: 'automatic read-only preview manifest', providerCleanup: 'NOT EXECUTED', held: [] };
  try {
    const git = await c.git(number); // verifies merge, same repo, exact head and holds first
    report.candidate = git;
    ensure(policy.mappingVerified === true, 'Provider mapping still requires review');
    ensure(env.VERCEL_READ_TOKEN && env.NEON_READ_TOKEN, 'Read-only provider credentials unavailable; use a manual dry-run after secure setup');
    const plan = makePlan([await c.target(number)], policy);
    return { ...report, plan, digest: digest(plan), requiredApprovalComment: `${LOSS_NOTICE} ${digest(plan)}` };
  } catch (error) {
    report.held.push({ pr: number, reason: error.message });
    return report;
  }
}
export async function main(mode, env = process.env) {
  const policy = JSON.parse(await readFile(new URL('./policy.json', import.meta.url), 'utf8'));
  ensure(['audit','report','plan','gate','apply'].includes(mode), 'Use audit, report, plan, gate or apply');
  ensure(env.GITHUB_REPOSITORY === policy.repository, 'Run only in the configured repository');
  const c = client(policy, env);
  await c.repository();
  if (mode === 'audit') {
    // Automatic merge audit deliberately receives no Vercel/Neon secrets, including
    // on Dependabot events. A Git candidate is never presented as a database target.
    const report = { mode:'dry-run Git-only audit', providerCleanup:'NOT CONFIGURED / NOT EXECUTED', candidates:[], held:[] };
    for (const p of await c.prs('closed')) {
      if (!p.merged_at) { report.held.push({ pr:p.number, reason:'Closed without merge: outside deletion scope' }); continue; }
      try { report.candidates.push(await c.git(p.number)); }
      catch (e) { report.held.push({ pr:p.number, reason:e.message }); }
    }
    return summary(report);
  }
  if (mode === 'report') {
    ensure(env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_BASE_REF === policy.defaultBranch, 'Automatic provider reports require a PR close targeting the default branch');
    ensure(/^[1-9][0-9]*$/.test(env.CLOSED_PR_NUMBER || ''), 'Missing exact closed PR number');
    const number = Number(env.CLOSED_PR_NUMBER);
    ensure(Number.isSafeInteger(number), 'Invalid closed PR number');
    return summary(await closedPrReport(number, policy, c, env));
  }
  ensure(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === `refs/heads/${policy.defaultBranch}`, 'Manual stages must run from default branch');
  const manifest = env.TARGET_MANIFEST ? jsonInput(env.TARGET_MANIFEST, 'target manifest') : null;
  const hash = env.TARGET_DIGEST;
  if (mode === 'gate' || mode === 'apply') {
    validatePlan(manifest, hash, policy);
    ensure(env.GITHUB_RUN_ATTEMPT === '1', 'Do not rerun destructive workflow: dispatch a fresh plan/run');
    await c.environment();
    ensure(env.LOSS_CONFIRMATION === `${LOSS_NOTICE} ${hash}`, 'Exact data-loss acknowledgement missing');
    if (mode === 'gate') return summary({ mode:'approval gate validated', digest:hash, plan:manifest, requiredApprovalComment:`${LOSS_NOTICE} ${hash}` });
  }
  const missing = ['VERCEL_READ_TOKEN','NEON_READ_TOKEN'].filter(k => !env[k]);
  ensure(policy.mappingVerified === true && policy.vercelProjectId && policy.vercelTeamId && policy.neonRootBranchId, 'Provider mapping is not configured; see docs/preview-cleanup.md');
  ensure(missing.length === 0, `Missing secure setup: ${missing.join(', ')}`);
  if (mode === 'plan') {
    const numbers = jsonInput(env.PR_NUMBERS || '[]', 'PR numbers');
    ensure(Array.isArray(numbers) && numbers.length > 0 && numbers.length <= policy.maxBranchesPerRun && numbers.every(n => Number.isInteger(n) && n > 0) && new Set(numbers).size === numbers.length, 'Supply 1–3 distinct PR numbers as a JSON array');
    const plan = makePlan(await Promise.all(numbers.map(n => c.target(n))), policy);
    return summary({ mode:'provider dry-run; nothing deleted', digest:digest(plan), plan, requiredApprovalComment:`${LOSS_NOTICE} ${digest(plan)}` });
  }
  ensure(env.VERCEL_DELETE_TOKEN, 'Missing environment-only VERCEL_DELETE_TOKEN');
  const approval = async () => {
    await c.environment();
    const run = await c.gh(`/actions/runs/${env.GITHUB_RUN_ID}`);
    ensure(run?.event === 'workflow_dispatch' && run.head_branch === policy.defaultBranch && run.head_sha === env.GITHUB_SHA && run.run_attempt === 1, 'Untrusted or retried workflow run');
    const reviews = await c.gh(`/actions/runs/${env.GITHUB_RUN_ID}/approvals`);
    ensure(Array.isArray(reviews), 'Approval history unavailable');
    validateApproval(reviews, policy, hash, run.actor?.login);
  };
  const deleted = await executePlan(manifest, hash, policy, { now:Date.now, approval, target:c.target, remove:id => c.vc(`/v13/deployments/${encodeURIComponent(id)}`, 'DELETE'), record:row => appendFile('preview-cleanup-deletion-journal.jsonl', JSON.stringify(row)+'\n') });
  // Do not equate a successful deployment deletion with confirmed Neon cleanup.
  const verification = [];
  for (const t of manifest.targets) {
    const b = await c.neon(`/branches/${encodeURIComponent(t.neonBranchId)}`);
    verification.push({ neonBranchId:t.neonBranchId, status:b === null ? 'verified absent' : 'still present; investigate, never retry deletion blindly' });
  }
  await summary({ mode:'manual approved deletion', digest:hash, deleted, verification });
  ensure(verification.every(v => v.status === 'verified absent'), 'Native Neon cleanup not yet verified; read-only follow-up required');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]).catch(error => { console.error(`Cleanup stopped: ${error.message}`); process.exitCode=1; });
