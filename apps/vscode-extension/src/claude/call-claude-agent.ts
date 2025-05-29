import * as vscode from 'vscode';
import { Logger } from './logger';
import { ProcessManager } from './subprocess/process-manager';
import { ProcessMonitor } from './subprocess/process-monitor';
import { ProcessCommunication } from './subprocess/process-communication';
import { ProcessPool, type PoolOptions } from './subprocess/process-pool';
import { SecretsManager, SecretKeys } from './auth/secrets-manager';
import { CredentialProvider } from './auth/credential-provider';
import { AuthFlow } from './auth/auth-flow';
import { TokenManager } from './auth/token-manager';
import { SettingsManager } from './config/settings-manager';
import { SettingsUI } from './config/settings-ui';
import { SessionManager } from './sessions/session-manager';
import {
  ClaudeCodeCLIDetector,
  CLISetupAssistant,
  CLIConfigStorage,
} from './cli-detection';
import type { Session, Message } from './sessions/session-types';
import type { CLIConfig } from './cli-detection/cli-types';

/**
 * Configuration for Claude agent
 */
export interface ClaudeAgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stream?: boolean;
  timeout?: number;
}

/**
 * Result from Claude agent call
 */
export interface ClaudeAgentResult {
  success: boolean;
  response?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  processInfo?: {
    pid: number;
    executionTime: number;
    memoryUsage: number;
  };
}

/**
 * Main interface for calling Claude Code CLI
 */
export class ClaudeAgent {
  private readonly logger = new Logger('ClaudeAgent');
  private readonly processManager = new ProcessManager();
  private readonly processMonitor = new ProcessMonitor();
  private readonly processPool: ProcessPool;
  private readonly secretsManager = new SecretsManager();
  private readonly credentialProvider: CredentialProvider;
  private readonly authFlow: AuthFlow;
  private readonly tokenManager: TokenManager;
  private readonly settingsManager: SettingsManager;
  private readonly sessionManager: SessionManager;
  private readonly cliDetector = new ClaudeCodeCLIDetector();
  private readonly cliSetupAssistant = new CLISetupAssistant();
  private readonly cliConfigStorage = new CLIConfigStorage();

  private cliConfig: CLIConfig | undefined;
  private isInitialized = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Initialize components
    this.credentialProvider = new CredentialProvider(this.secretsManager);
    this.authFlow = new AuthFlow(this.secretsManager, this.credentialProvider);
    this.tokenManager = new TokenManager(this.secretsManager);
    this.settingsManager = new SettingsManager(context);
    this.sessionManager = new SessionManager(context);

    // Initialize process pool
    const poolOptions: PoolOptions = {
      minWorkers: 1,
      maxWorkers: 4,
      idleTimeout: 60000,
      warmupCommand: 'claude --version',
    };
    this.processPool = new ProcessPool(poolOptions);

