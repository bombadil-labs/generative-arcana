import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { MigrationSafetyError, type Connection } from './domain-migrations';

export interface MigrationConnection extends Connection { close(): Promise<void>; transport: string }

/** A single native libpq connection lives in the helper for the entire run. */
export async function connectLibpq(connectionString: string, python: string, caFile?: string): Promise<MigrationConnection> {
  if (!python) throw new MigrationSafetyError('channel_binding=require needs MIGRATION_PYTHON pointing to the reviewed migration-only Python environment; no fallback is allowed.');
  const childEnv = {...process.env};
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('PG') || key.startsWith('DATABASE_') || ['SSL_CERT_FILE','SSL_CERT_DIR'].includes(key)) delete childEnv[key];
  }
  childEnv.PSYCOPG_IMPL = 'binary';
  const child = spawn(python, ['-I','-u',fileURLToPath(new URL('./libpq/bridge.py',import.meta.url))], {
    windowsHide:true, stdio:['pipe','pipe','pipe'], env:childEnv,
  });
  // Native errors can contain connection details. Never forward stderr.
  child.stderr.resume();
  let sequence = 0;
  let stopped = false;
  const pending = new Map<number,{resolve:(value:any)=>void; reject:(error:Error)=>void; timer:NodeJS.Timeout}>();
  const fail = () => {
    stopped = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new MigrationSafetyError('Migration libpq transport unavailable or interrupted. Inspect status before retrying an uncertain commit.'));
    }
    pending.clear();
  };
  child.on('error',fail);
  child.on('exit',fail);
  child.stdin.on('error',fail);
  const lines = createInterface({input:child.stdout});
  lines.on('line',line => {
    try {
      if (line.length > 4_000_000) throw new Error('oversize');
      const message = JSON.parse(line);
      const item = pending.get(message.id);
      if (!item) throw new Error('unexpected response');
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) {
        const state = /^[A-Z0-9]{5}$/.test(message.sqlstate ?? '') ? ` (${message.sqlstate})` : '';
        item.reject(new MigrationSafetyError(`Migration libpq ${message.id === 0 ? 'connection/dependency/TLS authentication' : 'query'} failed${state}; no driver fallback attempted.`));
      } else item.resolve(message);
    } catch { fail(); child.kill(); }
  });
  const request = (id:number, value:object) => new Promise<any>((resolve,reject) => {
    if (stopped) return reject(new MigrationSafetyError('Migration libpq transport is closed'));
    const timer = setTimeout(() => { fail(); child.kill(); }, id === 0 ? 20_000 : 40_000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({id,...value})+'\n');
  });
  try {
    const ready = await request(0,{connectionString,caFile});
    if (ready.ready !== true || ready.channelBinding !== 'require' || ready.tls !== 'verify-full') throw new MigrationSafetyError('Native transport did not confirm required security mode');
  } catch (error) { child.kill(); throw error; }
  return {
    transport:'libpq (channel_binding=require, sslmode=verify-full)',
    query:async (sql,values) => ({rows:(await request(++sequence,{sql,values})).rows}),
    close:async () => {
      try { if (!stopped) await request(++sequence,{close:true}); }
      finally { child.stdin.end(); child.kill(); lines.close(); }
    },
  };
}

export async function connectMigration(connectionString:string, env:NodeJS.ProcessEnv = process.env): Promise<MigrationConnection> {
  if (new URL(connectionString).searchParams.get('channel_binding') === 'require') {
    return connectLibpq(connectionString,env.MIGRATION_PYTHON ?? '',env.DATABASE_MIGRATION_CA_FILE);
  }
  const pool = new Pool({connectionString,max:1,connectionTimeoutMillis:10_000});
  try {
    const client = await pool.connect();
    return {transport:'pg',query:(sql,values)=>client.query(sql,values),close:async()=>{client.release();await pool.end();}};
  } catch (error) { await pool.end(); throw error; }
}
