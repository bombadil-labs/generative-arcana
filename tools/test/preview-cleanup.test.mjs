import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonical, digest, validateGit, validateProviders, makePlan, validatePlan, validateEnvironment, validateApproval, executePlan, LOSS_NOTICE } from '../preview-cleanup/core.mjs';
import { api, cursorPages, closedPrReport } from '../preview-cleanup/run.mjs';
const storedPolicy = JSON.parse(await readFile(new URL('../preview-cleanup/policy.json',import.meta.url)));
const p = { ...storedPolicy, mappingVerified:true, destructiveEnabled:true, vercelTeamId:'team_test', vercelProjectId:'prj_test', neonRootBranchId:'br-main', approvalEnvironmentId:42, approverLogins:['reviewer'] };
const sha = 'a'.repeat(40), repo={full_name:p.repository,id:p.repositoryId};
const pr={number:90,state:'closed',merged:true,merged_at:'2026-10-01T15:00:00Z',head:{ref:'feat/done',sha,repo},base:{ref:'main',repo}};
const git=validateGit(pr,[],sha,p);
const root={project_id:p.neonProjectId,id:'br-main',name:'main',default:true,parent_id:null};
const child={project_id:p.neonProjectId,id:'br-preview',name:'preview/feat/done',default:false,protected:false,parent_id:'br-main',created_at:'2026-10-01T14:00:00Z'};
const d={createdAt:Date.parse('2026-10-01T20:00:00Z'),id:'dpl_test',url:'arcana-test.vercel.app',projectId:'prj_test',ownerId:'team_test',target:null,readyState:'READY',alias:[],currentAliases:[],automaticAliases:[],userAliases:[],gitSource:{type:'github',repoId:p.repositoryId,ref:git.branch,sha},meta:{githubCommitOrg:'bombadil-labs',githubCommitRepo:'generative-arcana',githubRepoId:String(p.repositoryId),githubCommitRef:git.branch,githubCommitSha:sha}};
const clone=x=>structuredClone(x);
const target=()=>validateProviders(git,[clone(d)],[root,child],p);
const env={id:42,name:p.approvalEnvironment,protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'User',reviewer:{login:'reviewer'}}]}],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}};
const branchPolicies=[{name:'main',type:'branch'}];
test('shipped policy cannot delete or plan provider cleanup',()=>{ assert.equal(storedPolicy.destructiveEnabled,false); assert.equal(storedPolicy.mappingVerified,false); assert.equal(storedPolicy.approvalEnvironmentId,null); assert.throws(()=>validateEnvironment(env,branchPolicies,storedPolicy)); assert.throws(()=>validateProviders(git,[d],[root,child],storedPolicy)); });
test('canonical digest is key-order independent',()=>assert.equal(digest({a:1,b:2}),digest({b:2,a:1})));
test('merged exact same-repository head is eligible; deleted Git head allowed',()=>assert.deepEqual(validateGit(pr,[],null,p),git));
for (const [name,change] of Object.entries({ reopened:q=>{q.state='open'}, unmerged:q=>{q.merged=false}, fork:q=>{q.head.repo={full_name:'stranger/fork',id:1}}, production:q=>{q.head.ref='main'}, acceptance:q=>{q.head.ref='feat/self-hosted-better-auth'}, longLived:q=>{q.head.ref='staging/test'}, otherBase:q=>{q.base.ref='staging'} })) test(`Git rejects ${name}`,()=>{const q=clone(pr);change(q);assert.throws(()=>validateGit(q,[],sha,p));});
test('Git rejects shared open head and open base and reused head',()=>{assert.throws(()=>validateGit(pr,[{head:pr.head}],sha,p));assert.throws(()=>validateGit(pr,[{base:{repo,ref:git.branch}}],sha,p));assert.throws(()=>validateGit(pr,[],'b'.repeat(40),p));});
test('exact provider mapping',()=>assert.equal(target().neonBranchId,'br-preview'));
for(const [name,change] of Object.entries({ production:x=>{x.target='production'}, omittedTarget:x=>{delete x.target}, custom:x=>{x.customEnvironment={id:'custom'}}, promoted:x=>{x.readySubstate='PROMOTED'}, building:x=>{x.readyState='BUILDING'}, project:x=>{x.projectId='prj_else'}, team:x=>{x.ownerId='team_else'}, noSource:x=>{delete x.gitSource}, repo:x=>{x.gitSource.repoId=1}, ref:x=>{x.meta.githubCommitRef='main'}, sha:x=>{x.gitSource.sha='b'.repeat(40)}, alias:x=>{x.currentAliases=['keep.example.com']}, missingAlias:x=>{delete x.currentAliases} })) test(`provider rejects ${name}`,()=>{const x=clone(d);change(x);assert.throws(()=>validateProviders(git,[x],[root,child],p));});
for(const [name,change] of Object.entries({ default:b=>{b.default=true}, protected:b=>{b.protected=true}, unknownProtection:b=>{delete b.protected}, wrongParent:b=>{b.parent_id='br-other'}, renamed:b=>{b.name='renamed'} })) test(`Neon rejects ${name}`,()=>{const b=clone(child);change(b);assert.throws(()=>validateProviders(git,[d],[root,b],p));});
test('children, missing mappings, duplicate mappings, held IDs fail closed',()=>{assert.throws(()=>validateProviders(git,[d],[root,child,{id:'br-descendant',parent_id:child.id}],p));assert.throws(()=>validateProviders(git,[d],[root],p));assert.throws(()=>validateProviders(git,[d],[root,child,clone(child)],p));assert.throws(()=>validateProviders(git,[d],[root,child],{...p,protectedDeploymentIds:[d.id]}));});
test('automatic aliases need explicit policy and provider evidence, never suffix guesses',()=>{const x={...d,alias:['auto.vercel.app'],currentAliases:['auto.vercel.app'],automaticAliases:['auto.vercel.app']};assert.throws(()=>validateProviders(git,[x],[root,child],p));assert.ok(validateProviders(git,[x],[root,child],{...p,allowVerifiedAutomaticAliases:true}));assert.throws(()=>validateProviders(git,[{...x,currentAliases:['custom.vercel.app']}],[root,child],{...p,allowVerifiedAutomaticAliases:true}));});
test('empty, duplicate and excessive targets fail',()=>{assert.throws(()=>makePlan([],p));assert.throws(()=>makePlan([target(),target()],p));assert.throws(()=>makePlan([target()],{...p,maxBranchesPerRun:0}));});
test('plan binds exact targets, policy, time and irreversible notice',()=>{const plan=makePlan([target()],p,100000);assert.doesNotThrow(()=>validatePlan(plan,digest(plan),p,100001));assert.throws(()=>validatePlan(plan,'0'.repeat(64),p,100001));assert.throws(()=>validatePlan(plan,digest(plan),{...p,destructiveEnabled:false},100001));assert.throws(()=>validatePlan(plan,digest(plan),p,100000+3600001));assert.throws(()=>validatePlan(plan,digest(plan),p,99999));});
test('named but unprotected/mismatched environments never suffice',()=>{assert.doesNotThrow(()=>validateEnvironment(env,branchPolicies,p));for(const e of [{...env,id:43},{...env,protection_rules:[]},{...env,protection_rules:[{...env.protection_rules[0],prevent_self_review:false}]}])assert.throws(()=>validateEnvironment(e,branchPolicies,p));assert.throws(()=>validateEnvironment(env,[{name:'*',type:'branch'}],p));assert.throws(()=>validateEnvironment(env,[{name:'main',type:'tag'}],p));});
test('approval requires exact digest, loss statement and independent configured reviewer',()=>{const hash='a'.repeat(64),r={state:'approved',comment:`${LOSS_NOTICE} ${hash}`,user:{login:'reviewer'},environments:[{id:42}]};assert.doesNotThrow(()=>validateApproval([r],p,hash,'operator'));for(const modified of [{...r,comment:'Ship it'},{...r,user:{login:'unknown'}},{...r,environments:[{id:1}]}])assert.throws(()=>validateApproval([modified],p,hash,'operator'));assert.throws(()=>validateApproval([r],p,hash,'reviewer'));assert.throws(()=>validateApproval([],p,hash,'operator'));});
test('dry-run core has no writes',()=>{const plan=makePlan([target()],p);assert.equal(plan.targets.length,1);});
test('execution revalidates before every deletion and stops on reopen/drift',async()=>{const t=target();t.deployments.push({...t.deployments[0],id:'dpl_two'});const plan=makePlan([t],p);let deleted=[],reads=0;await assert.rejects(()=>executePlan(plan,digest(plan),p,{now:Date.now,approval:async()=>{},target:async()=>{if(++reads>1)throw Error('reopened');return t},remove:async id=>{deleted.push(id);return{uid:id,state:'DELETED'}},record:async()=>{}}),/reopened/);assert.deepEqual(deleted,['dpl_test']);});
test('uncertain deletion is never retried',async()=>{const plan=makePlan([target()],p);let writes=0;await assert.rejects(()=>executePlan(plan,digest(plan),p,{now:Date.now,approval:async()=>{},target:async()=>target(),remove:async()=>{writes++;return{}},record:async()=>{}}),/uncertain/);assert.equal(writes,1);});
test('successful batch subtracts only approved deleted IDs',async()=>{const t=target();t.deployments.push({...t.deployments[0],id:'dpl_two'});const plan=makePlan([t],p),removed=[];const result=await executePlan(plan,digest(plan),p,{now:Date.now,approval:async()=>{},target:async()=>({...t,deployments:t.deployments.filter(x=>!removed.includes(x.id))}),remove:async id=>{removed.push(id);return{uid:id,state:'DELETED'}},record:async()=>{}});assert.deepEqual(result,['dpl_test','dpl_two']);});
test('pagination completes, rejects repeats/truncation/malformed shapes',async()=>{assert.deepEqual(await cursorPages(async c=>c?{things:[2],pagination:{next:null}}:{things:[1],pagination:{next:1}},'things'),[1,2]);await assert.rejects(()=>cursorPages(async()=>({things:[],pagination:{next:1}}),'things'),/repeated/);await assert.rejects(()=>cursorPages(async()=>({things:[]}),'things'),/Incomplete/);});
test('HTTP credentials never follow redirects or enter logs; failures are sanitized',async()=>{let options;await assert.rejects(()=>api('https://api.vercel.com','/x','TOPSECRET','GET',async(u,o)=>{options=o;return{status:403,ok:false,text:async()=>'TOPSECRET'}}),e=>!e.message.includes('TOPSECRET')&&e.message.includes('403'));assert.equal(options.redirect,'error');await assert.rejects(()=>api('https://evil.example','/x','TOPSECRET','GET',()=>{throw Error('must not run')}),/Unsupported/);});
test('workflow source guards: automatic merge path has no provider secrets or destructive mode',async()=>{const automatic=await readFile(new URL('../../.github/workflows/preview-cleanup.yml',import.meta.url),'utf8');const manual=await readFile(new URL('../../.github/workflows/preview-cleanup-approved.yml',import.meta.url),'utf8');assert.ok(!automatic.includes('pull_request_target'));assert.ok(!manual.includes('pull_request_target'));assert.ok(!automatic.split('  closed-pr-report:')[0].includes('secrets.'));assert.ok(!automatic.includes('run.mjs apply'));assert.ok(manual.includes('needs: validate-existing-gate'));assert.ok(manual.includes('ref: ${{ github.sha }}'));assert.ok(!manual.includes('schedule:'));});
test('malformed provider JSON and fetch errors never leak response bodies or tokens',async()=>{
  await assert.rejects(()=>api('https://api.vercel.com','/x','TOPSECRET','GET',async()=>({status:200,ok:true,json:async()=>{throw new SyntaxError('Unexpected token: DATABASE_PASSWORD=PRIVATE_BODY')}})),e=>e.message==='https://api.vercel.com GET returned invalid JSON with HTTP 200');
  await assert.rejects(()=>api('https://api.vercel.com','/x','TOPSECRET','GET',async()=>{throw new Error('Authorization Bearer TOPSECRET')}),e=>e.message==='https://api.vercel.com GET request failed before a response; no automatic retry');
});
test('multi-branch deletion does not re-resolve an already removed database',async()=>{
  const a=target(),b={...target(),pr:91,branch:'feat/other',neonBranchId:'br-other',neonBranchName:'preview/feat/other',deployments:[{...target().deployments[0],id:'dpl_other'}]};
  const plan=makePlan([a,b],p),removed=[];
  const result=await executePlan(plan,digest(plan),p,{now:Date.now,approval:async()=>{},target:async number=>{const t=number===90?a:b;assert.ok(!t.deployments.every(d=>removed.includes(d.id)));return{...t,deployments:t.deployments.filter(d=>!removed.includes(d.id))}},remove:async id=>{removed.push(id);return{uid:id,state:'DELETED'}},record:async()=>{}});
  assert.deepEqual(result,['dpl_test','dpl_other']);
});
test('unapproved digest or failed approval performs zero writes',async()=>{
  const plan=makePlan([target()],p);let writes=0;
  const io={now:Date.now,approval:async()=>{throw Error('No live approval')},target:async()=>target(),remove:async()=>{writes++},record:async()=>{}};
  await assert.rejects(()=>executePlan(plan,'0'.repeat(64),p,io),/digest/);
  await assert.rejects(()=>executePlan(plan,digest(plan),p,io),/approval/);
  assert.equal(writes,0);
});

