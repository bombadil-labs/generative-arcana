import type { Pool } from 'pg';
import { ParlorFault, type ParlorConfig } from './parlorConfig';
export interface ParlorDb { query(sql: string, values?: any[]): Promise<{rows:any[]}> }
export interface Reservation { principal: string; operation: string; kind: 'narrate'|'converse'|'speech'; provider: string; model: string; cost: number; inputBytes: number; outputLimit: number }
export interface ParlorStore {
  entitled(principal: string): Promise<boolean>;
  reserve(request: Reservation, config: ParlorConfig): Promise<void>;
  finish(principal: string, operation: string, success: boolean): Promise<void>;
}
export async function entitled(db: ParlorDb, principal: string) {
  return (await db.query("SELECT 1 FROM arcana_entitlements WHERE principal_id=$1 AND entitlement='parlor' AND revoked_at IS NULL AND expires_at>clock_timestamp()",[principal])).rows.length===1;
}
/** Caller owns one transaction. Global advisory lock serializes all user/global budget decisions. */
export async function reserveParlor(db: ParlorDb, r: Reservation, c: ParlorConfig) {
  await db.query('SELECT pg_advisory_xact_lock(184734902)');
  // One wall-clock instant AFTER any lock wait owns this reservation's UTC budget day.
  const now=(await db.query('SELECT clock_timestamp() AS instant')).rows[0].instant;
  if (!await entitled(db,r.principal)) throw new ParlorFault(403,'parlor_access_required');
  if ((await db.query('SELECT 1 FROM arcana_parlor_usage WHERE principal_id=$1 AND operation_id=$2',[r.principal,r.operation])).rows.length) throw new ParlorFault(409,'operation_already_reserved');
  const row=(await db.query(`SELECT
    COALESCE(sum(reserved_microusd) FILTER (WHERE created_at>=date_trunc('day',$2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS global_spent,
    COALESCE(sum(reserved_microusd) FILTER (WHERE principal_id=$1 AND created_at>=date_trunc('day',$2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS user_spent,
    count(*) FILTER (WHERE active_until>$2::timestamptz) AS global_active,
    count(*) FILTER (WHERE principal_id=$1 AND active_until>$2::timestamptz) AS user_active
    FROM arcana_parlor_usage WHERE created_at>=date_trunc('day',$2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' OR active_until>$2::timestamptz`,[r.principal,now])).rows[0];
  if (Number(row.global_spent)+r.cost>c.globalDailyMicrousd || Number(row.user_spent)+r.cost>c.userDailyMicrousd
    || Number(row.global_active)>=c.globalConcurrency || Number(row.user_active)>=c.userConcurrency) throw new ParlorFault(429,'parlor_limit_reached');
  // Full worst-case charge is retained on success, failure, timeout, cancellation and process loss.
  // No prompt hashes or provider responses are stored, and duplicate IDs never dispatch again.
  await db.query(`INSERT INTO arcana_parlor_usage(principal_id,operation_id,kind,provider,model,reserved_microusd,input_bytes,output_limit,active_until,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$10::timestamptz+($9 * interval '1 millisecond'),$10::timestamptz)`,
    [r.principal,r.operation,r.kind,r.provider,r.model,r.cost,r.inputBytes,r.outputLimit,c.timeoutMs+30000,now]);
}
export class PostgresParlorStore implements ParlorStore {
  constructor(private pool: Pool) {}
  entitled(principal: string) { return entitled(this.pool,principal); }
  async reserve(r: Reservation,c: ParlorConfig) {
    const db=await this.pool.connect();
    try { await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='10s'");await reserveParlor(db,r,c);await db.query('COMMIT'); }
    catch(error) { await db.query('ROLLBACK');throw error; } finally { db.release(); }
  }
  async finish(principal: string,operation: string,success: boolean) {
    await this.pool.query(`UPDATE arcana_parlor_usage SET status=$3, active_until=CASE WHEN $3='complete' THEN clock_timestamp() ELSE active_until END WHERE principal_id=$1 AND operation_id=$2`,[principal,operation,success?'complete':'uncertain']);
  }
}
