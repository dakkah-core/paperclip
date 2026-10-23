import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImageProbe, validateImageDerivation } from './qualify-image.mjs';

test('a run-owned Docker tag cannot substitute different base image layers or platform', () => {
  const base = { Id: 'sha256:' + 'a'.repeat(64), Os: 'linux', Architecture: 'amd64', RootFS: { Layers: ['layer-a', 'layer-b'] } };
  const good = { ...base, Id: 'sha256:' + 'b'.repeat(64), RootFS: { Layers: [...base.RootFS.Layers, 'adapter-layer'] } };
  assert.doesNotThrow(() => validateImageDerivation(base, good));
  for (const edit of [{ RootFS: { Layers: ['other-base', 'adapter-layer'] } }, { Architecture: 'arm64' }, { Id: 'latest' }]) {
    assert.throws(() => validateImageDerivation(base, { ...good, ...edit }));
  }
});

test('image qualification refuses stale source, altered payload, changed dependencies and incomplete loader checks', () => {
  const expected = { source: 'a'.repeat(40), lockSha256: 'b'.repeat(64), adapterSha256: 'c'.repeat(64) };
  const good = { schemaVersion: 'cityos.paperclip-image-probe.v1', ...expected, installedLockSha256: expected.lockSha256, installedBindingQualified: false,
    loader: { passed: 6, failed: 0, skipped: 0 }, assets: ['server/dist-runtime/index.mjs', 'server/dist/build-info.json', 'ui/dist/index.html'].map(path => ({ path, sha256: 'd'.repeat(64) })) };
  assert.doesNotThrow(() => validateImageProbe(good, expected));
  for (const edit of [{ source: 'e'.repeat(40) }, { lockSha256: 'e'.repeat(64) }, { adapterSha256: 'e'.repeat(64) },
    { installedLockSha256: 'e'.repeat(64) }, { loader: { passed: 5, failed: 0, skipped: 1 } }, { assets: good.assets.slice(1) }, { installedBindingQualified: true }]) {
    assert.throws(() => validateImageProbe({ ...good, ...edit }, expected));
  }
});
