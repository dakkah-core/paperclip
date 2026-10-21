import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function validatePackedManifest(manifest, sourceManifest, metadata) {
  if (canonical(manifest) !== canonical({ ...sourceManifest, cityosArtifact: metadata })) throw Error('Packed adapter manifest differs from the recorded assembly');
}
export async function qualifyCityosAdapter(archive) {
  archive = resolve(archive); const artifactSha256 = sha(readFileSync(archive));
  const parent = join(root, '.build/upstream'); mkdirSync(parent, { recursive: true });
  const output = mkdtempSync(join(parent, 'paperclip-loader-')), packageRoot = join(output, 'package'); mkdirSync(packageRoot);
  // Use the selected Node distribution's own npm archive reader. No ambient
  // package install, CLI adapter or replacement loader is permitted here.
  const npmRequire = createRequire(join(dirname(process.execPath), 'node_modules/npm/package.json'));
  const allowed = new Set(['index.mjs', 'index.d.mts', 'ui-parser.mjs', 'README.md', 'package.json']);
  await npmRequire('tar').x({ file: archive, cwd: packageRoot, strip: 1, strict: true, preservePaths: false,
    filter(path, entry) {
      if (!path.startsWith('package/') || path.includes('\\') || path.includes(':') || path.split('/').includes('..')
        || !['File', 'OldFile', 'Directory'].includes(entry.type)
        || entry.type === 'Directory' && path !== 'package/'
        || entry.type !== 'Directory' && !allowed.has(path.slice('package/'.length))) throw Error('Unsafe adapter archive');
      return true;
    } });
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const metadata = manifest.cityosArtifact;
  if (manifest.name !== '@cityos-core/paperclip-adapter' || !/^[a-f0-9]{40}$/u.test(metadata?.distributionCommit ?? '')) throw Error('Adapter assembly identity missing');
  const git = args => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
  if (git(['status', '--porcelain=v1', '--untracked-files=all']).length
    || git(['rev-parse', 'HEAD']).toString().trim() !== metadata.distributionCommit) throw Error('Real-loader qualification requires the exact clean distribution checkout');
  const integration = JSON.parse(git(['show', `${metadata.distributionCommit}:config/upstream/integration.json`]));
  const server = JSON.parse(git(['show', `${metadata.distributionCommit}:server/package.json`]));
  const utilities = JSON.parse(git(['show', `${metadata.distributionCommit}:packages/adapter-utils/package.json`]));
  if (manifest.peerDependencies['@paperclipai/server'] !== server.version || manifest.peerDependencies['@paperclipai/adapter-utils'] !== utilities.version
    || manifest.paperclip.hostSource !== integration.upstream.commit) throw Error('Adapter/host source compatibility differs');
  const sourceInputs = [];
  for (const file of ['index.mjs', 'index.d.mts', 'ui-parser.mjs', 'README.md']) {
    const expected = git(['show', `${metadata.distributionCommit}:extensions/cityos-adapter/${file}`]);
    sourceInputs.push({ path: 'extensions/cityos-adapter/' + file, sha256: sha(expected) });
    if (sha(readFileSync(join(packageRoot, file))) !== sha(expected)) throw Error('Packed implementation differs from the distribution source');
  }
  const originalManifest = git(['show', `${metadata.distributionCommit}:extensions/cityos-adapter/package.json`]);
  sourceInputs.push({ path: 'extensions/cityos-adapter/package.json', sha256: sha(originalManifest) });
  validatePackedManifest(manifest, JSON.parse(originalManifest), { distributionCommit: metadata.distributionCommit, sourceInputs, upstream: integration.upstream });
  const requireServer = createRequire(join(root, 'server/package.json'));
  let tsx;
  try { tsx = requireServer.resolve('tsx/cli'); } catch { throw Error('Install the selected Paperclip server dependencies before real-loader qualification; this check cannot skip or substitute them'); }
  const tests = git(['show', `${metadata.distributionCommit}:extensions/cityos-adapter/adapter.test.mjs`]).toString('utf8');
  const testPath = join(output, 'adapter.test.mjs');
  const fixture = tests.replace("from './index.mjs'", "from './package/index.mjs'").replace("from './ui-parser.mjs'", "from './package/ui-parser.mjs'");
  writeFileSync(testPath, fixture);
  const checks = [];
  for (const [name, args] of [
    ['packed-boundary-behavior', ['--test', '--test-reporter=tap', testPath]],
    ['real-external-loader', [tsx, join(root, 'extensions/cityos-adapter/qualify-loader.ts'), packageRoot]],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const logPath = join(output, name + '.log'); writeFileSync(logPath, (result.stdout ?? '') + (result.stderr ?? ''));
    const log = readFileSync(logPath, 'utf8');
    let passed = 0, failed = 1, skipped = 1;
    if (name === 'packed-boundary-behavior') {
      const count = label => Number([...log.matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gmu'))].at(-1)?.[1] ?? -1);
      passed = count('pass'); failed = count('fail'); skipped = count('skipped') + count('todo');
    } else {
      const report = log.split(/\r?\n/u).flatMap(line => { try { const value = JSON.parse(line); return value.schemaVersion === 'cityos.paperclip-real-loader-check.v1' ? [value] : []; } catch { return []; } }).at(-1);
      if (report) ({ passed, failed, skipped } = report);
    }
    checks.push({ name, exitCode: result.status, passed, failed, skipped, logPath, logSha256: sha(readFileSync(logPath)) });
  }
  const receipt = { schemaVersion: 'cityos.paperclip-adapter-loader-qualification.v1', distributionCommit: metadata.distributionCommit,
    artifact: { path: archive, sha256: artifactSha256 }, checks, fixtureSourceSha256: sha(Buffer.from(tests)), fixtureImportMappingSha256: sha(Buffer.from(fixture)),
    success: checks.every(check => check.exitCode === 0 && check.passed > 0 && check.failed === 0 && check.skipped === 0) && artifactSha256 === sha(readFileSync(archive)),
    installedBindingQualified: false, nonClaims: ['This loader check does not qualify planning/execution endpoints, image startup, database migration or activation.'] };
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: qualify-cityos-adapter.mjs <immutable adapter tarball>');
  const receipt = await qualifyCityosAdapter(process.argv[2]); console.log(JSON.stringify(receipt, null, 2)); process.exitCode = receipt.success ? 0 : 1;
}
