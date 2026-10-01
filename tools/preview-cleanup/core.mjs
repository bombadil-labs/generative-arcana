import { createHash } from 'node:crypto';
export const LOSS_NOTICE = 'PERMANENTLY DELETE PREVIEW DATA';
export function ensure(ok, message) { if (!ok) throw new Error(message); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function protectedBranch(branch, policy) {
  return !branch || branch === policy.defaultBranch || policy.protectedBranches.includes(branch) || policy.protectedPrefixes.some(p => branch.startsWith(p));
}
export function validateGit(pr, openPrs, currentHead, policy) {
  ensure(pr.state === 'closed' && pr.merged_at && pr.merged === true, 'PR must be merged, not merely closed');
  ensure(pr.base?.repo?.full_name === policy.repository && pr.head?.repo?.full_name === policy.repository && pr.head.repo.id === policy.repositoryId, 'Unknown/fork PR ownership');
  ensure(pr.base.ref === policy.defaultBranch, 'Only merges into default branch are eligible');
  const branch = pr.head.ref;
  ensure(!protectedBranch(branch, policy), 'Protected or acceptance branch');
  ensure(!openPrs.some(p => p.head?.repo?.full_name === policy.repository && p.head.ref === branch || p.base?.repo?.full_name === policy.repository && p.base.ref === branch), 'Branch is used by an open PR');
  ensure(currentHead === null || currentHead === pr.head.sha, 'Git branch advanced or was reused after merge');
  ensure(/^[0-9a-f]{40}$/.test(pr.head.sha), 'Invalid head SHA');
  return { pr: pr.number, branch, headSha: pr.head.sha };
}
export function validateProviders(git, deployments, neonBranches, policy) {
  ensure(policy.mappingVerified === true && /^prj_/.test(policy.vercelProjectId || '') && /^team_/.test(policy.vercelTeamId || '') && /^br-/.test(policy.neonRootBranchId || ''), 'Provider mapping has not been verified/configured');
  const root = neonBranches.find(b => b.id === policy.neonRootBranchId);
  ensure(root && root.default === true && !root.parent_id && root.name === policy.defaultBranch, 'Configured Neon root/default mismatch');
  const matching = neonBranches.filter(b => b.name === `preview/${git.branch}`);
  ensure(matching.length === 1, 'Missing or ambiguous Neon preview mapping');
  const b = matching[0];
  ensure(b.id !== root.id && b.parent_id === root.id && b.default === false && b.protected === false && !policy.protectedNeonBranchIds.includes(b.id), 'Protected/unknown Neon branch or parent');
  ensure(!neonBranches.some(child => child.parent_id === b.id), 'Neon preview has children');
  ensure(typeof b.created_at === 'string', 'Missing Neon branch identity timestamp');
  ensure(deployments.length > 0, 'No Vercel deployments: reconcile orphan manually');
  const ids = new Set();
  const clean = deployments.map(d => {
    ensure(/^dpl_/.test(d.id || '') && !ids.has(d.id), 'Invalid/duplicate deployment ID'); ids.add(d.id);
    ensure(d.projectId === policy.vercelProjectId && d.ownerId === policy.vercelTeamId, 'Unknown Vercel project/team ownership');
    ensure(d.target === null && !d.customEnvironment && !['PROMOTED', 'ROLLING'].includes(d.readySubstate), 'Production/custom/promoted deployment');
    ensure(['READY', 'ERROR', 'CANCELED'].includes(d.readyState), 'Deployment is not terminal');
    ensure(!policy.protectedDeploymentIds.includes(d.id), 'Protected acceptance deployment');
    const m = d.meta || {}, source = d.gitSource || {};
    ensure(source.type === 'github' && String(source.repoId) === String(policy.repositoryId), 'Missing verified GitHub deployment source');
    ensure(m.githubCommitOrg + '/' + m.githubCommitRepo === policy.repository && String(m.githubRepoId) === String(policy.repositoryId) && m.githubCommitRef === git.branch, 'Deployment Git metadata mismatch');
    ensure(/^[0-9a-f]{40}$/.test(m.githubCommitSha || ''), 'Missing deployment commit');
    ensure(!source.ref || source.ref === git.branch, 'Conflicting deployment ref');
    ensure(!source.sha || source.sha === m.githubCommitSha, 'Conflicting deployment SHA');
    ensure(typeof d.url === 'string' && /^[a-z0-9.-]+\.vercel\.app$/.test(d.url), 'Unexpected deployment URL');
    ensure(Array.isArray(d.currentAliases) && Array.isArray(d.alias), 'Alias inventory incomplete');
    const aliases = [...new Set([...d.alias, ...d.currentAliases])].sort();
    if (aliases.length) {
      ensure(policy.allowVerifiedAutomaticAliases === true && Array.isArray(d.automaticAliases) && Array.isArray(d.userAliases) && d.userAliases.length === 0, 'Aliased deployment is protected');
      ensure(aliases.every(a => typeof a === 'string' && a.endsWith('.vercel.app') && d.automaticAliases.includes(a)), 'Custom/unknown alias is protected');
    }
    return { id: d.id, url: d.url, sha: m.githubCommitSha, aliases };
  }).sort((a,b) => a.id.localeCompare(b.id));
  return { ...git, neonBranchId: b.id, neonBranchName: b.name, neonParentId: b.parent_id, neonCreatedAt: b.created_at, deployments: clean };
}
export function makePlan(targets, policy, now = Date.now()) {
  ensure(targets.length > 0 && targets.length <= policy.maxBranchesPerRun, 'Invalid branch count');
  ensure(new Set(targets.map(t => t.branch)).size === targets.length, 'Shared/duplicate target branch');
  const ids = targets.flatMap(t => t.deployments.map(d => d.id));
  ensure(ids.length <= policy.maxDeploymentsPerRun && new Set(ids).size === ids.length, 'Invalid deployment count');
  return { version: 1, repository: policy.repository, policyDigest: digest(policy), createdAt: new Date(now).toISOString(), lossNotice: LOSS_NOTICE, vercelProjectId: policy.vercelProjectId, vercelTeamId: policy.vercelTeamId, neonProjectId: policy.neonProjectId, targets: [...targets].sort((a,b) => a.pr-b.pr) };
}
export function validatePlan(plan, suppliedDigest, policy, now = Date.now()) {
  ensure(plan && plan.version === 1 && plan.repository === policy.repository && plan.lossNotice === LOSS_NOTICE, 'Invalid plan');
  ensure(/^[0-9a-f]{64}$/.test(suppliedDigest || '') && digest(plan) === suppliedDigest, 'Exact-target digest mismatch');
  ensure(plan.policyDigest === digest(policy), 'Policy changed; create a new plan');
  const age = now-Date.parse(plan.createdAt);
  ensure(Number.isFinite(age) && age >= 0 && age <= policy.planLifetimeMinutes*60000, 'Plan expired or has a future timestamp');
  ensure(canonical(makePlan(plan.targets, policy, Date.parse(plan.createdAt))) === canonical(plan), 'Plan schema/scope mismatch');
}
export function validateEnvironment(environment, branches, policy) {
  ensure(policy.destructiveEnabled === true && Number.isInteger(policy.approvalEnvironmentId) && policy.approverLogins.length > 0, 'Destructive cleanup remains disabled or approval setup is incomplete');
  ensure(environment.id === policy.approvalEnvironmentId && environment.name === policy.approvalEnvironment, 'Approval environment identity mismatch');
  const rule = environment.protection_rules?.find(r => r.type === 'required_reviewers');
  ensure(rule && rule.prevent_self_review === true && rule.reviewers?.length > 0, 'Existing environment must require independent review');
  ensure(rule.reviewers.every(r => r.type === 'User' && policy.approverLogins.includes(r.reviewer?.login)), 'Unexpected reviewer or team membership cannot be verified');
  ensure(environment.deployment_branch_policy?.custom_branch_policies === true && environment.deployment_branch_policy.protected_branches === false, 'Environment requires exact default-branch policy');
  ensure(branches.length === 1 && branches[0].name === policy.defaultBranch && branches[0].type === 'branch', 'Environment must allow only the default Git branch');
}
export function validateApproval(reviews, policy, hash, actor) {
  const relevant = reviews.filter(r => r.environments?.some(e => e.id === policy.approvalEnvironmentId));
  const matching = relevant.filter(r => r.state === 'approved' && r.comment === `${LOSS_NOTICE} ${hash}` && policy.approverLogins.includes(r.user?.login) && r.user.login !== actor);
  ensure(matching.length > 0 && !relevant.some(r => r.state === 'rejected'), 'Missing exact-digest independent approval for irreversible database loss');
}
export async function executePlan(plan, hash, policy, io) {
  validatePlan(plan, hash, policy, io.now());
  await io.approval(hash);
  let deleted = [];
  for (const target of plan.targets) {
    for (const deployment of target.deployments) {
      // Re-read ALL targets before every deletion. The APIs offer no cross-provider
      // transaction; retain a manual-only mode and stop immediately on any drift.
      await io.approval(hash);
      for (const original of plan.targets) {
        if (original.deployments.every(d => deleted.includes(d.id))) continue;
        const live = await io.target(original.pr);
        const expected = { ...original, deployments: original.deployments.filter(d => !deleted.includes(d.id)) };
        ensure(canonical(live) === canonical(expected), 'Live inventory changed; stop and generate a new plan');
      }
      validatePlan(plan, hash, policy, io.now());
      const result = await io.remove(deployment.id);
      ensure(result.uid === deployment.id && result.state === 'DELETED', 'Deletion outcome uncertain; do not retry automatically');
      deleted.push(deployment.id);
      await io.record({ deletedDeploymentId: deployment.id, approvedDigest: hash });
    }
  }
  return deleted;
}
