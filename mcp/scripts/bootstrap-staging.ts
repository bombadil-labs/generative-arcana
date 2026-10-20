import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { bootstrap, bootstrapTarget, recoveryEvidence, stagingRoot } from './staging-bootstrap';
import { catalog, run, target } from './domain-migrations';
import { connectMigration, type MigrationConnection } from './migration-connection';

let connection:MigrationConnection|undefined;
try {
  const operation=process.argv[2];
  if(!['plan','apply','baseline'].includes(operation))throw Error('Unknown bootstrap operation');
  const flags:Record<string,string>={};
  const allowed=['target','expected-host','expected-database','expected-user','expected-port','reviewed-sha','plan-digest','recovery-file'];
  for(let i=3;i<process.argv.length;i+=2){const key=process.argv[i].slice(2),value=process.argv[i+1];if(!process.argv[i].startsWith('--')||!allowed.includes(key)||flags[key]||!value||value.startsWith('--'))throw Error('Invalid bootstrap arguments');flags[key]=value;}
  bootstrapTarget(flags);
  const sha=flags['reviewed-sha'];
  if(!/^[a-f0-9]{40}$/.test(sha||'')||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sha)throw Error('Reviewed code SHA mismatch');
  const writes=operation!=='plan';
  const recovery=writes?recoveryEvidence(JSON.parse(await readFile(flags['recovery-file'],'utf8'))):undefined;
  if(writes && process.env.STAGING_BOOTSTRAP_ENABLED!=='true')throw Error('Bootstrap writes disabled');
  const uri=target(process.env,flags);
  connection=await connectMigration(uri);
  const identity=(await connection.query('SELECT current_database() AS db,current_user AS role,session_user AS session_role')).rows[0];
  if(identity.db!==stagingRoot.database||identity.role!==stagingRoot.user||identity.session_role!==stagingRoot.user)throw Error('Connected bootstrap identity mismatch');
  const entries=await catalog();
  const result=operation==='baseline'?await run(connection,entries,'baseline',4):await bootstrap(connection,entries,{operation:operation as 'plan'|'apply',sha,planDigest:flags['plan-digest'],recovery});
  console.log(JSON.stringify({result,recovery},null,2));
} catch { console.error('Staging bootstrap stopped. Check reviewed target, code SHA, plan, source schema/owners and recovery evidence. Inspect plan/status after an uncertain result; no automatic retry.');process.exitCode=1; }
finally {try{await connection?.close();}catch{console.error('Bootstrap connection cleanup failed; inspect status before retrying.');process.exitCode=1;}}
