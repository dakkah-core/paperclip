import type { ServerAdapterModule } from '@paperclipai/adapter-utils';
export const type: 'cityos_governed';
export const label: string;
export const compatibility: Readonly<{ contract: 'cityos.paperclip-integration.v1'; adapterUtilsVersion: '0.3.1'; serverVersion: '0.3.1'; hostSource: string }>;
export interface CityosAdapterBinding {
  tenantId: string; instanceRef: string; companyId: string; agentId: string; issueId: string;
  bindingRef: string; workRef: string; workVersion: string;
}
export interface CityosAdapterExecutionView {
  instanceRef: string; companyId: string; agentId: string; issueId: string; runId: string;
  schemaVersion: 'cityos.paperclip-execution.v1'; executionRef: string; operationId: string;
  bindingRef: string; workRef: string; workVersion: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'denied';
  receipt?: { receiptRef: string; state: 'completed' | 'failed' | 'cancelled' | 'denied'; usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } };
}
export interface CityosAdapterExecutionIntent {
  schemaVersion: 'cityos.paperclip-execution-intent.v1';
  instanceRef: string; companyId: string; agentId: string; issueId: string;
  bindingRef: string; workVersion: string; operationId: string; runId: string;
}
export interface CityosAdapterRuntime {
  tenantId: string; instanceRef: string; companyId: string; compatibility: typeof compatibility;
  isCurrent(): Promise<boolean>; executionQualified(): Promise<boolean>;
  resolveWork(input: { companyId: string; agentId: string; issueId: string }): Promise<CityosAdapterBinding | null>;
  client: {
    submitExecution(intent: CityosAdapterExecutionIntent): Promise<CityosAdapterExecutionView>;
    readExecution(ref: string): Promise<CityosAdapterExecutionView>;
    cancelExecution(ref: string, operationId: string): Promise<CityosAdapterExecutionView>;
  };
  pollIntervalMs?: number; maxPolls?: number; wait?(milliseconds: number): Promise<void>;
}
export function installCityosAdapterRuntime(runtime: CityosAdapterRuntime): () => void;
export function operationIdFor(input: { instanceRef: string; companyId: string; agentId: string; runId: string; bindingRef?: string; workVersion?: string }): string;
export function createServerAdapter(): ServerAdapterModule;
