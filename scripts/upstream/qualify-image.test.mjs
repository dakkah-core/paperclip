import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImageProbe } from './qualify-image.mjs';

test('image qualification refuses stale source, altered payload, changed dependencies and incomplete loader checks', () => {
  const expected = { source: 'a'.repeat(40), lockSha256: 'b'.repeat(64), adapterSha256: 'c'.repeat(64) };
  const good = { schemaVersion: 'cityos.paperclip-image-probe.v1', ...expected, installedBindingQualified: false,
    loader: { passed: 6, failed: 0, skipped: 0 }, assets: ['server/dist-runtime/index.mjs', 'server/dist/build-info.json', 'ui/dist/index.html'].map(path => ({ path, sha256: 'd'.repeat(64) })) };
  assert.doesNotThrow(() => validateImageProbe(good, expected));
  for (const edit of [{ source: 'e'.repeat(40) }, { lockSha256: 'e'.repeat(64) }, { adapterSha256: 'e'.repeat(64) },
    { loader: { passed: 5, failed: 0, skipped: 1 } }, { assets: good.assets.slice(1) }, { installedBindingQualified: true }]) {
    assert.throws(() => validateImageProbe({ ...good, ...edit }, expected));
  }
});
