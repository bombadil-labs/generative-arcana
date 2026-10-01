#!/usr/bin/env bash
# Explicit reviewed domain + auth apply for an approved empty Preview. No deployment.
set +x +v
set -euo pipefail
umask 077
if [[ $# -ne 4 ]]; then
  printf 'Usage: bash tools/apply-disposable-staging-auth.sh HTTPS_PREVIEW_ORIGIN PRIVATE_PLAN_PATH EXPECTED_HOST REVIEWED_SHA256\n' >&2
  exit 1
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Resolve the plan relative to the caller before entering mcp.
plan=$(realpath -- "$2")
[[ -f "$plan" ]] || { printf 'Reviewed private plan not found.\n' >&2; exit 1; }
[[ -t 0 ]] || { printf 'Run in an interactive terminal for the hidden secret prompt.\n' >&2; exit 1; }
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { printf 'Use Node.js 24.\n' >&2; exit 1; }
cd "$root/mcp"
printf 'This explicitly applies the reviewed domain and auth schemas to disposable, empty staging WITHOUT a backup.\n'
printf 'Use the same approved direct Neon connection as the plan. They are separate transactions; a committed first step cannot roll back with the second.\n'
IFS= read -r -s -p 'Paste that staging connection URL (hidden): ' ARCANA_STAGING_DATABASE_URL
printf '\n'
trap 'unset ARCANA_STAGING_DATABASE_URL' EXIT
# No inherited auth, SMTP, DATABASE_URL, PG*, NODE_OPTIONS or deployment overrides.
env -i PATH="$PATH" HOME="$HOME" ARCANA_STAGING_DATABASE_URL="$ARCANA_STAGING_DATABASE_URL" \
  node --import tsx --input-type=module - "$1" "$plan" "$3" "$4" <<'NODE'
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { OperatorInputError, runAuthSchema } from './scripts/auth-schema.ts';
import { assertReviewedAuthSchemaPlan } from './scripts/auth-schema-plan.ts';
import { assertDisposableStagingPlan, assertEmptyDisposableStaging, disposableStagingConnection } from './scripts/disposable-staging.ts';
import { readOnlyNeonConnection } from './scripts/staging-preflight.ts';
const [origin, plan, host, sha256] = process.argv.slice(2);
try {
  const reviewed = JSON.parse(await readFile(plan, 'utf8'));
  assertReviewedAuthSchemaPlan(reviewed, reviewed);
  if (reviewed.sha256 !== sha256 || reviewed.target.host !== host) throw new Error('Plan review mismatch');
  const env = { BETTER_AUTH_URL: origin, VERCEL_ENV: 'preview', MCP_OAUTH_RESOURCE: `${origin}/mcp` };
  env.BETTER_AUTH_DATABASE_URL = disposableStagingConnection(process.env.ARCANA_STAGING_DATABASE_URL, env, origin);
  delete process.env.ARCANA_STAGING_DATABASE_URL;
  const connectionTarget = new URL(env.BETTER_AUTH_DATABASE_URL);
  if (connectionTarget.hostname !== host || connectionTarget.port !== reviewed.target.port) throw new Error('Connection target mismatch');
  assertDisposableStagingPlan(reviewed);
  // The reviewed domain SQL is a separate, explicit transaction. Verify target and emptiness
  // before any of its DDL, using the same sanitized direct connection as the auth apply.
  const domainSQL = await readFile('./migrations/001-domain.sql', 'utf8');
  const pool = new Pool({ connectionString: env.BETTER_AUTH_DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(184734901)');
    const { rows: [target] } = await client.query('SELECT current_database() AS database, current_schema() AS schema, session_user AS role');
    if (['database', 'schema', 'role'].some((key) => target?.[key] !== reviewed.target[key])) throw new Error('Domain target mismatch');
    await assertEmptyDisposableStaging(client);
    await client.query(domainSQL);
    await client.query('COMMIT');
    console.log('Reviewed domain schema committed to verified empty staging. Auth apply is next, in a separate transaction.');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }

  const result = await runAuthSchema(['apply', '--plan', plan, '--expected-host', host, '--disposable-staging', '--staging-origin', origin], env);
  if (result !== 0) throw new Error('Apply did not succeed');
  env.BETTER_AUTH_DATABASE_URL = readOnlyNeonConnection(env.BETTER_AUTH_DATABASE_URL).connectionString;
  process.exitCode = await runAuthSchema(['check'], env);
} catch (error) {
  if (error instanceof OperatorInputError) console.error(error.message);
  console.error('Stopped. No success is claimed for unfinished steps. Inspect the private plan and target locally; do not share credentials or driver errors. A domain/auth success above means that transaction committed even if a later step failed.');
  process.exitCode = 1;
}
NODE
