import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
const sourcePrefix = 'extensions/cityos-adapter/';
export function packCityosAdapter() {
  if (process.versions.node.split('.')[0] !== readFileSync(join(root, '.nvmrc'), 'utf8').trim()) throw Error('Select the owning Paperclip Node major before packing');
  if (git(['status', '--porcelain=v1', '--untracked-files=all']).length) throw Error('Commit the scoped adapter source before packing; do not include unrelated work');
  const distributionCommit = git(['rev-parse', 'HEAD']).toString().trim();
  const integration = JSON.parse(git(['show', `${distributionCommit}:config/upstream/integration.json`]));
  git(['merge-base', '--is-ancestor', integration.upstream.commit, distributionCommit]);
  const parent = join(root, '.build/upstream'); mkdirSync(parent, { recursive: true });
  const output = mkdtempSync(join(parent, 'paperclip-adapter-')), stage = join(output, 'stage'); mkdirSync(stage);
  const inputs = [];
  // Read immutable Git objects, so assembly cannot accidentally consume an
  // ignored working-tree replacement or a concurrently changed source file.
  for (const file of ['index.mjs', 'index.d.mts', 'ui-parser.mjs', 'README.md']) {
    const path = sourcePrefix + file, bytes = git(['show', `${distributionCommit}:${path}`]);
    writeFileSync(join(stage, file), bytes); inputs.push({ path, sha256: sha(bytes) });
  }
  const manifestBytes = git(['show', `${distributionCommit}:${sourcePrefix}package.json`]);
  inputs.push({ path: sourcePrefix + 'package.json', sha256: sha(manifestBytes) });
  const manifest = JSON.parse(manifestBytes);
  manifest.cityosArtifact = { distributionCommit, sourceInputs: inputs, upstream: integration.upstream };
  writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw Error('Selected Node distribution must include its npm pack tool');
  const packed = spawnSync(process.execPath, [npm, 'pack', stage, '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, encoding: 'utf8', windowsHide: true });
  writeFileSync(join(output, 'pack.log'), (packed.stdout ?? '') + (packed.stderr ?? ''));
  if (packed.status !== 0) throw Error('Adapter pack failed; inspect the local pack log');
  const report = JSON.parse(packed.stdout), name = report[0]?.filename;
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) throw Error('Unexpected packed artifact path');
  const archive = join(output, name);
  const receipt = { schemaVersion: 'cityos.paperclip-adapter-package.v1', distributionCommit, sourceInputs: inputs,
    upstream: integration.upstream, nodeVersion: process.version, artifact: { path: archive, sha256: sha(readFileSync(archive)), package: manifest.name, version: manifest.version },
    qualification: false, nonClaims: ['Packing does not qualify the real external loader, installed CityOS endpoints, Paperclip image or database upgrade.'] };
  writeFileSync(join(output, 'assembly.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(packCityosAdapter(), null, 2));
