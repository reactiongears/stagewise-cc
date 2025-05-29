/**
 * Subprocess management system for Claude CLI integration
 */

export { ProcessManager } from './process-manager';
export { ProcessMonitor } from './process-monitor';
export { ProcessCommunication } from './process-communication';
export { ProcessPool } from './process-pool';

export type {
  SpawnOptions,
  ProcessState,
  ManagedProcess,
  ProcessInfo,
  ProcessMetrics,
  MessageHandler,
  HealthCheck,
  PooledProcess,
  PoolOptions,
  ProcessCommunicationMessage,
  ProcessError,
} from './process-types';

export { ProcessState as ProcessStateEnum } from './process-types';
