import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const suites = ['authz-company-access', 'agent-auth-jwt', 'agent-auth-middleware', 'agent-run-authentication',
  'agent-cross-tenant-authz-routes', 'adapter-registry', 'adapter-routes-authz', 'startup-refusals'];

export function verifyServerContracts(result, platform) {
  assert.ok(platform === 'linux' || platform === 'windows');
  // The embedded-postgres authentication projection is executed on the supported
  // Linux runner. Windows has its independent native database/restore rehearsal.
  const expected = suites.filter(name => platform === 'linux' || name !== 'agent-run-authentication');
  const count = platform === 'linux' ? 140 : 137;
  assert.equal(result.success, true);
  assert.equal(result.numTotalTests, count);
  assert.equal(result.numPassedTests, count);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0);
  assert.equal(result.testResults.length, expected.length);
  const observed = new Set();
  let assertions = 0;
  for (const suite of result.testResults) {
    assert.equal(suite.status, 'passed');
    const ref = suite.name.replaceAll('\\', '/');
    const name = expected.find(value => ref.endsWith('/server/src/__tests__/' + value + '.test.ts'));
    assert.ok(name && !observed.has(name), 'Missing, unexpected or duplicate server suite');
    observed.add(name);
    assert.ok(suite.assertionResults.length > 0);
    for (const test of suite.assertionResults) {
      assert.equal(test.status, 'passed', 'Required server cases cannot skip or remain pending');
      assertions++;
    }
  }
  assert.equal(assertions, count);
  assert.deepEqual([...observed].sort(), [...expected].sort());
  return { suites: expected.length, passed: assertions, failed: 0, skipped: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4);
  console.log(JSON.stringify(verifyServerContracts(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3])));
}