test('cleanup scope targets only new preview project and preserves both roots plus legacy branch IDs',()=>{
  assert.equal(storedPolicy.neonProjectId,'blue-pond-70470746');
  assert.equal(storedPolicy.neonRootBranchId,'br-solitary-shape-b7f1tpxs');
  assert.ok(storedPolicy.excludedNeonProjectIds.includes('dark-poetry-32860113'));
  for(const id of ['br-steep-heart-b7gdc818','br-solitary-shape-b7f1tpxs','br-tiny-morning-b70u6bee','br-tiny-hat-b79pt0pk','br-lively-moon-b7jebfqy','br-solitary-rain-b7j5kk6n','br-calm-paper-b733ntfe','br-calm-morning-b7siedwr','br-little-hat-b7349zo3','br-morning-bonus-b7f948g7','br-young-mode-b7f7jzif']) assert.ok(storedPolicy.protectedNeonBranchIds.includes(id));
  assert.equal(target().neonProjectId,p.neonProjectId);
  assert.throws(()=>makePlan([target()],{...p,neonProjectId:'dark-poetry-32860113'}),/excluded/);
});
test('root and child both require explicit project ownership',()=>{
  for(const which of ['root','child']) for(const project_id of [undefined,'dark-poetry-32860113','unrelated']) {
    const r=clone(root),b=clone(child);(which==='root'?r:b).project_id=project_id;
    assert.throws(()=>validateProviders(git,[d],[r,b],p));
  }
});
test('known legacy refs and current acceptance are held even if new-project branches share their names',()=>{
  const refs=['feat/self-hosted-better-auth','chore/preview-isolation-test',...storedPolicy.protectedBranches.filter(x=>x.startsWith('dependabot/'))];
  assert.equal(refs.length,10);
  for(const ref of refs){const q=clone(pr);q.head.ref=ref;assert.throws(()=>validateGit(q,[],sha,p),/Protected/);}
});
test('deployments before conservative cutover or missing malformed timestamps cannot enter plans',()=>{
  const cutoff=Date.parse(p.previewDeploymentNotBefore);
  for(const createdAt of [undefined,null,cutoff-1,String(cutoff),NaN]) assert.throws(()=>validateProviders(git,[{...d,createdAt}],[root,child],p),/cutover/);
  assert.equal(validateProviders(git,[{...d,createdAt:cutoff}],[root,child],p).deployments[0].createdAt,cutoff);
  assert.throws(()=>makePlan([target()],{...p,previewDeploymentNotBefore:null}),/cutoff/);
});
test('automatic reports hold legacy refs before any provider access',async()=>{
  let providers=0;
  const q=clone(pr);q.head.ref='feat/self-hosted-better-auth';
  const r=await closedPrReport(q.number,p,{git:async()=>validateGit(q,[],sha,p),target:async()=>{providers++;return target();}},{});
  assert.equal(providers,0);assert.equal(r.plan,undefined);assert.match(r.held[0].reason,/Protected/);assert.equal(r.providerCleanup,'NOT EXECUTED');
});
test('automatic reports remain read-only and explicit when mapping or secrets are missing',async()=>{
  let providers=0;
  const c={git:async()=>git,target:async()=>{providers++;return target();},remove:()=>assert.fail('report must not delete')};
  const unmapped=await closedPrReport(pr.number,storedPolicy,c,{VERCEL_READ_TOKEN:'test',NEON_READ_TOKEN:'test'});
  assert.match(unmapped.held[0].reason,/mapping/);assert.equal(unmapped.plan,undefined);
  const noSecrets=await closedPrReport(pr.number,p,c,{});
  assert.match(noSecrets.held[0].reason,/credentials/);assert.equal(noSecrets.plan,undefined);assert.equal(providers,0);
  const ready=await closedPrReport(pr.number,p,c,{VERCEL_READ_TOKEN:'test',NEON_READ_TOKEN:'test'});
  assert.equal(providers,1);assert.equal(ready.digest,digest(ready.plan));assert.equal(ready.plan.neonProjectId,p.neonProjectId);assert.equal(ready.providerCleanup,'NOT EXECUTED');
});
test('automatic provider workflow is opt-in trusted same-repo non-bot read-only, while deletion remains manual',async()=>{
  const y=await readFile(new URL('../../.github/workflows/preview-cleanup.yml',import.meta.url),'utf8');
  const job=y.split('  closed-pr-report:')[1].split('  provider-plan:')[0];
  for(const s of ["vars.PREVIEW_PROVIDER_REPORTS_ENABLED == 'true'","github.event.pull_request.head.repo.full_name == github.repository","github.actor != 'dependabot[bot]'","github.event.pull_request.user.login != 'dependabot[bot]'","ref: ${{ github.event.repository.default_branch }}",'run.mjs report']) assert.ok(job.includes(s),s);
  assert.ok(!/DELETE_TOKEN|run\.mjs (?:gate|apply)/.test(job));assert.ok(!/DELETE_TOKEN|run\.mjs (?:gate|apply)/.test(y));
});

test('plan cannot bind an old or missing target project even with an otherwise valid target',()=>{
  for(const neonProjectId of [undefined,'dark-poetry-32860113','unrelated']) assert.throws(()=>makePlan([{...target(),neonProjectId}],p),/target Neon project/);
});
