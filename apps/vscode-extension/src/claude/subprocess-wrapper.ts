import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import type {
  ClaudeProcessOptions,
  ClaudeProcessState,
  ClaudeResponse,
} from './types';
import {
  CLAUDE_CLI_COMMAND,
  DEFAULT_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  MAX_RESTART_ATTEMPTS,
  RESTART_DELAY_MS,
  RESPONSE_DELIMITER,
  ERROR_PATTERNS,
  BUFFER_SIZE,
  SHUTDOWN_GRACE_PERIOD_MS,
} from './constants';

export class ClaudeSubprocessWrapper extends EventEmitter {
  private process?: ChildProcess;
  private state: ClaudeProcessState = { isRunning: false };
  private responseBuffer = '';
  private healthCheckTimer?: NodeJS.Timeout;
  private responseTimeout?: NodeJS.Timeout;
  private restartAttempts = 0;
  private outputChannel: vscode.OutputChannel;

  constructor(private options: ClaudeProcessOptions) {
    super();
    this.outputChannel = vscode.window.createOutputChannel('Claude Code');
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.log('Claude process is already running');
      return;
    }

    try {
      // Check if Claude CLI is available
      const claudeAvailable = await this.checkClaudeCliAvailable();
      if (!claudeAvailable) {
        const message =
          'Claude CLI not found. Please install it using: npm install -g @anthropic-ai/claude-cli';
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }

      // Spawn the Claude process
      const env = {
        ...process.env,
        ANTHROPIC_API_KEY: this.options.apiKey,
        NODE_ENV: 'production',
      };

      const args = [];
      if (this.options.model) {
        args.push('--model', this.options.model);
      }
      if (this.options.temperature !== undefined) {
        args.push('--temperature', this.options.temperature.toString());
      }
      if (this.options.maxTokens !== undefined) {
        args.push('--max-tokens', this.options.maxTokens.toString());
      }

      this.process = spawn(CLAUDE_CLI_COMMAND, args, {
        env,
        cwd: this.options.workingDirectory || vscode.workspace.rootPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.pid) {
        throw new Error('Failed to spawn Claude process');
      }

      // Update state
      this.state = {
        isRunning: true,
        pid: this.process.pid,
        startTime: new Date(),
        lastActivity: new Date(),
      };

      // Attach event listeners
      this.attachProcessListeners();

      // Start health check
      this.startHealthCheck();

      // Emit ready event
      this.emit('ready');
      this.log(`Claude process started with PID: ${this.process.pid}`);
    } catch (error) {
      this.handleError('Failed to start Claude process', error);
      throw error;
    }
  }

