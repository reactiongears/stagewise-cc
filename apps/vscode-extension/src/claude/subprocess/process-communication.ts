import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { Logger } from '../logger';
import type {
  MessageHandler,
  ProcessCommunicationMessage,
} from './process-types';
import type { ProcessManager } from './process-manager';

/**
 * Handles bidirectional communication with subprocess
 */
export class ProcessCommunication extends EventEmitter {
  private messageHandlers = new Map<string, Map<string, MessageHandler>>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private buffers = new Map<string, string>();
  private readonly logger = new Logger('ProcessCommunication');

  constructor(private readonly processManager: ProcessManager) {
    super();
    this.setupProcessListeners();
  }

  /**
   * Send a message to a process
   */
  async send(processId: string, message: any): Promise<void> {
    const process = this.processManager.getProcess(processId);
    if (!process) {
      throw new Error(`Process ${processId} not found`);
    }

    const childProcess = (this.processManager as any).childProcesses.get(
      processId,
    );
    if (!childProcess || !childProcess.stdin) {
      throw new Error(`Process ${processId} stdin not available`);
    }

    const communicationMessage: ProcessCommunicationMessage = {
      id: randomUUID(),
      type: 'event',
      payload: message,
      timestamp: new Date(),
    };

    const messageStr = `${JSON.stringify(communicationMessage)}\n`;

    return new Promise((resolve, reject) => {
      childProcess.stdin.write(messageStr, (error) => {
        if (error) {
          this.logger.error(
            `Failed to send message to process ${processId}:`,
            error,
          );
          reject(error);
        } else {
          this.logger.debug(
            `Sent message to process ${processId}:`,
            communicationMessage,
          );
          resolve();
        }
      });
    });
  }

  /**
   * Register a message handler for a process
   */
  onMessage(processId: string, handler: MessageHandler): vscode.Disposable {
    if (!this.messageHandlers.has(processId)) {
      this.messageHandlers.set(processId, new Map());
    }

    const handlerId = randomUUID();
    this.messageHandlers.get(processId)!.set(handlerId, handler);

    return new vscode.Disposable(() => {
      const handlers = this.messageHandlers.get(processId);
      if (handlers) {
        handlers.delete(handlerId);
        if (handlers.size === 0) {
          this.messageHandlers.delete(processId);
        }
      }
    });
  }

  /**
   * Send a message and wait for response
   */
  async sendAndWait(
    processId: string,
    message: any,
    timeout = 30000,
  ): Promise<any> {
    const process = this.processManager.getProcess(processId);
    if (!process) {
      throw new Error(`Process ${processId} not found`);
    }

    const requestId = randomUUID();
    const communicationMessage: ProcessCommunicationMessage = {
      id: requestId,
      type: 'request',
      payload: message,
      timestamp: new Date(),
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeout}ms`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Send the request
      this.send(processId, communicationMessage).catch((error) => {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Stream data to a process
   */
  async streamData(processId: string, data: Readable): Promise<void> {
    const process = this.processManager.getProcess(processId);
    if (!process) {
      throw new Error(`Process ${processId} not found`);
    }

    const childProcess = (this.processManager as any).childProcesses.get(
      processId,
    );
    if (!childProcess || !childProcess.stdin) {
      throw new Error(`Process ${processId} stdin not available`);
    }

    return new Promise((resolve, reject) => {
      const stdin = childProcess.stdin as Writable;

      data.on('error', (error) => {
        this.logger.error(`Stream error for process ${processId}:`, error);
        reject(error);
      });

      stdin.on('error', (error) => {
        this.logger.error(`Stdin error for process ${processId}:`, error);
        reject(error);
      });

      data.on('end', () => {
        this.logger.debug(`Stream completed for process ${processId}`);
        resolve();
      });

      // Pipe the data
      data.pipe(stdin, { end: false });
    });
  }

  /**
   * Cleanup communication for a process
   */
  cleanup(processId: string): void {
    // Clear message handlers
    this.messageHandlers.delete(processId);

    // Clear pending requests
    this.pendingRequests.forEach((request, requestId) => {
      if (requestId.startsWith(processId)) {
        clearTimeout(request.timeout);
        request.reject(new Error('Process terminated'));
      }
    });

    // Clear buffers
    this.buffers.delete(processId);

    this.logger.info(`Cleaned up communication for process ${processId}`);
  }

  /**
   * Setup process event listeners
   */
  private setupProcessListeners(): void {
    // Listen for stdout data
    this.processManager.on(
      'processStdout',
      (processId: string, data: Buffer) => {
        this.handleProcessOutput(processId, data.toString());
      },
    );

    // Listen for process cleanup
    this.processManager.on('processCleanup', (processId: string) => {
      this.cleanup(processId);
    });
  }

  /**
   * Handle process output
   */
  private handleProcessOutput(processId: string, data: string): void {
    // Buffer management for line-based protocol
    const buffer = this.buffers.get(processId) || '';
    const newBuffer = buffer + data;
    const lines = newBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffers.set(processId, lines[lines.length - 1]);

    // Process complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        this.processMessage(processId, line);
      }
    }
  }

  /**
   * Process a single message
   */
  private processMessage(processId: string, line: string): void {
    try {
      const message: ProcessCommunicationMessage = JSON.parse(line);

      // Handle response to pending request
      if (message.type === 'response' && this.pendingRequests.has(message.id)) {
        const request = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        clearTimeout(request.timeout);
        request.resolve(message.payload);
        return;
      }

      // Handle error response
      if (message.type === 'error' && this.pendingRequests.has(message.id)) {
        const request = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        clearTimeout(request.timeout);
        request.reject(new Error(message.payload.message || 'Unknown error'));
        return;
      }

      // Dispatch to message handlers
      const handlers = this.messageHandlers.get(processId);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(message.payload);
          } catch (error) {
            this.logger.error(
              `Message handler error for process ${processId}:`,
              error,
            );
          }
        });
      }

      // Emit generic message event
      this.emit('message', processId, message);
    } catch (error) {
      // Not JSON, emit as raw output
      this.emit('rawOutput', processId, line);
    }
  }
}
