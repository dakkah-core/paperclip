import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.versions.node.split('.')[0], readFileSync(join(root, '.nvmrc'), 'utf8').trim());
const baseline = '6303491bafc75c7d5d893c88a80aff5c31b42275';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { windowsHide: true });
const parent = join(root, '.build/upstream'); mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, 'paperclip-regression-')), prior = join(output, 'before'); mkdirSync(prior);
const tests = readFileSync(join(root, 'extensions/cityos-adapter/adapter.test.mjs'));
const implementation = readFileSync(join(root, 'extensions/cityos-adapter/index.mjs'));
const old = git(['show', baseline + ':extensions/cityos-adapter/index.mjs']);
writeFileSync(join(prior, 'index.mjs'), old);
writeFileSync(join(prior, 'adapter.test.mjs'), tests);
writeFileSync(join(prior, 'ui-parser.mjs'), git(['show', baseline + ':extensions/cityos-adapter/ui-parser.mjs']));

const checks = [];
function run(name, file) {
  const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap', file],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout ?? '') + (result.stderr ?? ''), logPath = join(output, name + '.log');
  writeFileSync(logPath, log);
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(label => {
    const match = log.match(new RegExp('^# ' + label + ' (\\d+)\\s*$', 'm'));
    assert.ok(match, 'Actual test counts are required: ' + name + '/' + label);
    return [label, Number(match[1])];
  }));
  const failedNames = [...log.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]);
  const check = { name, exitCode: result.status, error: result.error?.code, counts, failedNames,
    logPath, logSha256: sha(Buffer.from(log)) };
  checks.push(check);
  assert.equal(result.error, undefined);
  for (const key of ['cancelled', 'skipped', 'todo']) assert.equal(counts[key], 0);
  return check;
}
let success = false, failure;
try {
  const before = run('before', join(prior, 'adapter.test.mjs'));
  assert.equal(before.exitCode, 1); assert.equal(before.counts.fail, 4);
  assert.deepEqual(before.failedNames, [
    'ambiguous cancellation is replayed with the same identity until the owner confirms it',
    'installed client methods cannot be replaced by mutating the bootstrap object',
    'only literal owner acknowledgements qualify diagnostics or execution',
    'work coordinates are captured before a later asynchronous scope recheck',
  ]);
  const after = run('after', join(root, 'extensions/cityos-adapter/adapter.test.mjs'));
  assert.equal(after.exitCode, 0); assert.equal(after.counts.fail, 0);
  assert.ok(after.counts.pass >= 12); assert.equal(after.counts.tests, before.counts.tests);
  assert.equal(before.counts.pass + before.counts.fail, after.counts.pass);
  assert.equal(sha(readFileSync(join(root, 'extensions/cityos-adapter/index.mjs'))), sha(implementation));
  assert.equal(sha(readFileSync(join(root, 'extensions/cityos-adapter/adapter.test.mjs'))), sha(tests));
  success = true;
} catch (error) { failure = String(error.message).slice(0, 2000); }
writeFileSync(join(output, 'receipt.json'), JSON.stringify({ schemaVersion: 'cityos.paperclip-adapter-regressions.v1',
  sourceCommit: git(['rev-parse', 'HEAD']).toString().trim(), baseline, baselineImplementationSha256: sha(old),
  implementationSha256: sha(implementation), testSha256: sha(tests), nodeVersion: process.version, checks, success, failure,
  installedOwnerQualified: false, imageQualified: false,
  nonClaims: ['These real-module regressions use owner port fixtures. They do not qualify installed owners, transport delivery or runtime activation.'] }, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(output), success, failure, checks: checks.map(({ name, exitCode, counts }) => ({ name, exitCode, counts })) }));
process.exitCode = success ? 0 : 1;