  async send(prompt: string): Promise<void> {
    if (!this.isHealthy()) {
      throw new Error('Claude process is not healthy');
    }

    return new Promise((resolve, reject) => {
      try {
        // Clear previous timeout
        if (this.responseTimeout) {
          clearTimeout(this.responseTimeout);
        }

        // Set response timeout
        this.responseTimeout = setTimeout(() => {
          reject(new Error('Response timeout'));
          this.handleTimeout();
        }, DEFAULT_TIMEOUT_MS);

        // Write prompt to stdin
        const writeStream = this.process!.stdin!;
        if (!writeStream.write(prompt + '\n', 'utf-8')) {
          // Handle backpressure
          writeStream.once('drain', () => {
            this.state.lastActivity = new Date();
            resolve();
          });
        } else {
          this.state.lastActivity = new Date();
          resolve();
        }
      } catch (error) {
        this.handleError('Failed to send prompt', error);
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    this.log('Stopping Claude process...');

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = undefined;
    }

    // Remove event listeners
    this.removeAllListeners();

    if (this.process) {
      return new Promise((resolve) => {
        const forceKillTimer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.log('Force killing Claude process');
            this.process.kill('SIGKILL');
          }
          resolve();
        }, SHUTDOWN_GRACE_PERIOD_MS);

        this.process!.once('exit', () => {
          clearTimeout(forceKillTimer);
          this.cleanup();
          resolve();
        });

        // Send termination signal
        this.process!.kill('SIGTERM');
      });
    } else {
      this.cleanup();
    }
  }

  isHealthy(): boolean {
    return (
      this.state.isRunning &&
      this.process !== undefined &&
      !this.process.killed &&
      this.process.pid !== undefined
    );
  }

  getState(): ClaudeProcessState {
    return { ...this.state };
  }

  private async checkClaudeCliAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const checkProcess = spawn('which', [CLAUDE_CLI_COMMAND]);
      checkProcess.on('exit', (code) => {
        resolve(code === 0);
      });
      checkProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  private attachProcessListeners(): void {
    if (!this.process) return;

    // Handle stdout data
    this.process.stdout!.on('data', (data: Buffer) => {
      this.handleStdoutData(data);
    });

    // Handle stderr data
    this.process.stderr!.on('data', (data: Buffer) => {
      this.handleStderrData(data);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.handleError('Process error', error);
    });
  }

  private handleStdoutData(data: Buffer): void {
    try {
      const chunk = data.toString('utf-8');
      this.responseBuffer += chunk;
      this.state.lastActivity = new Date();

      // Check for complete response
      const match = this.responseBuffer.match(RESPONSE_DELIMITER);
      if (match) {
        const completeResponse = this.responseBuffer.substring(0, match.index);
        this.responseBuffer = this.responseBuffer.substring(
          match.index! + match[0].length,
        );

        // Clear response timeout
        if (this.responseTimeout) {
          clearTimeout(this.responseTimeout);
          this.responseTimeout = undefined;
        }

        // Emit response
        const response: ClaudeResponse = {
          content: completeResponse.trim(),
          isStreaming: false,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        this.emit('data', response);
      }

      // Emit streaming data if buffer is getting large
      if (this.responseBuffer.length > BUFFER_SIZE) {
        const response: ClaudeResponse = {
          content: this.responseBuffer,
          isStreaming: true,
        };
        this.emit('data', response);
        this.responseBuffer = '';
      }
    } catch (error) {
      this.handleError('Error processing stdout data', error);
    }
  }

  private handleStderrData(data: Buffer): void {
    const errorMessage = data.toString('utf-8');
    this.log(`Stderr: ${errorMessage}`, 'error');

    // Check for known error patterns
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(errorMessage)) {
        this.emit('error', new Error(errorMessage));
        break;
      }
    }
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.log(`Claude process exited with code ${code} and signal ${signal}`);
    this.state.isRunning = false;

    // Emit close event
    this.emit('close', code, signal);

    // Attempt restart if it was unexpected
    if (code !== 0 && this.restartAttempts < MAX_RESTART_ATTEMPTS) {
      this.restartAttempts++;
      this.log(
        `Attempting restart ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS}`,
      );

      setTimeout(() => {
        this.start().catch((error) => {
          this.handleError('Failed to restart Claude process', error);
        });
      }, RESTART_DELAY_MS);
    } else if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      vscode.window.showErrorMessage(
        'Claude process failed to restart. Please check your configuration.',
      );
    }
  }

  private handleTimeout(): void {
    this.log('Response timeout occurred', 'warning');
    this.emit('error', new Error('Response timeout'));

    // Consider restarting if process is unresponsive
    if (!this.isHealthy()) {
      this.stop().then(() => this.start());
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      if (!this.isHealthy()) {
        this.log('Health check failed', 'warning');
        this.emit('error', new Error('Health check failed'));
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private cleanup(): void {
    this.process = undefined;
    this.state = { isRunning: false };
    this.responseBuffer = '';
    this.restartAttempts = 0;
    this.outputChannel.dispose();
  }

  private handleError(message: string, error: any): void {
    const errorMessage = `${message}: ${error?.message || error}`;
    this.log(errorMessage, 'error');
    this.emit('error', new Error(errorMessage));
  }

  private log(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
  ): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (level === 'error') {
      console.error(logMessage);
    } else if (level === 'warning') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }
}
