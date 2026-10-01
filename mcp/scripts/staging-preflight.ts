/** Read-only target inspection and auth planning. This command has no apply mode. */
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { runAuthSchema } from './auth-schema.js';

class PreflightInputError extends Error {}
export interface PreflightOptions { origin: string; out: string; target?: 'staging' | 'production' }
export interface TargetMetadata { database: string; schema: string; role: string; read_only: string; default_read_only: string; managed_auth_present: boolean; arcana_tables: number }
interface Client {
  query(sql: string): Promise<{ rows: TargetMetadata[] }>;
  release(): void;
}
interface ConnectionPool { connect(): Promise<Client>; end(): Promise<void> }

export function parsePreflightArguments(args: string[]): PreflightOptions {
  const result: Partial<PreflightOptions> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] === '--origin' ? 'origin' : args[i] === '--out' ? 'out' : args[i] === '--target' ? 'target' : undefined;
    const value = args[i + 1];
    if (!key || !value || value.startsWith('--') || /[\r\n\0]/.test(value) || result[key]) throw new PreflightInputError('Use --origin <stable HTTPS origin> --out <new private plan file> [--target staging|production].');
    if (key === 'target') {
      if (value !== 'staging' && value !== 'production') throw new PreflightInputError('--target must be staging or production.');
      result.target = value;
    } else result[key] = value;
  }
  if (!result.origin || !result.out) throw new PreflightInputError('Both --origin and --out are required.');
  let origin: URL;
  try { origin = new URL(result.origin); } catch { throw new PreflightInputError('The origin must be an HTTPS origin without credentials, path, query or fragment.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new PreflightInputError('The origin must be an HTTPS origin without credentials, path, query or fragment.');
  return { origin: origin.origin, out: result.out, ...(result.target ? { target: result.target } : {}) };
}

export function readOnlyNeonConnection(value: string | undefined): { connectionString: string; host: string } {
  if (!value || /[\r\n\0]/.test(value)) throw new PreflightInputError('A Neon connection is required through the local secret prompt.');
  let url: URL;
  try { url = new URL(value); } catch { throw new PreflightInputError('The connection is not a valid PostgreSQL URL.'); }
  const hostname = url.hostname.toLowerCase();
  // pg decodes percent-encoded hosts (including Unix sockets); only literal DNS labels are valid.
  if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+neon\.tech$/.test(hostname)) throw new PreflightInputError('Use a literal Neon DNS hostname without encoding, sockets or host overrides.');
  url.hostname = hostname;
  const queryKeys = [...url.searchParams.keys()];
  if (new Set(queryKeys).size !== queryKeys.length || queryKeys.some((key) => !['sslmode', 'channel_binding', 'options'].includes(key))) {
    throw new PreflightInputError('Use a standard Neon connection without duplicate parameters or query-string host/user/database overrides.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || !url.username || !url.password || url.hash || !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
    throw new PreflightInputError('Use the exact Neon PostgreSQL connection with credentials and sslmode=require (or stronger), entered locally.');
  }
  if (url.pathname.length <= 1) throw new PreflightInputError('The Neon connection must explicitly name the database.');
  url.searchParams.set('sslmode', 'verify-full');
  // Do not inherit a possibly unrelated PGPORT from the operator's shell.
  if (!url.port) url.port = '5432';
  if (url.hostname.includes('-pooler.')) throw new PreflightInputError('Use the unpooled/direct connection for the intended Neon branch so PostgreSQL startup read-only settings are enforced.');
  const options = url.searchParams.get('options')?.trim() ?? '';
  if (options && !/^-c\s+search_path=public$/.test(options)) throw new PreflightInputError('Connection options may only explicitly select search_path=public for this read-only workflow.');
  // Preserve an explicitly approved public search_path; never silently change the role's default.
  url.searchParams.set('options', `${options} -c default_transaction_read_only=on`.trim());
  return { connectionString: url.toString(), host: url.hostname };
}

export async function inspectStagingTarget(connectionString: string, makePool: (connection: string) => ConnectionPool = (connection) => new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 }) as unknown as ConnectionPool): Promise<TargetMetadata> {
  const pool = makePool(connectionString);
  let client: Client | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT current_database() AS database, current_schema() AS schema,
      session_user AS role, current_setting('transaction_read_only') AS read_only,
      current_setting('default_transaction_read_only') AS default_read_only,
      EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='neon_auth') AS managed_auth_present,
      (SELECT count(*)::integer FROM information_schema.tables WHERE table_schema='public' AND left(table_name, 7)='arcana_') AS arcana_tables`);
    const target = result.rows[0];
    if (!target?.database || !target.schema || !target.role || target.read_only !== 'on' || target.default_read_only !== 'on') throw new PreflightInputError('Could not verify the target identity, startup read-only default and read-only transaction. No plan generated.');
    if (target.schema !== 'public') throw new PreflightInputError('This read-only workflow requires the approved application schema public. Review the connection search_path; never target a managed schema.');
    return target;
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
    } else await pool.end();
  }
}

export async function runStagingPreflight(options: PreflightOptions, secret: string | undefined, dependencies: {
  inspect?: typeof inspectStagingTarget;
  plan?: typeof runAuthSchema;
  report?: (message: string) => void;
} = {}): Promise<number> {
  const connection = readOnlyNeonConnection(secret);
  const target = await (dependencies.inspect ?? inspectStagingTarget)(connection.connectionString);
  const report = dependencies.report ?? console.log;
  report(JSON.stringify({ host: connection.host, database: target.database, schema: target.schema, role: target.role,
    readOnly: true, managedAuthSchemaPresent: target.managed_auth_present, existingArcanaTables: target.arcana_tables }, null, 2));
  report(options.target === 'production'
    ? 'Compare this host/database with the exact effective Production auth connection in Vercel and the intended Neon production branch. This inspection cannot establish which Neon project or branch owns the endpoint.'
    : 'Compare this host/database with the exact feature-branch Preview connection. This inspection cannot establish which Neon project or branch owns the endpoint.');
  const result = await (dependencies.plan ?? runAuthSchema)(['plan', '--out', options.out], {
    BETTER_AUTH_URL: options.origin, MCP_OAUTH_RESOURCE: `${options.origin}/mcp`,
    DATABASE_URL: connection.connectionString, BETTER_AUTH_DATABASE_URL: connection.connectionString,
  });
  if (result !== 0) report('The generated plan has diagnostics requiring manual review. No apply is permitted by this helper.');
  report('Read-only preflight finished. No migrations applied or email sent. The planner may probe existing tables for row existence; it does not return account contents. Keep the plan private; review its target and SQL and obtain approval before any apply.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parsePreflightArguments(process.argv.slice(2));
    const secret = options.target === 'production' ? process.env.ARCANA_PRODUCTION_DATABASE_URL : process.env.ARCANA_STAGING_DATABASE_URL;
    delete process.env.ARCANA_PRODUCTION_DATABASE_URL;
    delete process.env.ARCANA_STAGING_DATABASE_URL;
    process.exitCode = await runStagingPreflight(options, secret);
  }
  catch (error) {
    console.error(error instanceof PreflightInputError ? error.message : 'Read-only schema preflight failed. No success is claimed. Check the connection and private operator session; do not share credentials or raw driver errors.');
    process.exitCode = 1;
  }
}
