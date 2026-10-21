import { createHash } from 'node:crypto';

export const type = 'cityos_governed';
export const label = 'CityOS governed execution';
export const compatibility = Object.freeze({ contract: 'cityos.paperclip-integration.v1', adapterUtilsVersion: '0.3.1',
  serverVersion: '0.3.1', hostSource: '6dda8cc2b75e211dc62af264bfd0994f602099d1' });
let installed = null;
const reference = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/u.test(value);

/** Trusted server startup only. Config, prompts and issue metadata cannot install
 * a credential provider, tenant binding, runtime or qualification. */
export function installCityosAdapterRuntime(runtime) {
  if (installed) throw Error('CityOS adapter runtime is already installed');
  if (!runtime || !reference(runtime.tenantId) || !reference(runtime.instanceRef) || !reference(runtime.companyId)
    || typeof runtime.resolveWork !== 'function' || typeof runtime.isCurrent !== 'function' || typeof runtime.executionQualified !== 'function'
    || !runtime.client || ['submitExecution', 'readExecution', 'cancelExecution'].some(name => typeof runtime.client[name] !== 'function')
    || Object.entries(compatibility).some(([key, value]) => runtime.compatibility?.[key] !== value)) throw Error('Compatible CityOS runtime bindings are required');
  installed = Object.freeze({ ...runtime });
  const captured = installed;
  return () => { if (installed === captured) installed = null; };
}

export const operationIdFor = input => 'paperclip-' + createHash('sha256').update(JSON.stringify([compatibility.contract,
  input.instanceRef, input.companyId, input.agentId, input.runId])).digest('hex');

const unavailable = code => ({ exitCode: null, signal: null, timedOut: false, errorCode: code,
  errorMessage: code, errorFamily: 'configuration', summary: 'CityOS execution is unavailable; retain the original run identity.' });