    // Set up monitoring
    this.setupMonitoring();
  }

  /**
   * Initialize the Claude agent
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger.info('Initializing Claude agent');

    try {
      // Load settings
      await this.settingsManager.loadSettings();

      // Check CLI configuration
      this.cliConfig = await this.cliConfigStorage.getConfig();

      if (!this.cliConfig || !this.cliConfig.verified) {
        // Try to detect CLI
        const detection = await this.cliDetector.detect();

        if (!detection.found) {
          // Show setup assistant
          const setupResult = await this.cliSetupAssistant.showSetup(
            this.context,
          );

          if (!setupResult.success) {
            throw new Error('Claude CLI setup failed or was cancelled');
          }

          this.cliConfig = await this.cliConfigStorage.getConfig();
        } else {
          // Save detected CLI
          this.cliConfig = {
            path: detection.path!,
            version: detection.version,
            detectedAt: new Date().toISOString(),
            verified: true,
          };
          await this.cliConfigStorage.saveConfig(this.cliConfig);
        }
      }

      // Verify CLI is still valid
      if (
        this.cliConfig &&
        !(await this.cliConfigStorage.verifyConfig(this.cliConfig))
      ) {
        throw new Error('Claude CLI verification failed');
      }

      // Initialize process pool with CLI path
      if (this.cliConfig) {
        await this.processPool.initialize(this.cliConfig.path);
      }

      // Check authentication
      const hasValidAuth = await this.authFlow.isAuthenticated();
      if (!hasValidAuth) {
        await this.authFlow.startAuthFlow();
      }

      // Restore sessions
      await this.sessionManager.restoreSessions();

      this.isInitialized = true;
      this.logger.info('Claude agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Claude agent', error);
      throw error;
    }
  }

  /**
   * Call Claude with a prompt
   */
  async callClaude(
    prompt: string,
    config: ClaudeAgentConfig = {},
    sessionId?: string,
  ): Promise<ClaudeAgentResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.cliConfig) {
      return {
        success: false,
        error: 'Claude CLI not configured',
      };
    }

    const startTime = Date.now();
    let process: any;
    let session: Session | undefined;

    try {
      // Get or create session
      if (sessionId) {
        session = this.sessionManager.getSession(sessionId);
      } else {
        session = await this.sessionManager.createSession('Claude Agent Call');
      }

      // Add user message to session
      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: new Date(),
      };
      session.messages.push(userMessage);

      // Get settings
      const settings = this.settingsManager.getSettings();
      const model = config.model || settings.api.model;
      const temperature = config.temperature ?? settings.model.temperature;
      const maxTokens = config.maxTokens || settings.model.maxTokens;
      const systemPrompt = config.systemPrompt || settings.model.systemPrompt;

      // Build command arguments
      const args = [
        '--model',
        model,
        '--temperature',
        temperature.toString(),
        '--max-tokens',
        maxTokens.toString(),
      ];

      if (systemPrompt) {
        args.push('--system', systemPrompt);
      }

      if (config.stream !== false) {
        args.push('--stream');
      }

      // Get API key
      const apiKey = await this.credentialProvider.getCredentials(
        SecretKeys.CLAUDE_API_KEY,
      );
      if (!apiKey) {
        throw new Error('Claude API key not found');
      }

      // Spawn process through pool
      process = await this.processPool.acquire();

      // Set up communication
      const communication = new ProcessCommunication(process.process);

      // Handle streaming responses
      let fullResponse = '';
      communication.on('data', (data: string) => {
        fullResponse += data;

        // Emit streaming update
        this.context.globalState.update('claude.streaming.update', {
          sessionId: session!.id,
          content: data,
        });
      });

      // Execute command
      const env = {
        ANTHROPIC_API_KEY: apiKey,
        ...process.env,
      };

      const result = await process.execute(this.cliConfig.path, args, {
        input: prompt,
        env,
        timeout: config.timeout || 300000, // 5 minutes default
      });

      // Parse response
      if (result.code === 0) {
        const assistantMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: result.stdout || fullResponse,
          timestamp: new Date(),
        };
        session.messages.push(assistantMessage);

        // Extract usage if available
        const usage = this.extractUsage(result.stdout);

        return {
          success: true,
          response: result.stdout || fullResponse,
          usage,
          processInfo: {
            pid: process.process.pid!,
            executionTime: Date.now() - startTime,
            memoryUsage: process.process.memoryUsage?.() || 0,
          },
        };
      } else {
        throw new Error(result.stderr || 'Claude CLI execution failed');
      }
    } catch (error: any) {
      this.logger.error('Claude call failed', error);

      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        processInfo: process
          ? {
              pid: process.process.pid!,
              executionTime: Date.now() - startTime,
              memoryUsage: process.process.memoryUsage?.() || 0,
            }
          : undefined,
      };
    } finally {
      // Release process back to pool
      if (process) {
        await this.processPool.release(process);
      }

      // Save session
      if (session) {
        await this.sessionManager.saveSession(session.id);
      }
    }
  }

  /**
   * Stream Claude response
   */
  async *streamClaude(
    prompt: string,
    config: ClaudeAgentConfig = {},
    sessionId?: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.cliConfig) {
      throw new Error('Claude CLI not configured');
    }

    let process: any;

    try {
      // Force streaming
      config.stream = true;

      // Get or create session
      let session: Session;
      if (sessionId) {
        session = this.sessionManager.getSession(sessionId)!;
      } else {
        session = await this.sessionManager.createSession('Claude Stream');
      }

      // Add user message
      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: new Date(),
      };
      session.messages.push(userMessage);

      // Get settings and build args
      const settings = this.settingsManager.getSettings();
      const args = this.buildCommandArgs(config, settings);

      // Get API key
      const apiKey = await this.credentialProvider.getCredentials(
        SecretKeys.CLAUDE_API_KEY,
      );
      if (!apiKey) {
        throw new Error('Claude API key not found');
      }

      // Spawn process
      process = await this.processManager.spawn(this.cliConfig.path, args, {
        env: {
          ANTHROPIC_API_KEY: apiKey,
          ...process.env,
        },
      });

      // Set up streaming
      const communication = new ProcessCommunication(process);

      // Send prompt
      communication.send(prompt);

      // Stream response chunks
      let fullResponse = '';
      for await (const chunk of communication.stream()) {
        fullResponse += chunk;
        yield chunk;
      }

      // Save assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      };
      session.messages.push(assistantMessage);
      await this.sessionManager.saveSession(session.id);
    } finally {
      // Clean up process
      if (process) {
        await this.processManager.terminate(process.id);
      }
    }
  }

  /**
   * Show settings UI
   */
  async showSettings(): Promise<void> {
    const settingsUI = new SettingsUI(this.context, this.settingsManager);
    await settingsUI.show();
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): Session[] {
    return this.sessionManager.getActiveSessions();
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Clear all sessions
   */
  async clearSessions(): Promise<void> {
    await this.sessionManager.clearAllSessions();
  }

  /**
   * Export session
   */
  async exportSession(
    sessionId: string,
    format: 'json' | 'markdown' = 'json',
  ): Promise<string> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    } else {
      return this.sessionToMarkdown(session);
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing Claude agent');

    // Save all sessions
    await this.sessionManager.saveAllSessions();

    // Terminate all processes
    await this.processManager.terminateAll();

    // Shutdown process pool
    await this.processPool.shutdown();

    // Clear monitoring
    this.processMonitor.stopMonitoring();

    this.isInitialized = false;
  }

  /**
   * Set up process monitoring
   */
  private setupMonitoring(): void {
    // Monitor process events
    this.processMonitor.on('processHigh', (metrics) => {
      this.logger.warn('High resource usage detected', metrics);
      vscode.window.showWarningMessage(
        `Claude process using high ${metrics.cpuUsage > 80 ? 'CPU' : 'memory'}`,
      );
    });

    this.processMonitor.on('processExit', (info) => {
      if (info.code !== 0) {
        this.logger.error('Claude process exited with error', info);
      }
    });

    // Monitor CLI availability
    this.cliConfigStorage.getConfig().then((config) => {
      if (config) {
        this.context.subscriptions.push(
          this.cliConfigStorage.monitorCLI(config, (available) => {
            if (!available) {
              vscode.window
                .showErrorMessage(
                  'Claude CLI is no longer available',
                  'Reconfigure',
                )
                .then((action) => {
                  if (action === 'Reconfigure') {
                    this.cliSetupAssistant.showSetup(this.context);
                  }
                });
            }
          }),
        );
      }
    });
  }

  /**
   * Build command arguments
   */
  private buildCommandArgs(config: ClaudeAgentConfig, settings: any): string[] {
    const args = [
      '--model',
      config.model || settings.api.model,
      '--temperature',
      (config.temperature ?? settings.model.temperature).toString(),
      '--max-tokens',
      (config.maxTokens || settings.model.maxTokens).toString(),
    ];

    if (config.systemPrompt || settings.model.systemPrompt) {
      args.push('--system', config.systemPrompt || settings.model.systemPrompt);
    }

    if (config.stream) {
      args.push('--stream');
    }

    return args;
  }

  /**
   * Extract usage information from response
   */
  private extractUsage(response: string): any {
    // Try to parse usage from response
    // This would depend on the actual CLI output format
    const usageMatch = response.match(/Usage: \{([^}]+)\}/);
    if (usageMatch) {
      try {
        return JSON.parse(`{${usageMatch[1]}}`);
      } catch {
        // Ignore parse errors
      }
    }

    return undefined;
  }

  /**
   * Convert session to markdown
   */
  private sessionToMarkdown(session: Session): string {
    const lines = [
      `# ${session.name}`,
      ``,
      `**Created:** ${session.createdAt.toLocaleString()}`,
      `**Last Active:** ${session.lastActiveAt.toLocaleString()}`,
      ``,
      `## Messages`,
      ``,
    ];

    for (const message of session.messages) {
      lines.push(
        `### ${message.role.charAt(0).toUpperCase() + message.role.slice(1)}`,
      );
      lines.push(`*${message.timestamp.toLocaleString()}*`);
      lines.push(``);
      lines.push(message.content);
      lines.push(``);
    }

    return lines.join('\n');
  }
}

/**
 * Create and initialize Claude agent
 */
export async function createClaudeAgent(
  context: vscode.ExtensionContext,
): Promise<ClaudeAgent> {
  const agent = new ClaudeAgent(context);
  await agent.initialize();
  return agent;
}
