import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { owningNpm } from './owning-npm.mjs';

test('packing uses the selected Windows or POSIX Node distribution and refuses an ambient fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'paperclip-owning-npm-'));
  try {
    for (const layout of ['windows', 'posix', 'missing']) {
      const executable = join(root, layout, 'bin/node');
      mkdirSync(dirname(executable), { recursive: true }); writeFileSync(executable, 'fixture');
      if (layout === 'missing') { assert.throws(() => owningNpm(executable), /own npm/); continue; }
      const cli = join(root, layout, layout === 'windows' ? 'bin/node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
      mkdirSync(dirname(cli), { recursive: true }); writeFileSync(cli, 'fixture');
      assert.equal(owningNpm(executable).replaceAll('\\', '/'), cli.replaceAll('\\', '/'));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
