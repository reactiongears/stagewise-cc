import * as vscode from 'vscode';
import { ClaudeService } from './claude-service';
import { ClaudeAuthService } from './auth-service';
import { ClaudeConfigService } from './config-service';
import { ErrorHandler } from './error-handler';
import { Logger } from './logger';
import { registerClaudeAuthCommands } from '../commands/claude-auth-commands';
import { registerClaudeConfigCommands } from '../commands/claude-config-commands';
import { registerClaudeInteractionCommands } from '../commands/claude-interaction-commands';

export interface LifecycleComponents {
  authService: ClaudeAuthService;
  configService: ClaudeConfigService;
  claudeService: ClaudeService;
  errorHandler: ErrorHandler;
  logger: Logger;
  outputChannel: vscode.OutputChannel;
}

export interface LifecycleState {
  isActivated: boolean;
  isInitialized: boolean;
  activationTime?: Date;
  initializationTime?: Date;
  lastError?: Error;
  components: Partial<LifecycleComponents>;
}

export class LifecycleManager {
  private state: LifecycleState = {
    isActivated: false,
    isInitialized: false,
    components: {},
  };

  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    if (this.state.isActivated) {
      return;
    }

    console.log('Activating Claude Code integration...');
    this.state.activationTime = new Date();

    try {
      // Create output channel
      const outputChannel = vscode.window.createOutputChannel('Claude Code');
      this.state.components.outputChannel = outputChannel;
      this.disposables.push(outputChannel);

      // Create logger
      const logger = new Logger(outputChannel);
      this.state.components.logger = logger;
      logger.info('Starting Claude Code extension activation');

      // Create services
      const authService = new ClaudeAuthService(this.context, outputChannel);
      this.state.components.authService = authService;

      const configService = new ClaudeConfigService(
        this.context,
        outputChannel,
      );
      this.state.components.configService = configService;
      this.disposables.push(configService);

      const claudeService = ClaudeService.getInstance(
        this.context,
        authService,
        configService,
        outputChannel,
      );
      this.state.components.claudeService = claudeService;

      // Create error handler
      const errorHandler = new ErrorHandler(
        this.context,
        outputChannel,
        authService,
        claudeService,
      );
      this.state.components.errorHandler = errorHandler;

      // Register all commands
      this.registerCommands();

      // Set up global error handling
      this.setupGlobalErrorHandling();

      // Initialize services
      await this.initialize();

      this.state.isActivated = true;
      logger.info('Claude Code extension activated successfully');

      // Show welcome message if first activation
      if (!this.context.globalState.get('claude.welcomed')) {
        this.showWelcomeMessage();
        await this.context.globalState.update('claude.welcomed', true);
      }
    } catch (error) {
      this.state.lastError = error as Error;
      console.error('Failed to activate Claude Code extension:', error);
      vscode.window.showErrorMessage(
        `Failed to activate Claude Code: ${error}. Check the output channel for details.`,
      );
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    if (!this.state.isActivated) {
      return;
    }

    this.state.components.logger?.info('Deactivating Claude Code extension...');

    try {
      // Shutdown services in reverse order
      if (this.state.components.claudeService) {
        await this.state.components.claudeService.shutdown();
      }

      // Dispose all disposables
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];

      // Clear component references
      this.state.components = {};
      this.state.isActivated = false;
      this.state.isInitialized = false;

      console.log('Claude Code extension deactivated successfully');
    } catch (error) {
      console.error('Error during deactivation:', error);
      // Don't throw during deactivation
    }
  }

  private async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      return;
    }

    const { authService, claudeService, logger } = this.state.components;

    if (!authService || !claudeService || !logger) {
      throw new Error('Required components not available for initialization');
    }

    logger.info('Initializing Claude Code services...');

    try {
      // Initialize auth service
      await authService.initialize();

      // Only initialize Claude service if auth is valid
      if (authService.getStatus() === 'valid') {
        await claudeService.initialize();
      } else {
        logger.warning(
          'Skipping Claude service initialization - authentication not configured',
        );
        this.promptForApiKey();
      }

      this.state.isInitialized = true;
      this.state.initializationTime = new Date();
      logger.info('Claude Code services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services', error);
      throw error;
    }
  }

  private registerCommands(): void {
    const { authService, configService, claudeService, outputChannel } =
      this.state.components;

    if (!authService || !configService || !claudeService || !outputChannel) {
      throw new Error(
        'Required components not available for command registration',
      );
    }

    // Register authentication commands
    registerClaudeAuthCommands(this.context, authService);

    // Register configuration commands
    registerClaudeConfigCommands(this.context, configService);

    // Register interaction commands
    registerClaudeInteractionCommands(this.context, claudeService);

    // Register lifecycle commands
    this.registerLifecycleCommands();
  }

  private registerLifecycleCommands(): void {
    // Restart command
    const restartCommand = vscode.commands.registerCommand(
      'stagewise-cc.claude.restart',
      async () => {
        try {
          vscode.window.showInformationMessage('Restarting Claude service...');
          await this.restart();
          vscode.window.showInformationMessage(
            'Claude service restarted successfully',
          );
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to restart: ${error}`);
        }
      },
    );

    // Show logs command
    const showLogsCommand = vscode.commands.registerCommand(
      'stagewise-cc.claude.showLogs',
      () => {
        this.state.components.outputChannel?.show();
      },
    );

    // Clear logs command
    const clearLogsCommand = vscode.commands.registerCommand(
      'stagewise-cc.claude.clearLogs',
      () => {
        this.state.components.outputChannel?.clear();
        vscode.window.showInformationMessage('Claude logs cleared');
      },
    );

    // Show error metrics command
    const showMetricsCommand = vscode.commands.registerCommand(
      'stagewise-cc.claude.showErrorMetrics',
      () => {
        const metrics = this.state.components.errorHandler?.getMetrics();
        if (metrics) {
          const message = [
            `Total Errors: ${metrics.totalErrors}`,
            `Recovery Attempts: ${metrics.recoveryAttempts}`,
            `Successful Recoveries: ${metrics.successfulRecoveries}`,
            `Uptime: ${this.getUptime()}`,
          ].join('\n');

          vscode.window.showInformationMessage('Claude Error Metrics', {
            modal: true,
            detail: message,
          });
        }
      },
    );

    this.disposables.push(
      restartCommand,
      showLogsCommand,
      clearLogsCommand,
      showMetricsCommand,
    );
  }

  private setupGlobalErrorHandling(): void {
    // Handle uncaught errors in the extension
    process.on('uncaughtException', (error) => {
      this.state.components.logger?.error('Uncaught exception', error);
      this.state.components.errorHandler?.handleError(error, {
        operation: 'uncaughtException',
        component: 'global',
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.state.components.logger?.error('Unhandled rejection', reason);
      this.state.components.errorHandler?.handleError(
        new Error(`Unhandled rejection: ${reason}`),
        {
          operation: 'unhandledRejection',
          component: 'global',
        },
      );
    });
  }

  private async restart(): Promise<void> {
    this.state.components.logger?.info('Restarting Claude Code extension...');

    // Shutdown current instance
    if (this.state.components.claudeService) {
      await this.state.components.claudeService.shutdown();
    }

    // Reinitialize
    this.state.isInitialized = false;
    await this.initialize();
  }

  private showWelcomeMessage(): void {
    const message =
      'Welcome to Claude Code! Get started by setting your API key.';
    vscode.window
      .showInformationMessage(message, 'Set API Key', 'Open Documentation')
      .then((selection) => {
        if (selection === 'Set API Key') {
          vscode.commands.executeCommand('stagewise-cc.claude.setApiKey');
        } else if (selection === 'Open Documentation') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://docs.claude.ai/vscode'),
          );
        }
      });
  }

  private promptForApiKey(): void {
    vscode.window
      .showWarningMessage(
        'Claude API key not configured. Set your API key to start using Claude.',
        'Set API Key',
        'Later',
      )
      .then((selection) => {
        if (selection === 'Set API Key') {
          vscode.commands.executeCommand('stagewise-cc.claude.setApiKey');
        }
      });
  }

  private getUptime(): string {
    if (!this.state.activationTime) {
      return 'Unknown';
    }

    const uptimeMs = Date.now() - this.state.activationTime.getTime();
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);

    return `${hours}h ${minutes}m ${seconds}s`;
  }

  getState(): LifecycleState {
    return { ...this.state };
  }
}

export function createLifecycleManager(
  context: vscode.ExtensionContext,
): LifecycleManager {
  return new LifecycleManager(context);
}
