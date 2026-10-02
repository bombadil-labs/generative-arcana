import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const args = process.argv.slice(2);
let sql = await readFile(new URL("../migrations/001-domain.sql", import.meta.url), "utf8");
if (args.includes("--include-artwork")) sql += "\n" + await readFile(new URL("../migrations/002-card-artwork.sql", import.meta.url), "utf8");
if (args.includes("--include-manifest-uploads") || args.includes("--include-manifest-drafts")) sql += "\n" + await readFile(new URL("../migrations/003-manifest-uploads.sql", import.meta.url), "utf8");
if (args.includes("--include-visual-packs")) {
  if (!args.includes("--include-artwork")) sql += "\n" + await readFile(new URL("../migrations/002-card-artwork.sql", import.meta.url), "utf8");
  sql += "\n" + await readFile(new URL("../migrations/004-named-artwork-sets.sql", import.meta.url), "utf8");
}
if (args.includes("--include-manifest-drafts")) sql += "\n" + await readFile(new URL("../migrations/005-manifest-drafts.sql", import.meta.url), "utf8");
if (!args.includes("--apply")) {
  console.log(sql);
  console.error("Preview only. Apply using DATABASE_MIGRATION_URL (or DATABASE_URL), --apply --expected-host <database hostname> after backup/review.");
} else {
  const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required.");
  const expectedHost = args[args.indexOf("--expected-host") + 1];
  if (!args.includes("--expected-host") || new URL(connectionString).hostname !== expectedHost) {
    throw new Error("--expected-host must exactly match the reviewed database hostname.");
  }
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(184734901)");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Arcana domain migration applied. Existing ownership IDs were preserved.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
