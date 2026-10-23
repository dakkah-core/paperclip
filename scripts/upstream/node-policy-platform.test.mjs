import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('the real Node policy accepts its declared release-producer exception on this platform', () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../check-node-version-policy.mjs', import.meta.url))],
    { encoding: 'utf8', windowsHide: true });
  assert.match(output, /Node version policy check passed/u);
});
