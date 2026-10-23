import type { CityosAdapterRuntime, CityosAdapterExecutionView } from './package/index.mjs';

// A host client accepts the versioned wire interface, with no arbitrary-key
// index signature. Packaging must preserve that assignability.
interface WorkIntent {
  schemaVersion: 'cityos.paperclip-execution-intent.v1';
  instanceRef: string; companyId: string; agentId: string; issueId: string;
  bindingRef: string; workVersion: string; operationId: string; runId: string;
}
declare const installedClient: {
  submitExecution: (intent: WorkIntent) => Promise<CityosAdapterExecutionView>;
  readExecution: (reference: string) => Promise<CityosAdapterExecutionView>;
  cancelExecution: (reference: string, operationId: string) => Promise<CityosAdapterExecutionView>;
};
const adapterClient: CityosAdapterRuntime['client'] = installedClient;
void adapterClient;