function validView(view, binding, operationId) {
  if (view?.schemaVersion !== 'cityos.paperclip-execution.v1' || !reference(view.executionRef) || view.operationId !== operationId
    || view.instanceRef !== binding.instanceRef || view.companyId !== binding.companyId || view.agentId !== binding.agentId
    || view.issueId !== binding.issueId || view.runId !== binding.runId
    || view.bindingRef !== binding.bindingRef || view.workRef !== binding.workRef || view.workVersion !== binding.workVersion
    || !['queued', 'running', 'completed', 'failed', 'cancelled', 'denied'].includes(view.state)) throw Error('CITYOS_EXECUTION_CORRELATION_MISMATCH');
  const terminal = ['completed', 'failed', 'cancelled', 'denied'].includes(view.state);
  if (terminal && (!view.receipt || !reference(view.receipt.receiptRef) || view.receipt.state !== view.state
    || !view.receipt.usage || ![view.receipt.usage.inputTokens, view.receipt.usage.outputTokens, view.receipt.usage.cachedInputTokens ?? 0].every(value => Number.isSafeInteger(value) && value >= 0))) throw Error('CITYOS_TERMINAL_RECEIPT_REQUIRED');
  if (!terminal && view.receipt) throw Error('CITYOS_NONTERMINAL_RECEIPT');
  return terminal;
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createServerAdapter() {
  return {
    type,
    supportsLocalAgentJwt: false,
    async testEnvironment(ctx) {
      const runtime = installed;
      let available = false;
      try { available = Boolean(runtime && ctx.companyId === runtime.companyId && await runtime.isCurrent() && await runtime.executionQualified()); } catch { /* No credentials or source diagnostics escape. */ }
      return { adapterType: type, testedAt: new Date().toISOString(), status: available ? 'pass' : 'fail', checks: [{
        code: available ? 'cityos_installed_binding_current' : 'cityos_installed_binding_unavailable', level: available ? 'info' : 'error',
        message: available ? 'Compatible CityOS execution binding is current.' : 'Install and qualify the CityOS planning and execution bindings before enabling this adapter.',
      }] };
    },
    async execute(ctx) {
      const runtime = installed;
      if (!runtime || ctx.agent.companyId !== runtime.companyId || !reference(ctx.agent.id) || !reference(ctx.runId)
        || !reference(ctx.context.taskId)) return unavailable('CITYOS_VERIFIED_RUN_CONTEXT_REQUIRED');
      let binding, operationId, executionRef, cancelled = false;
      const control = () => installed === runtime && runtime.isCurrent();
      try {
        if (!await control() || !await runtime.executionQualified()) return unavailable('CITYOS_EXECUTION_NOT_QUALIFIED');
        await ctx.onCancellationReady?.();
        const coordinates = { instanceRef: runtime.instanceRef, companyId: ctx.agent.companyId, agentId: ctx.agent.id, runId: ctx.runId };
        operationId = operationIdFor(coordinates);
        let view;
        try { view = await runtime.client.readExecution(operationId); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'PAPERCLIP_ENGINEERING_HTTP_404') throw error;
        }
        if (view) {
          // The installed owner returns the frozen original run correlation.
          // Mutable issue/work metadata cannot replace it during restart.
          if (view.instanceRef !== runtime.instanceRef || view.companyId !== ctx.agent.companyId || view.agentId !== ctx.agent.id
            || view.issueId !== ctx.context.taskId || view.runId !== ctx.runId || ![view.bindingRef, view.workRef, view.workVersion].every(reference)) return unavailable('CITYOS_ORIGINAL_RUN_BINDING_MISMATCH');
          binding = { ...view, tenantId: runtime.tenantId };
        } else {
          binding = await runtime.resolveWork({ companyId: ctx.agent.companyId, agentId: ctx.agent.id, issueId: ctx.context.taskId });
          if (!binding || binding.tenantId !== runtime.tenantId || binding.instanceRef !== runtime.instanceRef || binding.companyId !== ctx.agent.companyId
            || binding.agentId !== ctx.agent.id || binding.issueId !== ctx.context.taskId
            || ![binding.bindingRef, binding.workRef, binding.workVersion].every(reference)) return unavailable('CITYOS_WORK_BINDING_MISMATCH');
          if (ctx.signal?.aborted) return unavailable('CITYOS_CANCELLED_BEFORE_DISPATCH');
          const intent = { schemaVersion: 'cityos.paperclip-execution-intent.v1', instanceRef: runtime.instanceRef,
            companyId: ctx.agent.companyId, agentId: ctx.agent.id, issueId: ctx.context.taskId,
            bindingRef: binding.bindingRef, workVersion: binding.workVersion, runId: ctx.runId };
          intent.operationId = operationId;
          if (!await control() || ctx.signal?.aborted) return unavailable('CITYOS_SCOPE_WITHDRAWN_BEFORE_DISPATCH');
          ctx.onDispatch?.();
          try { view = await runtime.client.submitExecution(intent); }
          catch { view = await runtime.client.readExecution(operationId); } // Recover the original intent; never resubmit an ambiguous write.
          binding = { ...binding, runId: ctx.runId };
        }
        const interval = Math.max(10, Math.min(runtime.pollIntervalMs ?? 1000, 5000));
        const polls = Math.max(1, Math.min(runtime.maxPolls ?? 300, 600));
        for (let count = 0; count < polls; count++) {
          if (!await control()) return unavailable('CITYOS_SCOPE_WITHDRAWN_DURING_EXECUTION');
          const terminal = validView(view, binding, operationId); executionRef = view.executionRef;
          if (terminal) {
            // Return final per-run usage once. No per-attempt usage callbacks or
            // acceptance acknowledgements become completion receipts.
            return { exitCode: view.state === 'completed' ? 0 : view.state === 'cancelled' ? 130 : 1,
              signal: view.state === 'cancelled' ? 'SIGTERM' : null, timedOut: false,
              usage: { ...view.receipt.usage }, usageBasis: 'per_run', usageComplete: true,
              summary: `CityOS execution ${view.state}.`, resultJson: { executionRef, operationId,
                workRef: binding.workRef, workVersion: binding.workVersion, receiptRef: view.receipt.receiptRef } };
          }
          if (ctx.signal?.aborted && !cancelled) {
            cancelled = true;
            try { view = await runtime.client.cancelExecution(executionRef, `${operationId}-cancel`); continue; }
            catch { /* Cancellation acknowledgement is uncertain; inquire until a terminal owner receipt. */ }
          }
          await ctx.onLog('stdout', JSON.stringify({ schemaVersion: 'cityos.paperclip-progress.v1', state: view.state, executionRef }) + '\n');
          await (runtime.wait ?? wait)(interval);
          view = await runtime.client.readExecution(executionRef);
        }
        return { ...unavailable(cancelled ? 'CITYOS_CANCELLATION_UNCONFIRMED' : 'CITYOS_EXECUTION_NOT_TERMINAL'), timedOut: true };
      } catch {
        // Exceptions may contain transport headers, issue content or credentials.
        return unavailable('CITYOS_EXECUTION_STATE_UNAVAILABLE');
      }
    },
  };
}
