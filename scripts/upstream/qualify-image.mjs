import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, createReadStream, createWriteStream, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { verifyIntegration, captureSourceIdentity } from './integration.mjs';
import { packCityosAdapter } from './pack-cityos-adapter.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const docker = args => execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const imageId = value => { assert.match(value, /^sha256:[a-f0-9]{64}$/u); return value; };
export function validateImageProbe(probe, expected) {
  assert.equal(probe?.schemaVersion, 'cityos.paperclip-image-probe.v1');
  for (const key of ['source', 'lockSha256', 'adapterSha256']) assert.equal(probe[key], expected[key], key);
  assert.equal(probe.installedLockSha256, expected.lockSha256);
  assert.equal(probe.loader?.passed, 6); assert.equal(probe.loader.failed, 0); assert.equal(probe.loader.skipped, 0);
  assert.equal(probe.installedBindingQualified, false);
  assert.deepEqual(probe.assets?.map(asset => asset.path).sort(), ['server/dist-runtime/index.mjs', 'server/dist/build-info.json', 'ui/dist/index.html'].sort());
  for (const asset of probe.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
}
export function validateImageDerivation(base, candidate) {
  imageId(base.Id); imageId(candidate.Id);
  assert.equal(candidate.Os, base.Os); assert.equal(candidate.Architecture, base.Architecture);
  assert.ok(base.RootFS?.Layers?.length > 0);
  assert.deepEqual(candidate.RootFS?.Layers?.slice(0, base.RootFS.Layers.length), base.RootFS.Layers,
    'The adapter image must derive from the exact built upstream image');
}
async function digestFile(file) { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); }
async function logged(command, args, file, cwd = root) {
  const fd = openSync(file, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', fd, fd] });
      child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error('Qualification command failed; consult the retained log digest')));
    });
  } finally { closeSync(fd); }
}
async function eventually(check, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { return await check(); } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  throw Error('Disposable image readiness deadline exceeded');
}
export async function qualifyImage() {
  assert.equal(process.platform, 'linux', 'Linux image qualification requires the owning Linux CI runner');
  assert.equal(process.versions.node.split('.')[0], readFileSync(join(root, '.nvmrc'), 'utf8').trim());
  assert.equal(process.env.CI, 'true', 'Use the isolated CI runner for this stateful image build');
  const context = JSON.parse(docker(['context', 'inspect']))[0];
  assert.match(context.Endpoints.docker.Host, /^unix:\/\//u, 'Never target a remote Docker daemon');
  assert.equal(docker(['info', '--format', '{{.OSType}}']), 'linux');
  const source = verifyIntegration(root); assert.deepEqual(source.errors, []); assert.equal(source.dirty, false);
  const expected = { source: source.sourceSha, lockSha256: sha(readFileSync(join(root, 'pnpm-lock.yaml'))) };
  const parent = join(root, '.build/upstream'); mkdirSync(parent, { recursive: true });
  const output = mkdtempSync(join(parent, 'paperclip-image-')), sealed = join(output, 'source'), layer = join(output, 'layer');
  mkdirSync(sealed); mkdirSync(layer);
  const nonce = 'cityos-paperclip-' + randomUUID(), owned = [];
  let networkCreated = false, cleanupComplete = false, base, candidate, probe, health, failure, stage = 'source-archive';
  const baseTag = nonce + ':base';
  const logs = [];
  const runLogged = async (name, command, args, cwd) => { const file = join(output, name + '.log'); logs.push(file); return logged(command, args, file, cwd); };
  try {
    // Build only committed Git objects, never ignored host replacements or growing build logs.
    const archive = join(output, 'source.tar');
    await runLogged('archive', 'git', ['archive', '--format=tar', '--output', archive, source.sourceSha]);
    await runLogged('extract', 'tar', ['-xf', archive, '-C', sealed]);
    const assembly = packCityosAdapter(); expected.adapterSha256 = assembly.artifact.sha256;
    copyFileSync(assembly.artifact.path, join(layer, 'adapter.tgz'));
    writeFileSync(join(layer, 'assembly.json'), JSON.stringify(assembly));
    for (const file of ['Dockerfile', 'image-probe.mjs']) copyFileSync(join(sealed, 'extensions/cityos-adapter', file), join(layer, file));
    stage = 'base-build';
    await runLogged('base-build', 'docker', ['build', '--target', 'production', '--build-arg', 'PAPERCLIP_BUILD_COMMIT=' + source.sourceSha, '--label', 'org.opencontainers.image.revision=' + source.sourceSha, '--iidfile', join(output, 'base.iid'), sealed]);
    base = imageId(readFileSync(join(output, 'base.iid'), 'utf8').trim());
    // Dockerfile FROM interprets a bare sha256 ID as a registry name. Give the
    // exact local image a run-owned tag, then verify both the tag and layer ancestry.
    docker(['image', 'tag', base, baseTag]);
    assert.equal(JSON.parse(docker(['image', 'inspect', baseTag]))[0].Id, base);
    stage = 'adapter-image-build';
    await runLogged('adapter-image-build', 'docker', ['build', '--build-arg', 'PAPERCLIP_BASE_IMAGE=' + baseTag, '--label', 'org.opencontainers.image.revision=' + source.sourceSha, '--label', 'cityos.paperclip.adapter.sha256=' + expected.adapterSha256, '--iidfile', join(output, 'candidate.iid'), layer]);
    candidate = imageId(readFileSync(join(output, 'candidate.iid'), 'utf8').trim());
    const inspected = JSON.parse(docker(['image', 'inspect', candidate]))[0];
    assert.equal(JSON.parse(docker(['image', 'inspect', baseTag]))[0].Id, base);
    validateImageDerivation(JSON.parse(docker(['image', 'inspect', base]))[0], inspected);
    assert.equal(inspected.Os, 'linux'); assert.equal(inspected.Config.Labels['org.opencontainers.image.revision'], source.sourceSha);
    assert.equal(inspected.Config.Labels['cityos.paperclip.adapter.sha256'], expected.adapterSha256);
    stage = 'artifact-probe';
    await runLogged('artifact-probe', 'docker', ['run', '--rm', '--network', 'none', '--label', 'cityos.qualification=' + nonce, '--entrypoint', 'node', candidate, '/opt/cityos/paperclip-adapter/image-probe.mjs', source.sourceSha, expected.lockSha256]);
    const probeLines = readFileSync(join(output, 'artifact-probe.log'), 'utf8').split(/\r?\n/u);
    const probes = probeLines.flatMap(line => { try { const item = JSON.parse(line); return item.schemaVersion === 'cityos.paperclip-image-probe.v1' ? [item] : []; } catch { return []; } });
    assert.equal(probes.length, 1); probe = probes[0]; validateImageProbe(probe, expected);
    stage = 'database-readiness';
    docker(['network', 'create', '--internal', '--label', 'cityos.qualification=' + nonce, nonce]); networkCreated = true;
    docker(['pull', 'postgres:18.1-trixie']);
    const databaseImage = imageId(JSON.parse(docker(['image', 'inspect', 'postgres:18.1-trixie']))[0].Id);
    const database = nonce + '-db'; owned.push(database);
    docker(['run', '-d', '--name', database, '--network', nonce, '--network-alias', 'database', '--label', 'cityos.qualification=' + nonce, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=qualification', databaseImage]);
    await eventually(() => docker(['exec', database, 'pg_isready', '-U', 'postgres', '-d', 'qualification']));
    stage = 'server-startup';
    const server = nonce + '-server'; owned.push(server);
    docker(['run', '-d', '--name', server, '--network', nonce, '--label', 'cityos.qualification=' + nonce,
      '-e', 'HOST=127.0.0.1', '-e', 'PAPERCLIP_DEPLOYMENT_MODE=local_trusted', '-e', 'PAPERCLIP_DEPLOYMENT_EXPOSURE=private',
      '-e', 'DATABASE_URL=postgresql://postgres@database:5432/qualification', '-e', 'PAPERCLIP_MIGRATION_AUTO_APPLY=true', candidate]);
    health = await eventually(() => {
      const raw = docker(['exec', server, 'node', '--input-type=module', '-e', "const r=await fetch('http://127.0.0.1:3100/api/health');if(r.status!==200)throw Error('not ready');const h=await r.json();if(h.status!=='ok')throw Error('not ready');console.log(JSON.stringify({status:h.status,commit:h.commit}));"]);
      const result = JSON.parse(raw); assert.equal(result.commit, source.sourceSha); return result;
    });
    await runLogged('runtime-logs', 'docker', ['logs', server]);
    // Save this exact tested image. A future publication must import it, not rebuild it.
    stage = 'image-export';
    const saved = join(output, 'image.tar.gz'), saveLog = join(output, 'save.log'), fd = openSync(saveLog, 'w'); logs.push(saveLog);
    try {
      const child = spawn('docker', ['image', 'save', candidate], { stdio: ['ignore', 'pipe', fd] });
      const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error('Image save failed'))); });
      const results = await Promise.allSettled([pipeline(child.stdout, createGzip({ level: 1 }), createWriteStream(saved)), done]);
      for (const item of results) if (item.status === 'rejected') throw item.reason;
    } finally { closeSync(fd); }
    expected.savedImageSha256 = await digestFile(saved);
    stage = 'source-recheck';
    assert.deepEqual(captureSourceIdentity(root), { sourceSha: source.sourceSha, sourceDigest: source.sourceDigest, dirty: false });
  } catch (error) { failure = error; }
  finally {
    const failures = [];
    for (const name of owned.reverse()) {
      try {
        const labels = JSON.parse(docker(['inspect', '--format', '{{json .Config.Labels}}', name]));
        assert.equal(labels['cityos.qualification'], nonce); docker(['rm', '-f', '-v', name]);
      } catch (error) { failures.push(error); }
    }
    if (networkCreated) try { docker(['network', 'rm', nonce]); } catch (error) { failures.push(error); }
    if (base) try { assert.equal(JSON.parse(docker(['image', 'inspect', baseTag]))[0].Id, base); docker(['image', 'rm', baseTag]); } catch (error) { failures.push(error); }
    try { assert.equal(docker(['ps', '-aq', '--filter', 'label=cityos.qualification=' + nonce]), ''); assert.equal(docker(['network', 'ls', '-q', '--filter', 'label=cityos.qualification=' + nonce]), ''); } catch (error) { failures.push(error); }
    cleanupComplete = failures.length === 0;
    if (!cleanupComplete && !failure) failure = Error('Disposable image resources were not fully removed');
  }
  const receipt = { schemaVersion: 'cityos.paperclip-image-qualification.v1', recordedAt: new Date().toISOString(), source, expected, baseImageId: base, imageId: candidate, stage, probe, health,
    logs: await Promise.all(logs.map(async path => ({ name: path.split('/').at(-1), sha256: await digestFile(path) }))), cleanupComplete,
    success: !failure && cleanupComplete, error: failure ? 'Image qualification failed; retained logs identify the exact stage' : undefined,
    installedBindingQualified: false, planningQualified: false, executionQualified: false, registryPublicationQualified: false, activationQualified: false };
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ output, receipt })); return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = (await qualifyImage()).success ? 0 : 1;
