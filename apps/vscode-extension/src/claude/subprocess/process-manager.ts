import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import {
  type ManagedProcess,
  type ProcessInfo,
  ProcessState,
  type SpawnOptions,
} from './process-types';

/**
 * Manages subprocess lifecycle for Claude CLI
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private childProcesses = new Map<string, ChildProcess>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly logger = new Logger('ProcessManager');
  private readonly maxConcurrentProcesses: number = 5;

  constructor(private readonly maxProcesses: number = 5) {
    super();
    this.maxConcurrentProcesses = maxProcesses;
  }

  /**
   * Spawn a new managed process
   */
  async spawn(
    command: string,
    args: string[] = [],
    options: SpawnOptions = {},
  ): Promise<ManagedProcess> {
    // Check process limit
    if (this.processes.size >= this.maxConcurrentProcesses) {
      throw new Error(
        `Process limit reached (${this.maxConcurrentProcesses}). Cannot spawn new process.`,
      );
    }

    const processId = randomUUID();
    const managedProcess: ManagedProcess = {
      id: processId,
      command,
      args,
      state: ProcessState.STARTING,
      startTime: new Date(),
      restartCount: 0,
      options,
    };

    this.processes.set(processId, managedProcess);
    this.logger.info(
      `Spawning process ${processId}: ${command} ${args.join(' ')}`,
    );

    try {
      const childProcess = await this.spawnChildProcess(managedProcess);
      this.childProcesses.set(processId, childProcess);

      managedProcess.pid = childProcess.pid;
      managedProcess.state = ProcessState.RUNNING;

      this.setupProcessHandlers(processId, childProcess, managedProcess);
      this.emit('processStarted', managedProcess);

      return managedProcess;
    } catch (error) {
      managedProcess.state = ProcessState.CRASHED;
      managedProcess.lastError = error as Error;
      this.emit('processError', processId, error);
      throw error;
    }
  }

  /**
   * Terminate a process
   */
  async terminate(processId: string, graceful = true): Promise<void> {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      throw new Error(`Process ${processId} not found`);
    }

    const childProcess = this.childProcesses.get(processId);
    if (!childProcess || managedProcess.state === ProcessState.STOPPED) {
      return;
    }

    this.logger.info(
      `Terminating process ${processId} (graceful: ${graceful})`,
    );
    managedProcess.state = ProcessState.STOPPING;

    // Clear any restart timers
    const restartTimer = this.restartTimers.get(processId);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.restartTimers.delete(processId);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.logger.warn(
            `Process ${processId} did not terminate gracefully, forcing kill`,
          );
          childProcess.kill('SIGKILL');
        },
        graceful ? 5000 : 0,
      );

      childProcess.once('exit', () => {
        clearTimeout(timeout);
        this.cleanupProcess(processId);
        resolve();
      });

      childProcess.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Send termination signal
      const signal = graceful ? 'SIGTERM' : 'SIGKILL';
      childProcess.kill(signal);
    });
  }

  /**
   * Restart a process
   */
  async restart(processId: string): Promise<ManagedProcess> {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      throw new Error(`Process ${processId} not found`);
    }

    this.logger.info(`Restarting process ${processId}`);

    // Terminate existing process
    await this.terminate(processId, true);

    // Update process info
    managedProcess.restartCount++;
    managedProcess.state = ProcessState.RESTARTING;

    // Spawn new process with same config
    return this.spawn(
      managedProcess.command,
      managedProcess.args,
      managedProcess.options,
    );
  }

  /**
   * Get a specific process
   */
  getProcess(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId);
  }

  /**
   * List all processes
   */
  listProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((process) => ({
      id: process.id,
      command: process.command,
      state: process.state,
      uptime: Date.now() - process.startTime.getTime(),
      restartCount: process.restartCount,
    }));
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up all processes');

    const terminatePromises = Array.from(this.processes.keys()).map((id) =>
      this.terminate(id, true).catch((error) => {
        this.logger.error(`Error terminating process ${id}:`, error);
      }),
    );

    await Promise.all(terminatePromises);

    this.processes.clear();
    this.childProcesses.clear();
    this.restartTimers.clear();
  }

  /**
   * Spawn the actual child process
   */
  private async spawnChildProcess(
    process: ManagedProcess,
  ): Promise<ChildProcess> {
    const { command, args, options } = process;

    const spawnOptions = {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      detached: options.detached,
      shell: options.shell,
      encoding: options.encoding as BufferEncoding | undefined,
    };

    const childProcess = spawn(command, args, spawnOptions);

    // Set timeout if specified
    if (options.timeout) {
      setTimeout(() => {
        if (childProcess.killed === false) {
          this.logger.warn(
            `Process ${process.id} exceeded timeout, terminating`,
          );
          this.terminate(process.id, false);
        }
      }, options.timeout);
    }

    return childProcess;
  }

  /**
   * Setup event handlers for a child process
   */
  private setupProcessHandlers(
    processId: string,
    childProcess: ChildProcess,
    managedProcess: ManagedProcess,
  ): void {
    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      this.logger.info(
        `Process ${processId} exited with code ${code}, signal ${signal}`,
      );

      if (code !== 0 && managedProcess.state === ProcessState.RUNNING) {
        managedProcess.state = ProcessState.CRASHED;
        this.handleProcessCrash(managedProcess);
      } else {
        managedProcess.state = ProcessState.STOPPED;
      }

      this.emit('processExit', processId, code, signal);
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      this.logger.error(`Process ${processId} error:`, error);
      managedProcess.state = ProcessState.CRASHED;
      managedProcess.lastError = error;
      this.emit('processError', processId, error);
    });

    // Log stdout
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        this.logger.debug(`[${processId}] stdout:`, data.toString());
        this.emit('processStdout', processId, data);
      });
    }

    // Log stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        this.logger.warn(`[${processId}] stderr:`, data.toString());
        this.emit('processStderr', processId, data);
      });
    }
  }

  /**
   * Handle process crash with restart logic
   */
  private handleProcessCrash(process: ManagedProcess): void {
    const { maxRestarts = 3 } = process.options;

    if (process.restartCount < maxRestarts) {
      const backoffDelay = Math.min(
        1000 * Math.pow(2, process.restartCount),
        30000,
      );
      this.logger.info(
        `Scheduling restart for process ${process.id} in ${backoffDelay}ms (attempt ${process.restartCount + 1}/${maxRestarts})`,
      );

      const timer = setTimeout(() => {
        this.restart(process.id).catch((error) => {
          this.logger.error(`Failed to restart process ${process.id}:`, error);
        });
      }, backoffDelay);

      this.restartTimers.set(process.id, timer);
    } else {
      this.logger.error(
        `Process ${process.id} exceeded max restarts (${maxRestarts}), giving up`,
      );
      this.emit('processMaxRestartsExceeded', process.id);
    }
  }

  /**
   * Clean up process resources
   */
  private cleanupProcess(processId: string): void {
    const managedProcess = this.processes.get(processId);
    if (managedProcess) {
      managedProcess.state = ProcessState.STOPPED;
    }

    this.childProcesses.delete(processId);

    const timer = this.restartTimers.get(processId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(processId);
    }

    this.emit('processCleanup', processId);
  }
}
