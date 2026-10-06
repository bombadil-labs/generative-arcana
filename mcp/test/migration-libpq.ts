import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { createSecureContext, TLSSocket } from 'node:tls';
import { catalog, run, schema, target } from '../scripts/domain-migrations';
import { connectLibpq, connectMigration } from '../scripts/migration-connection';

if (process.env.MIGRATION_LIBPQ_TEST !== '1') throw new Error('Explicit disposable local TLS fixture required');
const python = process.env.MIGRATION_PYTHON!;
const ca = process.env.MIGRATION_TEST_CA_FILE!;
assert.ok(python && ca,'Configured fixture interpreter/CA required');
const url = 'postgresql://migration_test:local-test-only@127.0.0.1:54481/arcana_tls_test?sslmode=require&channel_binding=require';
const flags = {target:'test','expected-host':'127.0.0.1','expected-port':'54481','expected-database':'arcana_tls_test','expected-user':'migration_test'};
assert.equal(target({DATABASE_MIGRATION_URL:url},flags),url);
assert.throws(()=>target({DATABASE_MIGRATION_URL:url},{...flags,'expected-host':'wrong'}),/target/);
await assert.rejects(connectMigration(url,{}),/MIGRATION_PYTHON/);
await assert.rejects(connectLibpq(url,python+'-missing',ca),/unavailable/);

// These exercise libpq's real TLS/authentication checks, not mocked flags.
await assert.rejects(connectLibpq(url,python),/TLS authentication/,'untrusted certificate must fail');
await assert.rejects(connectLibpq(url.replace('@127.0.0.1:','@localhost:'),python,ca),/TLS authentication/,'hostname mismatch must fail');
for (const role of ['trust_user','md5_user','clear_user']) {
  await assert.rejects(connectLibpq(url.replace('migration_test:',role+':'),python,ca),/TLS authentication/,`${role} cannot satisfy required channel binding`);
}
const noTls = createServer(socket => socket.once('data',()=>socket.end('N')));
await new Promise<void>(resolve=>noTls.listen(0,'127.0.0.1',resolve));
try {
  const port = (noTls.address() as {port:number}).port;
  await assert.rejects(connectLibpq(url.replace(':54481/',`:${port}/`),python,ca),/TLS authentication/,'server refusing TLS must fail');
} finally { await new Promise<void>(resolve=>noTls.close(()=>resolve())); }

// A TLS PostgreSQL test peer offers only ordinary SCRAM, never SCRAM-PLUS.
// It doesn't implement authentication: require must refuse this offer itself.
const context = createSecureContext({cert:readFileSync(ca),key:readFileSync(process.env.MIGRATION_TEST_KEY_FILE!)});
const scramOnly = createServer(socket => socket.once('data',() => {
  socket.write('S');
  const tls = new TLSSocket(socket,{isServer:true,secureContext:context});
  tls.on('error',()=>tls.destroy());
  tls.once('data',()=> {
    const mechanisms = Buffer.from('SCRAM-SHA-256\0\0');
    const frame = Buffer.alloc(9 + mechanisms.length);
    frame[0] = 82; frame.writeInt32BE(8 + mechanisms.length,1); frame.writeInt32BE(10,5);
    mechanisms.copy(frame,9); tls.write(frame);
  });
}));
await new Promise<void>(resolve=>scramOnly.listen(0,'127.0.0.1',resolve));
try {
  const port = (scramOnly.address() as {port:number}).port;
  await assert.rejects(connectLibpq(url.replace(':54481/',`:${port}/`),python,ca),/TLS authentication/,'TLS without SCRAM-PLUS must fail');
} finally { await new Promise<void>(resolve=>scramOnly.close(()=>resolve())); }

const entries = await catalog();
const a = await connectLibpq(url,python,ca);
const b = await connectLibpq(url,python,ca);
try {
  assert.deepEqual(await schema(a),[],'test database must be fresh');
  assert.equal((await a.query('SELECT current_user AS role')).rows[0].role,'migration_test');
  await run(a,entries.slice(0,2),'apply');
  await a.query("INSERT INTO arcana_host_state(scope_id,state) VALUES ($1,$2::jsonb)",['preserved','{"native":true}']);
  assert.equal((await run(a,entries,'plan')).pending.length,entries.length-2);
  const broken = entries.map(e=>({...e}));
  broken[2].sql += '; SELECT nonexistent_transport_test_function()';
  await assert.rejects(run(a,broken,'apply'),/query failed/);
  assert.equal((await run(a,entries,'status')).recordedThrough,2);
  await Promise.all([run(a,entries,'apply'),run(b,entries,'apply')]);
  const history = (await a.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows;
  assert.equal(history.length,entries.length);
  assert.deepEqual((await run(a,entries,'status')).pending,[]);
  await run(a,entries,'apply');
  assert.deepEqual((await a.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows,history);
  assert.deepEqual((await a.query('SELECT state FROM arcana_host_state')).rows,[{state:{native:true}}]);
  await a.query('BEGIN');
  await a.query('SELECT pg_advisory_xact_lock(184734901)');
  await assert.rejects(run(b,entries,'apply'),/55P03/);
  await a.query('ROLLBACK');
  assert.deepEqual((await run(b,entries,'status')).pending,[]);
  await a.query("UPDATE arcana_migration_history SET checksum='fixture-corruption' WHERE version=1");
  await assert.rejects(run(a,entries,'apply'),/checksum mismatch/);
} finally { await a.close(); await b.close(); }
const baseline = await connectLibpq(url.replace('/arcana_tls_test?','/arcana_tls_baseline?'),python,ca);
try {
  await baseline.query(entries[0].sql);
  assert.equal((await run(baseline,entries,'plan')).verifiedBaselineCandidate,1);
  await run(baseline,entries,'baseline',1);
  await run(baseline,entries,'apply');
  assert.deepEqual((await run(baseline,entries,'status')).pending,[]);
} finally { await baseline.close(); }
console.log('Native libpq TLS/SCRAM-PLUS enforcement passed: no TLS/trust/MD5/cleartext/untrusted CA/wrong hostname refuse; native migration plan/baseline/apply/rollback/concurrency/lock timeout/history/no-op pass.');
