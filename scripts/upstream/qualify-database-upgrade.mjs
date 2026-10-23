/** Disposable PostgreSQL schema upgrade and cold restore; never uses DATABASE_URL. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disposablePostgresStartArguments, disposableRestoreAclArguments } from './postgres-control.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.versions.node.split('.')[0], readFileSync(path.join(root, '.nvmrc'), 'utf8').trim());
assert.equal(process.argv.length, 2, 'No external database, port, credential or target override is accepted');
const integration = JSON.parse(readFileSync(path.join(root, 'config/upstream/integration.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
function sourceInputs() {
  const files = new Set([...git(['ls-files', '-z', '--', 'packages/db/src']).toString().split('\0').filter(Boolean),
    'packages/db/src/migration-history-hashes.ts', 'scripts/upstream/qualify-database-upgrade.mjs', 'scripts/upstream/postgres-control.mjs', 'pnpm-lock.yaml']);
  return { commit: git(['rev-parse', 'HEAD']).toString().trim(), dirty: git(['status', '--porcelain']).length > 0,
    files: Object.fromEntries([...files].sort().map(ref => [ref, sha(readFileSync(path.join(root, ref)))])) };
}
const observedSource = sourceInputs();
const parent = path.join(root, '.build/upstream'); mkdirSync(parent, { recursive: true });
const output = mkdtempSync(path.join(parent, 'database-upgrade-'));
const owned = ref => {
  const result = path.resolve(output, ref), relative = path.relative(realpathSync(output), result);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); return result;
};
const own = createRequire(path.join(root, 'packages/db/package.json'));
const { register } = await import(pathToFileURL(own.resolve('tsx/esm/api')).href);
const unregister = register();
const embeddedRequire = createRequire(own.resolve('embedded-postgres'));
assert.equal(process.platform, 'win32', 'This rehearsal currently qualifies the pinned Windows native runtime only');
const nativeEntry = embeddedRequire.resolve('@embedded-postgres/windows-x64');
const bin = path.resolve(path.dirname(nativeEntry), '../native/bin');
const postgres = path.join(bin, 'postgres.exe'), pgCtl = path.join(bin, 'pg_ctl.exe');
assert.ok(existsSync(postgres) && existsSync(pgCtl));
const journalRef = 'packages/db/src/migrations/meta/_journal.json';
const beforeJournal = JSON.parse(git(['show', `${integration.baselineForkCommit}:${journalRef}`]));
const afterJournal = JSON.parse(readFileSync(path.join(root, journalRef)));
assert.ok(afterJournal.entries.length > beforeJournal.entries.length);
const migrationDirectory = owned('baseline-migrations'); mkdirSync(path.join(migrationDirectory, 'meta'), { recursive: true });
writeFileSync(path.join(migrationDirectory, 'meta/_journal.json'), JSON.stringify(beforeJournal));
for (const entry of beforeJournal.entries) {
  assert.match(entry.tag, /^[a-zA-Z0-9_-]+$/u);
  writeFileSync(path.join(migrationDirectory, entry.tag + '.sql'), git(['show', `${integration.baselineForkCommit}:packages/db/src/migrations/${entry.tag}.sql`]));
}
const { loadWithoutEmbeddedPostgresExitHooks } = await import(pathToFileURL(path.join(root, 'packages/db/src/embedded-postgres-lifecycle.ts')).href);
const { default: EmbeddedPostgres } = await loadWithoutEmbeddedPostgresExitHooks(() => import(pathToFileURL(own.resolve('embedded-postgres')).href));
const { default: connect } = await import(pathToFileURL(own.resolve('postgres')).href);
const { drizzle } = await import(pathToFileURL(own.resolve('drizzle-orm/postgres-js')).href);
const { migrate } = await import(pathToFileURL(own.resolve('drizzle-orm/postgres-js/migrator')).href);
const { applyPendingMigrations, ensurePostgresDatabase, closeRegisteredClients } = await import(pathToFileURL(path.join(root, 'packages/db/src/client.ts')).href);
const user = 'cityos_fixture', password = randomBytes(32).toString('hex'), companyId = randomUUID();
let running, sql;
const stages = [];
let phase = 'initialize';
const nativeLogs = [];
const redact = value => String(value).replaceAll(password, '[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[redacted-postgres-url]');
const log = value => { nativeLogs.push(redact(value)); if (nativeLogs.length > 30) nativeLogs.shift(); };
async function availablePort() {
  return new Promise((yes, no) => {
    const listener = net.createServer(); listener.once('error', no);
    listener.listen(0, '127.0.0.1', () => { const { port } = listener.address(); listener.close(error => error ? no(error) : yes(port)); });
  });
}
async function start(directory, initialize) {
  assert.ok(path.relative(realpathSync(output), path.resolve(directory)).split(path.sep).every(part => part && part !== '..'));
  const port = await availablePort(); assert.notEqual(port, 54329);
  const instance = new EmbeddedPostgres({ databaseDir: directory, port, user, password, authMethod: 'scram-sha-256',
    persistent: true, createPostgresUser: false, initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'],
    postgresFlags: ['-h', '127.0.0.1'], onLog: log, onError: log });
  if (initialize) await instance.initialise();
  // pg_ctl's Windows implementation drops the administrative token when it
  // starts postgres. Keep the same native bytes and disposable cluster owner.
  const logFile = owned(path.basename(directory) + '-postgres.log');
  const started = spawnSync(pgCtl, disposablePostgresStartArguments({ directory, port, logFile }),
    { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  if (started.status !== 0 && existsSync(logFile)) log(readFileSync(logFile, 'utf8').slice(-16000));
  assert.equal(started.status, 0, 'Owned PostgreSQL restricted-token startup did not complete');
  const pid = Number(readFileSync(path.join(directory, 'postmaster.pid'), 'utf8').split(/\r?\n/u)[0]);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const url = new URL(`postgresql://127.0.0.1:${port}/postgres`); url.username = user; url.password = password;
  running = { directory: realpathSync(directory), pid, url: url.href, instance };
  return url;
}
async function stop() {
  if (!running) return;
  if (sql) { await sql.end({ timeout: 5 }); sql = undefined; }
  await closeRegisteredClients(running.url);
  const observed = Number(readFileSync(path.join(running.directory, 'postmaster.pid'), 'utf8').split(/\r?\n/u)[0]);
  assert.equal(observed, running.pid, 'Only the exact disposable cluster may be stopped');
  const result = spawnSync(pgCtl, ['-D', running.directory, 'stop', '-m', 'fast', '-w', '-t', '15'],
    { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, 'Owned PostgreSQL shutdown did not complete');
  assert.equal(existsSync(path.join(running.directory, 'postmaster.pid')), false);
  running = undefined;
}
function tree(directory) {
  const files = {};
  function visit(folder, prefix = '') {
    for (const name of readdirSync(folder).sort()) {
      const absolute = path.join(folder, name), ref = prefix + name, stat = lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, 'Disposable backup must not follow links');
      if (stat.isDirectory()) visit(absolute, ref + '/');
      else { assert.ok(stat.isFile()); files[ref] = sha(readFileSync(absolute)); }
    }
  }
  visit(directory); return files;
}
async function countMigrations() { return Number((await sql`select count(*)::int as count from drizzle.__drizzle_migrations`)[0].count); }
async function company() {
  const row = (await sql`select id, name, description from companies where id = ${companyId}`)[0];
  assert.ok(row); return { id: row.id, name: row.name, description: row.description };
}
try {
  console.log(output);
  const directory = owned('initial-data');
  const admin = await start(directory, true);
  phase = 'baseline-migrations';
  await ensurePostgresDatabase(admin.href, 'paperclip_fixture');
  const url = new URL(admin); url.pathname = '/paperclip_fixture';
  sql = connect(url.href, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  await migrate(drizzle(sql), { migrationsFolder: migrationDirectory });
  assert.equal(await countMigrations(), beforeJournal.entries.length);
  phase = 'baseline-data';
  await sql`insert into companies (id, name, description, issue_prefix) values (${companyId}, 'CityOS disposable compatibility fixture', 'Preserve this row across schema upgrade and cold restore', 'CFX')`;
  const original = await company();
  stages.push({ name: 'baseline-schema', migrations: await countMigrations(), passed: true });
  await stop();
  phase = 'cold-backup';
  const backup = owned('baseline-backup'); assert.equal(existsSync(backup), false);
  const originalTree = tree(directory); cpSync(directory, backup, { recursive: true, force: false, errorOnExist: true });
  assert.deepEqual(tree(backup), originalTree);
  stages.push({ name: 'verified-stopped-cluster-backup', files: Object.keys(originalTree).length, passed: true });
  const upgradedAdmin = await start(directory, false), upgraded = new URL(upgradedAdmin); upgraded.pathname = '/paperclip_fixture';
  phase = 'candidate-migrations';
  sql = connect(upgraded.href, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  await applyPendingMigrations(upgraded.href);
  assert.equal(await countMigrations(), afterJournal.entries.length); assert.deepEqual(await company(), original);
  await applyPendingMigrations(upgraded.href); assert.equal(await countMigrations(), afterJournal.entries.length);
  stages.push({ name: 'candidate-upgrade-and-idempotent-rerun', migrations: await countMigrations(), passed: true });
  await closeRegisteredClients(upgraded.href); await stop();
  const restored = owned('restored-data'); assert.equal(existsSync(restored), false);
  phase = 'cold-restore';
  cpSync(backup, restored, { recursive: true, force: false, errorOnExist: true }); assert.deepEqual(tree(restored), originalTree);
  // A hosted Windows runner copies with its elevated token. Restore explicit
  // access for the same user SID before pg_ctl restricts the child token; never
  // change machine users, the original database, or a shared directory ACL.
  const ownerSid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim();
  const permissions = spawnSync('icacls.exe', disposableRestoreAclArguments({ directory: realpathSync(restored), output: realpathSync(output), ownerSid }),
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(permissions.status, 0, 'Disposable restore owner access could not be established');
  assert.deepEqual(tree(restored), originalTree, 'Restore access preparation changed backup bytes');
  const restoreAdmin = await start(restored, false), restoreUrl = new URL(restoreAdmin); restoreUrl.pathname = '/paperclip_fixture';
  sql = connect(restoreUrl.href, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  assert.equal(await countMigrations(), beforeJournal.entries.length); assert.deepEqual(await company(), original);
  stages.push({ name: 'cold-restore-preserves-baseline-schema-and-data', migrations: await countMigrations(), passed: true });
  phase = 'restored-candidate-migrations';
  await applyPendingMigrations(restoreUrl.href); assert.equal(await countMigrations(), afterJournal.entries.length); assert.deepEqual(await company(), original);
  stages.push({ name: 'restored-backup-can-upgrade-again', migrations: await countMigrations(), passed: true });
  await closeRegisteredClients(restoreUrl.href); await stop();
  assert.deepEqual(sourceInputs(), observedSource, 'Database source changed during the rehearsal');
  writeFileSync(owned('receipt.json'), JSON.stringify({ schemaVersion: 'cityos.paperclip-database-rehearsal.v1',
    observedAt: new Date().toISOString(), baselineCommit: integration.baselineForkCommit, upstreamCommit: integration.upstream.commit,
    source: observedSource, sourceQualified: observedSource.dirty === false, lockSha256: sha(readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    node: process.versions.node, postgresVersion: execFileSync(postgres, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim(),
    postgresSha256: sha(readFileSync(postgres)), stages, success: true, passed: stages.length, failed: 0, skipped: 0,
    backupMode: 'stopped-cluster-physical-copy-same-postgres-major', startupOwner: 'native-pg-ctl-restricted-child', imageQualified: false, installationQualified: false, activationQualified: false,
    nonClaims: ['Disposable schema and cold-restore evidence only; no existing database was opened or changed.',
      'This does not qualify a PostgreSQL major-version upgrade, server image, installed adapter binding or production rollback.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ output, passed: stages.length, success: true }));
} catch (error) {
  // Keep diagnostics bounded: driver errors may contain connection strings.
  writeFileSync(owned('failure.json'), JSON.stringify({ phase, stages, success: false, errorName: error?.name ?? 'Error',
    errorCode: typeof error?.code === 'string' ? error.code : undefined, diagnostic: redact(error?.message ?? 'Unknown error'), nativeLogs,
    message: 'Disposable database rehearsal failed; no qualification receipt was created.' }, null, 2));
  console.error('Disposable database rehearsal failed: ' + output); process.exitCode = 1;
} finally {
  try { await stop(); } finally { unregister(); }
}
