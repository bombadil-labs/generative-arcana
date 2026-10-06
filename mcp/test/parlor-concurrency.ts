import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresParlorStore } from '../src/parlorStore';
import type { ParlorConfig } from '../src/parlorConfig';
/** Called ONLY by the existing explicitly disposable PostgreSQL migration CI fixture. */
export async function verifyParlorConcurrency(pool:Pool) {
  const store=new PostgresParlorStore(pool);
  await pool.query("INSERT INTO arcana_entitlements(principal_id,entitlement,expires_at) VALUES('usr_race_a','parlor',now()+interval '1 day'),('usr_race_b','parlor',now()+interval '1 day')");
  const base={userDailyMicrousd:100,globalDailyMicrousd:1000,userConcurrency:4,globalConcurrency:4,timeoutMs:5000} as ParlorConfig;
  const request=(principal='usr_race_a')=>({principal,operation:randomUUID(),kind:'narrate' as const,provider:'anthropic',model:'mock',cost:60,inputBytes:100,outputLimit:100});
  for(const global of [false,true]){
    const config={...base,userDailyMicrousd:global?1000:100,globalDailyMicrousd:global?100:1000};
    const results=await Promise.allSettled([store.reserve(request(),config),store.reserve(request(global?'usr_race_b':'usr_race_a'),config)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(Number((await pool.query('SELECT sum(reserved_microusd) AS n FROM arcana_parlor_usage')).rows[0].n),60);
    await pool.query('DELETE FROM arcana_parlor_usage');
  }
  const op=request();const results=await Promise.allSettled([store.reserve(op,base),store.reserve(op,base)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await pool.query('DELETE FROM arcana_parlor_usage');
  const concurrent={...base,userDailyMicrousd:1000,userConcurrency:1};
  const concurrency=await Promise.allSettled([store.reserve(request(),concurrent),store.reserve(request(),concurrent)]);
  assert.equal(concurrency.filter(r=>r.status==='fulfilled').length,1);
  console.log('PostgreSQL parlor user/global budget, duplicate-operation and concurrency races passed.');
}
