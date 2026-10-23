import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const assembly = json(join(root, 'assembly.json'));
const source = process.argv[2], lockSha256 = process.argv[3];
assert.match(source ?? '', /^[a-f0-9]{40}$/u);
assert.equal(assembly.distributionCommit, source);
assert.equal(sha(readFileSync(join(root, 'adapter.tgz'))), assembly.artifact.sha256);
const manifest = json(join(root, 'package/package.json'));
const { cityosArtifact, ...publicManifest } = manifest;
assert.deepEqual(publicManifest, json('/app/extensions/cityos-adapter/package.json'));
assert.equal(manifest.cityosArtifact.distributionCommit, source);
assert.deepEqual(manifest.cityosArtifact.sourceInputs, assembly.sourceInputs);
assert.equal(sha(readFileSync('/app/pnpm-lock.yaml')), lockSha256, 'image cannot silently resolve a different lock');
assert.equal(process.versions.node.split('.')[0], readFileSync('/app/.nvmrc', 'utf8').trim());
assert.equal(json('/app/server/dist/build-info.json').commit, source);
assert.equal(process.env.PAPERCLIP_BUILD_COMMIT, source);
for (const input of assembly.sourceInputs) {
  assert.equal(sha(readFileSync(join('/app', input.path))), input.sha256, input.path);
  if (!input.path.endsWith('/package.json')) assert.equal(sha(readFileSync(join(root, 'package', input.path.split('/').at(-1)))), input.sha256);
}
const requireServer = createRequire('/app/server/package.json');
const loaderLog = execFileSync(process.execPath, [requireServer.resolve('tsx/cli'), '/app/extensions/cityos-adapter/qualify-loader.ts', join(root, 'package')], { cwd: '/app', encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
const loaded = loaderLog.split(/\r?\n/u).flatMap(line => { try { const data = JSON.parse(line); return data.schemaVersion === 'cityos.paperclip-real-loader-check.v1' ? [data] : []; } catch { return []; } });
assert.equal(loaded.length, 1); assert.equal(loaded[0].passed, 6); assert.equal(loaded[0].failed, 0); assert.equal(loaded[0].skipped, 0);
const files = ['server/dist-runtime/index.mjs', 'server/dist/build-info.json', 'ui/dist/index.html'];
const assets = files.map(path => { assert.ok(statSync(join('/app', path)).size > 0); return { path, sha256: sha(readFileSync(join('/app', path))) }; });
console.log(JSON.stringify({ schemaVersion: 'cityos.paperclip-image-probe.v1', source, lockSha256, adapterSha256: assembly.artifact.sha256, node: process.version, assets, loader: loaded[0], installedBindingQualified: false }));
