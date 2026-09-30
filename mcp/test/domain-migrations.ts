import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { NeonExternalIdentityRepository } from "../src/neonExternalIdentityRepository";
import { DurableRateLimiter } from "../src/durableRateLimiter";
import { linkVerifiedExternalIdentity } from "../src/identityLink";
import { requestClientIp } from "../src/requestIp";
import type { IncomingMessage } from "node:http";

const db = new PGlite();
try {
  // Start from the deployed predecessor schema with an existing ownership key.
  await db.exec(`CREATE TABLE arcana_external_identities (
    issuer text NOT NULL, subject text NOT NULL, principal_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (issuer,subject));
    INSERT INTO arcana_external_identities(issuer,subject,principal_id)
    VALUES ('https://old.example/','existing-user','usr_preserved');`);
  const migration = await readFile(new URL("../migrations/001-domain.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Explicit release migration is repeatable.
  const sql = async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const statement = strings.reduce((all, part, i) => all + (i ? `$${i}` : "") + part, "");
    return (await db.query<Record<string, unknown>>(statement, params)).rows;
  };
  const identities = new NeonExternalIdentityRepository("test-only", sql);
  assert.equal(await identities.resolveOrCreate({issuer:"https://old.example/",subject:"existing-user"}), "usr_preserved");
  const newId = await identities.resolveOrCreate({issuer:"https://new.example/api/auth",subject:"new-user"});
  assert.match(newId, /^usr_/);
  assert.equal(await identities.resolveOrCreate({issuer:"https://new.example/api/auth",subject:"new-user"}), newId);
  assert.notEqual(await identities.resolveOrCreate({issuer:"https://new.example/api/auth",subject:"other-user"}), newId);

  const plan = {
    source: {issuer:"https://old.example/",subject:"existing-user"},
    target: {issuer:"https://hosted.example/",subject:"verified-new-subject"},
    expectedPrincipal:"usr_preserved", evidenceReference:"reviewed-dual-auth-proof-123",
  };
  await db.transaction(tx => linkVerifiedExternalIdentity(tx, plan));
  await db.transaction(tx => linkVerifiedExternalIdentity(tx, plan));
  assert.equal(await identities.resolveOrCreate(plan.target), "usr_preserved");
  assert.equal((await db.query<{count:number}>("SELECT count(*)::integer AS count FROM arcana_identity_link_audit")).rows[0].count, 1);
  await assert.rejects(db.transaction(tx => linkVerifiedExternalIdentity(tx, {
    ...plan, target:{issuer:"https://new.example/api/auth",subject:"new-user"},
  })), /already belongs/);
  assert.equal(await identities.resolveOrCreate({issuer:"https://new.example/api/auth",subject:"new-user"}),newId);
  await assert.rejects(db.transaction(tx => linkVerifiedExternalIdentity(tx, {...plan, expectedPrincipal:"usr_wrong"})), /expected principal/);

  const query = async (statement: string, params: unknown[]) => (await db.query<Record<string, unknown>>(statement, params)).rows;
  const first = new DurableRateLimiter("test-only", 10, 60_000, query);
  const replica = new DurableRateLimiter("test-only", 10, 60_000, query);
  const decisions = await Promise.all(Array.from({length:30}, (_, i) => (i % 2 ? first : replica).check("test-ip-and-route")));
  assert.equal(decisions.filter(result => result.allowed).length, 10, "instances must share atomic limits");
  assert.ok(decisions.filter(result => !result.allowed).every(result => result.retryAfterSeconds > 0));
  assert.equal((await first.check("another-ip-and-route")).allowed, true);
  const stored = await db.query<{key:string}>("SELECT key FROM arcana_rate_limits");
  assert.ok(stored.rows.every(row => /^[0-9a-f]{64}$/.test(row.key)));
  await db.exec("UPDATE arcana_rate_limits SET bucket=0");
  assert.equal((await replica.check("test-ip-and-route")).allowed, true, "expired windows reset atomically");
  const failed = new DurableRateLimiter("test-only", 10,60_000,async()=>{throw new Error("offline");});
  await assert.rejects(failed.check("ip"),/offline/);

  const req = {headers:{"x-forwarded-for":"203.0.113.4"},socket:{remoteAddress:"127.0.0.1"}} as unknown as IncomingMessage;
  assert.equal(requestClientIp(req,false),"127.0.0.1","untrusted direct requests cannot spoof a forwarded IP");
  assert.equal(requestClientIp(req,true),"203.0.113.4");
  req.headers["x-forwarded-for"]="203.0.113.4, 198.51.100.2";
  assert.equal(requestClientIp(req,true),"127.0.0.1","ambiguous lists fail closed to peer bucket");
  console.log("Domain migration, stable verified identity links and cross-instance rate-limit tests passed (real PostgreSQL/PGlite).");
} finally { await db.close(); }
