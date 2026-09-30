import { Pool } from "pg";
const args = process.argv.slice(2);
const domainSql = "DELETE FROM arcana_rate_limits WHERE expires_at < now()";
const authSql = 'DELETE FROM arcana_auth_rate_limit WHERE "lastRequest" < extract(epoch FROM now() - interval \'24 hours\') * 1000';
if (!args.includes("--apply")) {
  console.log(`-- Domain database\n${domainSql};\n-- Auth database (may be separate)\n${authSql};`);
} else {
  const databaseUrl = process.env.DATABASE_URL;
  const authDatabaseUrl = process.env.BETTER_AUTH_DATABASE_URL ?? databaseUrl;
  if (!databaseUrl || !authDatabaseUrl) throw new Error("DATABASE_URL required.");
  for (const [label,connectionString,sql] of [["domain",databaseUrl,domainSql],["auth",authDatabaseUrl,authSql]]) {
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
    try {
      const result = await pool.query(sql);
      console.log(`Pruned ${result.rowCount} expired ${label} rate-limit keys.`);
    } finally { await pool.end(); }
  }
}
