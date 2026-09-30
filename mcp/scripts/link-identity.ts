import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { linkVerifiedExternalIdentity, type VerifiedIdentityLink } from "../src/identityLink";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--plan");
if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error("Provide --plan <operator-reviewed JSON file>.");
const plan = JSON.parse(await readFile(args[fileIndex + 1], "utf8")) as VerifiedIdentityLink;
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ action: "link_verified_identity", ...plan }, null, 2));
  console.error("Preview only. Never identify an account by email. Review proof of both identities and back up the mapping before applying.");
} else {
  if (!args.includes("--confirm-verified-both-identities")) throw new Error("Dual-identity proof must be explicitly confirmed.");
  const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  const expectedHost = args[args.indexOf("--expected-host") + 1];
  if (!connectionString || !args.includes("--expected-host") || new URL(connectionString).hostname !== expectedHost) {
    throw new Error("Provide a database URL and exact --expected-host.");
  }
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await linkVerifiedExternalIdentity(client, plan);
    await client.query("COMMIT");
    console.log("Verified identity linked; deck ownership keys unchanged.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
