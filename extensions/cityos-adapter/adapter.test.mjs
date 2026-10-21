import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServerAdapter, installCityosAdapterRuntime, compatibility, operationIdFor } from './index.mjs';
import { parseStdoutLine } from './ui-parser.mjs';

const binding = { tenantId: 'tenant', instanceRef: 'instance', companyId: 'company', agentId: 'agent', issueId: 'issue', bindingRef: 'binding', workRef: 'work', workVersion: 'v1' };
const context = signal => ({ runId: 'run', agent: { id: 'agent', companyId: 'company' }, context: { taskId: 'issue' }, signal,
  onLog: async () => {}, onCancellationReady: async () => {} });
function fixture(overrides = {}) {
  const calls = [], controller = new AbortController();
  const id = operationIdFor({ ...binding, runId: 'run' });
  const view = state => ({ schemaVersion: 'cityos.paperclip-execution.v1', executionRef: 'execution', operationId: id,
    instanceRef: 'instance', companyId: 'company', agentId: 'agent', issueId: 'issue', runId: 'run',
    bindingRef: 'binding', workRef: 'work', workVersion: 'v1', state,
    ...(['completed', 'cancelled', 'denied', 'failed'].includes(state) ? { receipt: { receiptRef: 'receipt', state, usage: { inputTokens: 12, outputTokens: 3 } } } : {}) });
  let inquiries = 0;
  const runtime = { tenantId: 'tenant', instanceRef: 'instance', companyId: 'company', compatibility,
    isCurrent: async () => true, executionQualified: async () => true, resolveWork: async () => binding, wait: async () => {}, maxPolls: 3,
    client: { submitExecution: async intent => { calls.push(['submit', intent]); return view('queued'); },
      readExecution: async ref => { calls.push(['read', ref]); if (++inquiries === 1) throw Error('PAPERCLIP_ENGINEERING_HTTP_404'); return view('completed'); },
      cancelExecution: async (ref, operationId) => { calls.push(['cancel', ref, operationId]); return view('cancelled'); } }, ...overrides };
  return { calls, controller, runtime, view, id };
}

test('missing or incompatible runtime cannot dispatch or claim completion', async () => {
  const adapter = createServerAdapter();
  assert.equal((await adapter.testEnvironment({ companyId: 'company' })).status, 'fail');
  assert.equal((await adapter.execute(context())).exitCode, null);
  const f = fixture({ compatibility: { ...compatibility, adapterUtilsVersion: 'other' } });
  assert.throws(() => installCityosAdapterRuntime(f.runtime), /Compatible/);
});
test('acceptance is polled to a terminal receipt, with final per-run usage only', async () => {
  const f = fixture(), withdraw = installCityosAdapterRuntime(f.runtime);
  try {
    const result = await createServerAdapter().execute(context());
    assert.equal(result.exitCode, 0); assert.equal(result.resultJson.receiptRef, 'receipt');
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3 });
    assert.deepEqual(f.calls.map(call => call[0]), ['read', 'submit', 'read']);
  } finally { withdraw(); }
});
test('an ambiguous submit recovers by original operation without a second submission', async () => {
  const f = fixture(); f.runtime.client.submitExecution = async intent => { f.calls.push(['submit', intent]); throw Error('private transport header'); };
  const withdraw = installCityosAdapterRuntime(f.runtime);
  try {
    const result = await createServerAdapter().execute(context());
    assert.equal(result.exitCode, 0); assert.equal(f.calls.filter(call => call[0] === 'submit').length, 1);
    assert.deepEqual(f.calls[2], ['read', f.id]); assert.doesNotMatch(JSON.stringify(result), /private transport/);
  } finally { withdraw(); }
});
test('company mismatch, forged work and withdrawn authority make zero dispatches', async () => {
  for (const runtime of [fixture({ companyId: 'other' }), fixture({ resolveWork: async () => ({ ...binding, tenantId: 'other' }) }), fixture({ isCurrent: async () => false }), fixture({ executionQualified: async () => false })]) {
    const withdraw = installCityosAdapterRuntime(runtime.runtime);
    try { const result = await createServerAdapter().execute(context()); assert.equal(result.exitCode, null); assert.equal(runtime.calls.filter(call => call[0] === 'submit').length, 0); }
    finally { withdraw(); }
  }
});
test('cancellation is requested with its stable identity and confirmed by owner receipt', async () => {
  const f = fixture(); f.runtime.client.submitExecution = async intent => { f.calls.push(['submit', intent]); f.controller.abort(); return f.view('running'); };
  const withdraw = installCityosAdapterRuntime(f.runtime);
  try {
    const result = await createServerAdapter().execute(context(f.controller.signal));
    assert.equal(result.exitCode, 130); assert.equal(result.resultJson.receiptRef, 'receipt');
    assert.deepEqual(f.calls[2], ['cancel', 'execution', f.id + '-cancel']);
  } finally { withdraw(); }
});
test('restart recovers the frozen original run before mutable issue/work bindings can create another intent', async () => {
  const f = fixture(); let resolutions = 0;
  f.runtime.resolveWork = async () => { resolutions++; return { ...binding, workVersion: 'v2' }; };
  f.runtime.client.readExecution = async ref => { f.calls.push(['read', ref]); return f.view('completed'); };
  const withdraw = installCityosAdapterRuntime(f.runtime);
  try {
    const result = await createServerAdapter().execute(context());
    assert.equal(result.exitCode, 0); assert.equal(result.resultJson.workVersion, 'v1'); assert.equal(resolutions, 0);
    assert.equal(f.calls.filter(call => call[0] === 'submit').length, 0);
  } finally { withdraw(); }
});
test('missing receipt, never-terminal acknowledgement and wrong-operation readback cannot complete', async () => {
  for (const state of ['missing-receipt', 'nonterminal', 'wrong-operation']) {
    const f = fixture(); f.runtime.client.readExecution = async () => state === 'nonterminal' ? f.view('queued')
      : state === 'missing-receipt' ? { ...f.view('completed'), receipt: undefined } : { ...f.view('completed'), operationId: 'other' };
    const withdraw = installCityosAdapterRuntime(f.runtime);
    try { const result = await createServerAdapter().execute(context()); assert.equal(result.exitCode, null); }
    finally { withdraw(); }
  }
});
test('the browser parser ignores oversized, malformed and arbitrary output', () => {
  for (const line of ['bad', 'x'.repeat(8193), '{"message":"private credential"}', '{"schemaVersion":"cityos.paperclip-progress.v1","state":"completed"}']) assert.deepEqual(parseStdoutLine(line, 'now'), []);
  assert.deepEqual(parseStdoutLine('{"schemaVersion":"cityos.paperclip-progress.v1","state":"running","extra":"private"}', 'now'), [{ kind: 'system', ts: 'now', text: 'CityOS execution: running' }]);
});
