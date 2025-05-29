/**
 * Types for subprocess management system
 */

export interface SpawnOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  maxRestarts?: number;
  detached?: boolean;
  shell?: boolean;
  encoding?: BufferEncoding;
}

export enum ProcessState {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  CRASHED = 'crashed',
  RESTARTING = 'restarting',
}

export interface ManagedProcess {
  id: string;
  command: string;
  args: string[];
  state: ProcessState;
  pid?: number;
  startTime: Date;
  restartCount: number;
  lastError?: Error;
  options: SpawnOptions;
}

export interface ProcessInfo {
  id: string;
  command: string;
  state: ProcessState;
  uptime: number;
  restartCount: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ProcessMetrics {
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
  restartCount: number;
  lastHealthCheck: Date;
  responseTime?: number;
}

export type MessageHandler = (message: any) => void;

export interface HealthCheck {
  interval: number;
  timeout: number;
  retries: number;
  check: (process: ManagedProcess) => Promise<boolean>;
}

export interface PooledProcess extends ManagedProcess {
  inUse: boolean;
  lastUsed: Date;
  usageCount: number;
}

export interface PoolOptions {
  minSize: number;
  maxSize: number;
  idleTimeout: number;
  acquireTimeout: number;
  destroyTimeout: number;
}

export interface ProcessCommunicationMessage {
  id: string;
  type: 'request' | 'response' | 'event' | 'error';
  payload: any;
  timestamp: Date;
}

export interface ProcessError extends Error {
  code?: string;
  processId?: string;
  command?: string;
  exitCode?: number;
  signal?: string;
}
