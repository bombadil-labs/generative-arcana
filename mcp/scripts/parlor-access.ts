import { readFile } from 'node:fs/promises';
import { target } from './domain-migrations';
import { connectMigration, type MigrationConnection } from './migration-connection';
import { applyEntitlement, inspectEntitlement, type EntitlementPlan } from '../src/parlorEntitlement';
const [command,...args]=process.argv.slice(2);
const flags:Record<string,string>={};
for(let i=0;i<args.length;i+=2){const key=args[i].slice(2);if(!args[i].startsWith('--')||!['plan','target','expected-host','expected-database','expected-user','expected-port','approval-reference'].includes(key)||flags[key]||!args[i+1])throw new Error('Invalid operator argument');flags[key]=args[i+1];}
if(!['plan','apply'].includes(command)||!flags.plan)throw new Error('Use plan or apply with --plan and explicit target flags');
if(command==='apply'&&!/^[A-Za-z0-9._:/-]{1,160}$/.test(flags['approval-reference']??''))throw new Error('Apply requires reviewed approval reference');
const connectionString=target(process.env,flags);
let db:MigrationConnection|undefined;
try {
  const plan=JSON.parse(await readFile(flags.plan,'utf8')) as EntitlementPlan;
  if(command==='apply'&&plan.evidenceReference!==flags['approval-reference'])throw new Error('Approval reference does not match plan');
  db=await connectMigration(connectionString);
  const identity=(await db.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  if(identity.db!==flags['expected-database']||identity.role!==flags['expected-user'])throw new Error('Connected target mismatch');
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='10s'");
  const result=command==='apply'?await applyEntitlement(db,plan):await inspectEntitlement(db,plan);
  await db.query('COMMIT');console.log(JSON.stringify({target:flags.target,...result}));
}catch {await db?.query('ROLLBACK').catch(()=>{});console.error('Parlor access operation stopped. Check verified identity, target, expiry and approval. After a connection interruption, run plan with the same operation ID before retrying; no secret or driver details are logged.');process.exitCode=1;}
finally {await db?.close();}
