import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyServerContracts } from './server-contract-receipt.mjs';

const names = ['authz-company-access', 'agent-auth-jwt', 'agent-auth-middleware', 'agent-run-authentication',
  'agent-cross-tenant-authz-routes', 'adapter-registry', 'adapter-routes-authz', 'startup-refusals'];
function fixture() {
  return { success: true, numTotalTests: 140, numPassedTests: 140, numFailedTests: 0, numPendingTests: 0,
    testResults: names.map((name, index) => ({ name: '/fixture/server/src/__tests__/' + name + '.test.ts', status: 'passed',
      assertionResults: Array.from({ length: index ? 1 : 133 }, () => ({ status: 'passed' })) })) };
}
test('complete required server results qualify their declared platform', () => {
  assert.deepEqual(verifyServerContracts(fixture(), 'linux'), { suites: 8, passed: 140, failed: 0, skipped: 0 });
});
test('green exit or totals cannot conceal a skipped, absent, duplicated or failed required case', () => {
  for (const change of [
    value => { value.testResults[3].assertionResults[0].status = 'pending'; },
    value => { value.testResults.pop(); },
    value => { value.testResults[3] = value.testResults[0]; },
    value => { value.numPendingTests = 3; },
    value => { value.success = false; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => verifyServerContracts(value, 'linux'));
  }
});
