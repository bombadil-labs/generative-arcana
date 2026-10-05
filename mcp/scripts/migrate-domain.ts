import { Pool } from 'pg';
import { catalog, run, target, MigrationSafetyError } from './domain-migrations';

const [command = 'plan', ...args] = process.argv.slice(2);
if (!['plan','status','apply','baseline'].includes(command)) throw new Error('Expected plan, status, apply or baseline');
const flags: Record<string,string> = {};
const allowed = ['target','expected-host','expected-database','expected-user','expected-port','through','backup-reference'];
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].slice(2);
  if (!args[i].startsWith('--') || !allowed.includes(key) || flags[key] || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Invalid, duplicate or retired migration option');
  flags[key] = args[i+1];
}
const connectionString = target(process.env, flags);
if (['apply','baseline'].includes(command) && !flags['backup-reference']) throw new Error('Reviewed --backup-reference required for writes');
if (flags.through && (command !== 'baseline' || !/^[1-9][0-9]*$/.test(flags.through))) throw new Error('--through is only valid for baseline');
if (command === 'baseline' && !flags.through) throw new Error('Baseline requires explicit --through');
if (flags['backup-reference'] && (flags['backup-reference'].length > 256 || /[\r\n\0]/.test(flags['backup-reference']))) throw new Error('Use a short backup reference, never backup content');
const entries = await catalog();
const pool = new Pool({connectionString, max:1, connectionTimeoutMillis:10_000});
try {
  const client = await pool.connect();
  try {
    const identity = (await client.query('SELECT current_database() AS db, current_user AS role')).rows[0];
    if (identity.db !== flags['expected-database'] || identity.role !== flags['expected-user']) throw new Error('Connected database identity mismatch');
    const result = await run(client, entries, command, Number(flags.through));
    console.log(JSON.stringify({target:flags.target, host:flags['expected-host'], database:identity.db,
      backupReference:flags['backup-reference'], ...result}, null, 2));
    if (command === 'status' && (result.baselineRequired || result.pending.length)) process.exitCode = 2;
  } finally { client.release(); }
} catch (error) {
  // Driver errors can include connection details. Never print connection strings.
  if (error instanceof MigrationSafetyError) console.error(error.message);
  console.error('Migration stopped. Check target, catalog/history, schema drift, lock timeout and database logs. Inspect status before retrying after an uncertain connection/commit outcome.');
  process.exitCode = 1;
} finally { await pool.end(); }
