import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import { ProcessManager } from './process-manager';
import type { PooledProcess, PoolOptions, SpawnOptions } from './process-types';

/**
 * Manages a pool of Claude CLI processes
 */
export class ProcessPool extends EventEmitter {
  private pool: PooledProcess[] = [];
  private waitingQueue: Array<{
    resolve: (process: PooledProcess) => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly logger = new Logger('ProcessPool');
  private poolOptions: PoolOptions;
  private processManager: ProcessManager;
  private maintenanceInterval?: NodeJS.Timer;
  private readonly defaultOptions: PoolOptions = {
    minSize: 1,
    maxSize: 5,
    idleTimeout: 300000, // 5 minutes
    acquireTimeout: 30000, // 30 seconds
    destroyTimeout: 5000, // 5 seconds
  };

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly spawnOptions: SpawnOptions = {},
    options: Partial<PoolOptions> = {},
  ) {
    super();
    this.poolOptions = { ...this.defaultOptions, ...options };
    this.processManager = new ProcessManager(this.poolOptions.maxSize);
    this.initialize();
  }

  /**
   * Acquire a process from the pool
   */
  async acquire(): Promise<PooledProcess> {
    this.logger.debug('Acquiring process from pool');

    // Try to find an available process
    const availableProcess = this.pool.find(
      (p) => !p.inUse && p.state === 'running',
    );
    if (availableProcess) {
      availableProcess.inUse = true;
      availableProcess.lastUsed = new Date();
      availableProcess.usageCount++;
      this.logger.debug(`Acquired existing process ${availableProcess.id}`);
      this.emit('processAcquired', availableProcess.id);
      return availableProcess;
    }

    // Check if we can spawn a new process
    if (this.pool.length < this.poolOptions.maxSize) {
      try {
        const newProcess = await this.spawnPoolProcess();
        newProcess.inUse = true;
        newProcess.lastUsed = new Date();
        newProcess.usageCount++;
        this.logger.debug(`Acquired new process ${newProcess.id}`);
        this.emit('processAcquired', newProcess.id);
        return newProcess;
      } catch (error) {
        this.logger.error('Failed to spawn new process:', error);
        throw error;
      }
    }

    // Wait for a process to become available
    return this.waitForAvailableProcess();
  }

