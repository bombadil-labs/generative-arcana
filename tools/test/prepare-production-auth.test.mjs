import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../prepare-production-auth.sh', import.meta.url));
const fakeSecret = 'postgresql://operator:TEST_ONLY_PASSWORD@ep-test.neon.tech/arcana?sslmode=require';
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

test('production helper rejects extra/apply arguments and non-interactive secret entry', () => {
  for (const args of [[], ['http://production.example'], ['https://production.example', '--apply']]) {
    const result = spawnSync('bash', [helper, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
  const result = spawnSync('bash', [helper, 'https://production.example'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});

// Exercise the actual terminal prompt with fake npm/node programs, never a real DB or install.
async function runMockOperator({ status = 0, version = 24 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arcana-production-helper-test-'));
  try {
    for (const directory of ['tools', 'mcp', 'bin', 'home']) await mkdir(join(root, directory));
    await copyFile(helper, join(root, 'tools', 'prepare-production-auth.sh'));
    await writeFile(join(root, 'config.json'), JSON.stringify({ status, version }));
    const mockHeader = `#!${process.execPath}\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json')));\n`;
    const checkEnvironment = `
      for (const name of ['ARCANA_STAGING_DATABASE_URL', 'DATABASE_URL', 'BETTER_AUTH_DATABASE_URL', 'DATABASE_MIGRATION_URL', 'PGHOST', 'PGOPTIONS', 'PGPASSWORD', 'NODE_OPTIONS', 'BETTER_AUTH_SECRET', 'RESEND_API_KEY']) {
        assert.equal(process.env[name], undefined, 'Inherited secret/override was cleared: ' + name);
      }
    `;
    await writeFile(join(root, 'bin', 'npm'), `${mockHeader}
      ${checkEnvironment}
      assert.equal(process.env.ARCANA_PRODUCTION_DATABASE_URL, undefined);
      assert.deepEqual(process.argv.slice(2), ['ci', '--prefix', 'mcp']);
      console.log('MOCK_INSTALL_BEFORE_PROMPT');
    `, { mode: 0o700 });
    await writeFile(join(root, 'bin', 'node'), `${mockHeader}
      ${checkEnvironment}
      const args = process.argv.slice(2);
      if (args[0] === '-p') { console.log(config.version); process.exit(0); }
      assert.deepEqual(args.slice(0, 7), ['--import', 'tsx', 'scripts/staging-preflight.ts', '--target', 'production', '--origin', 'https://production.example']);
      assert.equal(args[7], '--out');
      assert.equal(args.length, 9, 'No connection is passed as an argument');
      assert.ok(process.env.ARCANA_PRODUCTION_DATABASE_URL === ${JSON.stringify(fakeSecret)}, 'Use the locally prompted production connection');
      assert.equal(process.cwd(), path.join(__dirname, '../mcp'));
      fs.writeFileSync(args[8], JSON.stringify({ readOnly: true }), { flag: 'wx', mode: 0o600 });
      console.log('MOCK_READ_ONLY_PLAN');
      process.exit(config.status);
    `, { mode: 0o700 });
    const command = `bash ${shellQuote(join(root, 'tools/prepare-production-auth.sh'))} https://production.example`;
    const output = await new Promise((resolve, reject) => {
      const child = spawn('script', ['-q', '-e', '-c', command, '/dev/null'], {
        env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: join(root, 'home'),
          ARCANA_PRODUCTION_DATABASE_URL: 'INHERITED_WRONG_TARGET', ARCANA_STAGING_DATABASE_URL: 'INHERITED_WRONG_TARGET',
          DATABASE_URL: 'INHERITED_WRONG_TARGET', BETTER_AUTH_DATABASE_URL: 'INHERITED_WRONG_TARGET', DATABASE_MIGRATION_URL: 'INHERITED_WRONG_TARGET',
          PGHOST: 'wrong.invalid', PGOPTIONS: '-c default_transaction_read_only=off', PGPASSWORD: 'INHERITED_SECRET',
          NODE_OPTIONS: '--trace-warnings', BETTER_AUTH_SECRET: 'INHERITED_SECRET', RESEND_API_KEY: 'INHERITED_SECRET' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let text = '';
      let prompted = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Mock operator timed out')); }, 10_000);
      const collect = (chunk) => {
        text += chunk.toString();
        if (!prompted && text.includes('connection URL (hidden): ')) {
          prompted = true;
          child.stdin.write(`${fakeSecret}\n`);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); resolve({ text, code, prompted }); });
    });
    assert.ok(!output.text.includes('TEST_ONLY_PASSWORD'), 'Terminal input must not be echoed');
    assert.ok(!output.text.includes('postgresql://'), 'Connection URLs must not be printed');
    if (version === 24) {
      assert.ok(output.prompted);
      assert.ok(output.text.indexOf('MOCK_INSTALL_BEFORE_PROMPT') < output.text.indexOf('connection URL (hidden): '));
      assert.match(output.text, /MOCK_READ_ONLY_PLAN/);
      const directories = await readdir(join(root, 'home'));
      assert.equal(directories.length, 1);
      assert.match(directories[0], /^arcana-production-plan\./);
      const planDirectory = join(root, 'home', directories[0]);
      assert.equal((await stat(planDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(planDirectory, 'auth-plan.json'))).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(join(planDirectory, 'auth-plan.json'), 'utf8')), { readOnly: true });
    }
    return output;
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('production helper uses a hidden local prompt, isolated environment and private plan', async () => {
  const output = await runMockOperator();
  assert.equal(output.code, 0, output.text);
  assert.match(output.text, /verified restore point before any production apply/);
  assert.ok(!/Preview|staging|WITHOUT a backup/.test(output.text));
});

test('production helper propagates plan diagnostics and does not claim success', async () => {
  const output = await runMockOperator({ status: 2 });
  assert.equal(output.code, 2, output.text);
  assert.match(output.text, /Production preflight did not pass/);
  assert.ok(!output.text.includes('Stop for target/migration approval'));
});

test('production helper requires Node 24 before installing or reading credentials', async () => {
  const output = await runMockOperator({ version: 23 });
  assert.equal(output.code, 1, output.text);
  assert.equal(output.prompted, false);
  assert.match(output.text, /Use Node.js 24/);
  assert.ok(!output.text.includes('MOCK_INSTALL'));
});
