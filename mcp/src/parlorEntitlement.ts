import type { ParlorDb } from './parlorStore';
export interface EntitlementPlan { operationId:string; issuer:string; subject:string; expectedPrincipal:string; action:'grant'|'revoke'; expiresAt?:string; evidenceReference:string }
export function validateEntitlementPlan(p:EntitlementPlan) {
  if(!p||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.operationId)
    || !['grant','revoke'].includes(p.action)||!/^usr_[A-Za-z0-9_-]+$/.test(p.expectedPrincipal)
    ||typeof p.subject!=='string'||!p.subject||p.subject.length>200||/[\s\0]/.test(p.subject)
    ||!/^https:\/\/[^?#\s]+\/api\/auth$/.test(p.issuer)||! /^[A-Za-z0-9._:/-]{1,160}$/.test(p.evidenceReference))throw new Error('Invalid entitlement plan');
  if(p.action==='grant'&&(!p.expiresAt||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.expiresAt)>Date.now()+90*86400000))throw new Error('Grant expiry must be in the next 90 days');
  if(p.action==='revoke'&&p.expiresAt)throw new Error('Revocation has no expiry');
}
/** Pure reads for plan; apply caller owns a transaction and identity/target verification. */
export async function inspectEntitlement(db:ParlorDb,p:EntitlementPlan) {
  validateEntitlementPlan(p);
  const rows=(await db.query('SELECT principal_id FROM arcana_external_identities WHERE issuer=$1 AND subject=$2',[p.issuer,p.subject])).rows;
  if(rows.length!==1||rows[0].principal_id!==p.expectedPrincipal)throw new Error('Verified issuer/subject mapping must match expected principal');
  const prior=(await db.query('SELECT principal_id,action,evidence_reference,expires_at FROM arcana_entitlement_audit WHERE operation_id=$1',[p.operationId])).rows[0];
  if(prior&&(prior.principal_id!==p.expectedPrincipal||prior.action!==p.action||prior.evidence_reference!==p.evidenceReference|| (prior.expires_at?new Date(prior.expires_at).toISOString():null)!==(p.expiresAt?new Date(p.expiresAt).toISOString():null)))throw new Error('Operation ID already used for a different grant');
  return {principal:p.expectedPrincipal,action:p.action,alreadyApplied:!!prior,expiresAt:p.expiresAt??null};
}
export async function applyEntitlement(db:ParlorDb,p:EntitlementPlan) {
  await db.query('SELECT pg_advisory_xact_lock(184734902)');
  const inspected=await inspectEntitlement(db,p);if(inspected.alreadyApplied)return inspected;
  if(p.action==='grant')await db.query(`INSERT INTO arcana_entitlements(principal_id,entitlement,expires_at) VALUES($1,'parlor',$2)
    ON CONFLICT(principal_id,entitlement) DO UPDATE SET granted_at=clock_timestamp(),expires_at=EXCLUDED.expires_at,revoked_at=NULL`,[p.expectedPrincipal,p.expiresAt]);
  else await db.query("UPDATE arcana_entitlements SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND entitlement='parlor'",[p.expectedPrincipal]);
  await db.query("INSERT INTO arcana_entitlement_audit(operation_id,principal_id,entitlement,action,evidence_reference,expires_at) VALUES($1,$2,'parlor',$3,$4,$5)",[p.operationId,p.expectedPrincipal,p.action,p.evidenceReference,p.expiresAt??null]);
  return {...inspected,alreadyApplied:true};
}
