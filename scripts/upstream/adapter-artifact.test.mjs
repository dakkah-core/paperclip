import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackedManifest } from './qualify-cityos-adapter.mjs';

test('the packed manifest cannot change public execution entries, lifecycle hooks or source identities', () => {
  const source = { name: '@cityos-core/paperclip-adapter', exports: { '.': './index.mjs' }, peerDependencies: { '@paperclipai/server': '0.3.1' } };
  const metadata = { distributionCommit: 'a'.repeat(40), sourceInputs: [{ path: 'index.mjs', sha256: 'b'.repeat(64) }] };
  const good = { ...source, cityosArtifact: metadata };
  assert.doesNotThrow(() => validatePackedManifest(good, source, metadata));
  for (const edit of [{ exports: { '.': './replacement.mjs' } }, { scripts: { postinstall: 'unexpected' } },
    { cityosArtifact: { ...metadata, distributionCommit: 'c'.repeat(40) } }]) {
    assert.throws(() => validatePackedManifest({ ...good, ...edit }, source, metadata), /differs/);
  }
});