  /**
   * Release a process back to the pool
   */
  release(process: PooledProcess): void {
    const poolProcess = this.pool.find((p) => p.id === process.id);
    if (!poolProcess) {
      this.logger.warn(`Process ${process.id} not found in pool`);
      return;
    }

    poolProcess.inUse = false;
    poolProcess.lastUsed = new Date();
    this.logger.debug(`Released process ${process.id} back to pool`);
    this.emit('processReleased', process.id);

    // Check waiting queue
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift()!;
      poolProcess.inUse = true;
      poolProcess.usageCount++;
      waiter.resolve(poolProcess);
    }
  }

  /**
   * Set pool size limits
   */
  setPoolSize(min: number, max: number): void {
    if (min < 0 || max < min) {
      throw new Error('Invalid pool size configuration');
    }

    this.poolOptions.minSize = min;
    this.poolOptions.maxSize = max;
    this.logger.info(`Pool size set to min: ${min}, max: ${max}`);

    // Adjust current pool size
    this.adjustPoolSize();
  }

  /**
   * Drain the pool and cleanup all processes
   */
  async drain(): Promise<void> {
    this.logger.info('Draining process pool');

    // Stop accepting new requests
    this.waitingQueue.forEach(({ reject }) => {
      reject(new Error('Pool is draining'));
    });
    this.waitingQueue = [];

    // Stop maintenance
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = undefined;
    }

    // Wait for in-use processes
    const timeout = this.poolOptions.destroyTimeout;
    const startTime = Date.now();

    while (this.pool.some((p) => p.inUse) && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Terminate all processes
    await this.processManager.cleanup();
    this.pool = [];

    this.logger.info('Process pool drained');
    this.emit('poolDrained');
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalProcesses: number;
    availableProcesses: number;
    inUseProcesses: number;
    queueLength: number;
    poolUtilization: number;
  } {
    const totalProcesses = this.pool.length;
    const availableProcesses = this.pool.filter(
      (p) => !p.inUse && p.state === 'running',
    ).length;
    const inUseProcesses = this.pool.filter((p) => p.inUse).length;
    const queueLength = this.waitingQueue.length;
    const poolUtilization =
      totalProcesses > 0 ? (inUseProcesses / totalProcesses) * 100 : 0;

    return {
      totalProcesses,
      availableProcesses,
      inUseProcesses,
      queueLength,
      poolUtilization,
    };
  }

  /**
   * Initialize the pool
   */
  private async initialize(): Promise<void> {
    this.logger.info('Initializing process pool');

    // Spawn minimum processes
    const spawnPromises = [];
    for (let i = 0; i < this.poolOptions.minSize; i++) {
      spawnPromises.push(this.spawnPoolProcess());
    }

    try {
      await Promise.all(spawnPromises);
    } catch (error) {
      this.logger.error('Failed to initialize pool:', error);
    }

    // Start maintenance
    this.startMaintenance();

    this.emit('poolInitialized', this.getStats());
  }

  /**
   * Spawn a new process for the pool
   */
  private async spawnPoolProcess(): Promise<PooledProcess> {
    const managedProcess = await this.processManager.spawn(
      this.command,
      this.args,
      this.spawnOptions,
    );

    const pooledProcess: PooledProcess = {
      ...managedProcess,
      inUse: false,
      lastUsed: new Date(),
      usageCount: 0,
    };

    this.pool.push(pooledProcess);
    this.logger.debug(`Added process ${pooledProcess.id} to pool`);

    return pooledProcess;
  }

  /**
   * Wait for an available process
   */
  private waitForAvailableProcess(): Promise<PooledProcess> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(
          new Error(
            `Acquire timeout after ${this.poolOptions.acquireTimeout}ms`,
          ),
        );
      }, this.poolOptions.acquireTimeout);

      this.waitingQueue.push({
        resolve: (process) => {
          clearTimeout(timeout);
          resolve(process);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.logger.debug(
        `Added request to waiting queue (length: ${this.waitingQueue.length})`,
      );
    });
  }

  /**
   * Start pool maintenance
   */
  private startMaintenance(): void {
    this.maintenanceInterval = setInterval(() => {
      this.performMaintenance();
    }, 30000); // Every 30 seconds
  }

  /**
   * Perform pool maintenance
   */
  private async performMaintenance(): Promise<void> {
    this.logger.debug('Performing pool maintenance');

    // Remove idle processes beyond minimum
    const now = Date.now();
    const idleProcesses = this.pool.filter(
      (p) =>
        !p.inUse &&
        p.state === 'running' &&
        now - p.lastUsed.getTime() > this.poolOptions.idleTimeout,
    );

    for (const process of idleProcesses) {
      if (this.pool.length > this.poolOptions.minSize) {
        await this.removeProcess(process.id);
      }
    }

    // Replace crashed processes
    const crashedProcesses = this.pool.filter(
      (p) => p.state === 'crashed' || p.state === 'stopped',
    );
    for (const process of crashedProcesses) {
      await this.replaceProcess(process.id);
    }

    // Scale up if needed
    if (
      this.waitingQueue.length > 0 &&
      this.pool.length < this.poolOptions.maxSize
    ) {
      try {
        await this.spawnPoolProcess();
      } catch (error) {
        this.logger.error('Failed to scale up pool:', error);
      }
    }

    this.emit('maintenanceComplete', this.getStats());
  }

  /**
   * Remove a process from the pool
   */
  private async removeProcess(processId: string): Promise<void> {
    const index = this.pool.findIndex((p) => p.id === processId);
    if (index === -1) return;

    const process = this.pool[index];
    if (process.inUse) {
      this.logger.warn(`Cannot remove in-use process ${processId}`);
      return;
    }

    this.pool.splice(index, 1);
    await this.processManager.terminate(processId);
    this.logger.debug(`Removed process ${processId} from pool`);
  }

  /**
   * Replace a crashed process
   */
  private async replaceProcess(processId: string): Promise<void> {
    await this.removeProcess(processId);

    try {
      await this.spawnPoolProcess();
      this.logger.debug(`Replaced crashed process ${processId}`);
    } catch (error) {
      this.logger.error(`Failed to replace process ${processId}:`, error);
    }
  }

  /**
   * Adjust pool size based on configuration
   */
  private async adjustPoolSize(): Promise<void> {
    // Scale down if above maximum
    while (this.pool.length > this.poolOptions.maxSize) {
      const idleProcess = this.pool.find((p) => !p.inUse);
      if (idleProcess) {
        await this.removeProcess(idleProcess.id);
      } else {
        break; // All processes are in use
      }
    }

    // Scale up if below minimum
    while (this.pool.length < this.poolOptions.minSize) {
      try {
        await this.spawnPoolProcess();
      } catch (error) {
        this.logger.error(
          'Failed to spawn process for minimum pool size:',
          error,
        );
        break;
      }
    }
  }
}
