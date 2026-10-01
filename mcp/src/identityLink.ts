import { randomUUID } from "node:crypto";
import type { ExternalIdentity } from "./oauthIdentity";

export interface IdentityLinkQuery {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface VerifiedIdentityLink {
  source: ExternalIdentity;
  target: ExternalIdentity;
  expectedPrincipal: string;
  /** Reference to operator-reviewed dual-identity proof, never credentials or raw tokens. */
  evidenceReference: string;
}

/**
 * Operator-only migration primitive. Caller must prove both identities and wrap this in a
 * transaction. This is deliberately NOT exposed through HTTP or automatic email matching.
 * Existing target ownership is never reassigned/merged.
 */
export async function linkVerifiedExternalIdentity(db: IdentityLinkQuery, input: VerifiedIdentityLink): Promise<string> {
  for (const value of [input.source.issuer, input.source.subject, input.target.issuer,
    input.target.subject, input.expectedPrincipal, input.evidenceReference]) {
    if (typeof value !== "string" || !value.trim()) throw new Error("Identity linking requires complete verified identities and an evidence reference.");
  }
  if (input.evidenceReference.length > 256) throw new Error("Use a short evidence reference, not the proof itself.");
  const source = await db.query(
    "SELECT principal_id FROM arcana_external_identities WHERE issuer=$1 AND subject=$2 FOR UPDATE",
    [input.source.issuer, input.source.subject],
  );
  if (source.rows[0]?.principal_id !== input.expectedPrincipal) {
    throw new Error("Source identity does not resolve to the expected principal; no change made.");
  }
  const inserted = await db.query(`INSERT INTO arcana_external_identities (issuer, subject, principal_id)
    VALUES ($1,$2,$3) ON CONFLICT (issuer,subject) DO NOTHING RETURNING principal_id`,
  [input.target.issuer, input.target.subject, input.expectedPrincipal]);
  if (!inserted.rows.length) {
    const existing = await db.query(
      "SELECT principal_id FROM arcana_external_identities WHERE issuer=$1 AND subject=$2 FOR UPDATE",
      [input.target.issuer, input.target.subject],
    );
    if (existing.rows[0]?.principal_id !== input.expectedPrincipal) {
      throw new Error("Target identity already belongs to a different principal; automatic merging is forbidden.");
    }
    return input.expectedPrincipal;
  }
  await db.query(`INSERT INTO arcana_identity_link_audit
    (id,principal_id,source_issuer,source_subject,target_issuer,target_subject,evidence_reference)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [randomUUID(), input.expectedPrincipal, input.source.issuer, input.source.subject,
    input.target.issuer, input.target.subject, input.evidenceReference]);
  return input.expectedPrincipal;
}
