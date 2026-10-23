import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// This executable runs under the actual selected Paperclip server's tsx and
// dependencies. It never reads or writes the user's default adapter registry.
const packageRoot = resolve(process.argv[2]);
process.env.NODE_ENV = 'production';
const { loadExternalAdapterPackage, getUiParserSource } = await import('../../server/src/adapters/plugin-loader.js');
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@cityos-core/paperclip-adapter');
const adapter = await loadExternalAdapterPackage(manifest.name, packageRoot);
assert.equal(adapter.type, 'cityos_governed');
assert.equal(typeof adapter.execute, 'function');
assert.equal(typeof adapter.testEnvironment, 'function');
assert.equal((await adapter.testEnvironment({ companyId: 'qualification-fixture', adapterType: adapter.type, config: {} })).status, 'fail');
const parser = getUiParserSource(adapter.type);
assert.equal(parser, readFileSync(resolve(packageRoot, 'ui-parser.mjs'), 'utf8'));
console.log(JSON.stringify({ schemaVersion: 'cityos.paperclip-real-loader-check.v1', passed: 6, failed: 0, skipped: 0,
  adapterType: adapter.type, parserSha256: createHash('sha256').update(parser!).digest('hex'), installedBindingQualified: false }));
