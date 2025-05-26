import * as vscode from 'vscode';
import {
  ClaudeError,
  ErrorCategory,
  ErrorSeverity,
  RecoveryStrategy,
  ErrorMetrics,
  ErrorContext,
  ErrorReport,
  AuthenticationError,
  SubprocessError,
  NetworkError
} from './error-types';
import { ClaudeAuthService } from './auth-service';
import { ClaudeService } from './claude-service';

export class ErrorHandler {
  private recoveryStrategies: Map<ErrorCategory, RecoveryStrategy> = new Map();
  private errorMetrics: ErrorMetrics;
  private recoveryAttempts: Map<string, number> = new Map();
  
  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel,
    private authService?: ClaudeAuthService,
    private claudeService?: ClaudeService
  ) {
    this.errorMetrics = {
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsBySeverity: {} as Record<ErrorSeverity, number>,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      startTime: new Date()
    };
    
    this.setupRecoveryStrategies();
  }
  
  async handleError(error: Error | ClaudeError, context?: ErrorContext): Promise<void> {
    const claudeError = this.normalizeError(error);
    
    // Update metrics
    this.updateMetrics(claudeError);
    
    // Log error
    this.logError(claudeError, context);
    
    // Show user notification based on severity
    await this.notifyUser(claudeError);
    
    // Attempt recovery if applicable
    if (claudeError.recoverable) {
      await this.attemptRecovery(claudeError, context);
    }
    
    // Report telemetry if enabled
    if (this.shouldReportError(claudeError)) {
      await this.reportError(claudeError, context);
    }
  }
  
  async attemptRecovery(error: ClaudeError, context?: ErrorContext): Promise<boolean> {
    const strategy = this.recoveryStrategies.get(error.category);
    if (!strategy) {
      return false;
    }
    
    const errorKey = `${error.category}:${error.code || 'default'}`;
    const attempts = this.recoveryAttempts.get(errorKey) || 0;
    
    if (attempts >= strategy.maxAttempts) {
      this.log('Max recovery attempts reached', 'warning');
      return false;
    }
    
    if (!strategy.canRecover(error)) {
      return false;
    }
    
    this.recoveryAttempts.set(errorKey, attempts + 1);
    this.errorMetrics.recoveryAttempts++;
    
    try {
      await strategy.recover(error);
      this.errorMetrics.successfulRecoveries++;
      this.recoveryAttempts.delete(errorKey);
      this.log('Recovery successful', 'info');
      return true;
    } catch (recoveryError) {
      this.log(`Recovery failed: ${recoveryError}`, 'error');
      return false;
    }
  }
  
  getMetrics(): ErrorMetrics {
    return { ...this.errorMetrics };
  }
  
  resetMetrics(): void {
    this.errorMetrics = {
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsBySeverity: {} as Record<ErrorSeverity, number>,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      startTime: new Date()
    };
  }
  
  private setupRecoveryStrategies(): void {
    // Authentication recovery
    this.recoveryStrategies.set(ErrorCategory.AUTHENTICATION, {
      errorCategory: ErrorCategory.AUTHENTICATION,
      canRecover: (error) => error.code !== '401',
      recover: async (error) => {
        if (this.authService) {
          // Prompt user to re-enter API key
          await vscode.commands.executeCommand('stagewise.claude.setApiKey');
        }
      },
      maxAttempts: 3
    });
    
    // Subprocess recovery
    this.recoveryStrategies.set(ErrorCategory.SUBPROCESS, {
      errorCategory: ErrorCategory.SUBPROCESS,
      canRecover: () => true,
      recover: async (error) => {
        if (this.claudeService) {
          // Restart Claude service
          await this.claudeService.shutdown();
          await this.claudeService.initialize();
        }
      },
      maxAttempts: 3
    });
    
    // Network recovery
    this.recoveryStrategies.set(ErrorCategory.NETWORK, {
      errorCategory: ErrorCategory.NETWORK,
      canRecover: () => true,
      recover: async (error) => {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      },
      maxAttempts: 5
    });
    
    // API recovery (rate limiting)
    this.recoveryStrategies.set(ErrorCategory.API, {
      errorCategory: ErrorCategory.API,
      errorCode: '429',
      canRecover: (error) => error.code === '429',
      recover: async (error) => {
        // Wait for rate limit to reset
        const waitTime = error.details?.retryAfter || 60;
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      },
      maxAttempts: 3
    });
  }
  
  private normalizeError(error: Error | ClaudeError): ClaudeError {
    if ('category' in error && 'severity' in error) {
      return error as ClaudeError;
    }
    
    // Try to categorize the error
    const message = error.message.toLowerCase();
    
    if (message.includes('auth') || message.includes('api key')) {
      return new AuthenticationError(error.message, {
        details: { originalError: error }
      });
    }
    
    if (message.includes('subprocess') || message.includes('process')) {
      return new SubprocessError(error.message, {
        details: { originalError: error }
      });
    }
    
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return new NetworkError(error.message, {
        details: { originalError: error }
      });
    }
    
    // Default to system error
    return {
      name: 'SystemError',
      message: error.message,
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      timestamp: new Date(),
      recoverable: true,
      details: { originalError: error }
    } as ClaudeError;
  }
  
  private updateMetrics(error: ClaudeError): void {
    this.errorMetrics.totalErrors++;
    this.errorMetrics.errorsByCategory[error.category] = 
      (this.errorMetrics.errorsByCategory[error.category] || 0) + 1;
    this.errorMetrics.errorsBySeverity[error.severity] = 
      (this.errorMetrics.errorsBySeverity[error.severity] || 0) + 1;
    this.errorMetrics.lastError = error;
  }
  
  private async notifyUser(error: ClaudeError): Promise<void> {
    const message = error.userMessage || error.message;
    const actions: string[] = [];
    
    if (error.suggestions && error.suggestions.length > 0) {
      actions.push('Show Suggestions');
    }
    
    if (error.recoverable) {
      actions.push('Try Recovery');
    }
    
    let showMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
    
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.ERROR:
        showMessage = vscode.window.showErrorMessage;
        break;
      case ErrorSeverity.WARNING:
        showMessage = vscode.window.showWarningMessage;
        break;
      case ErrorSeverity.INFO:
      default:
        showMessage = vscode.window.showInformationMessage;
        break;
    }
    
    const selection = await showMessage(message, ...actions);
    
    if (selection === 'Show Suggestions' && error.suggestions) {
      const suggestion = await vscode.window.showQuickPick(error.suggestions, {
        placeHolder: 'Select a suggestion to try'
      });
      
      if (suggestion) {
        // Could implement specific actions based on suggestions
        vscode.window.showInformationMessage(`Suggestion: ${suggestion}`);
      }
    } else if (selection === 'Try Recovery') {
      await this.attemptRecovery(error);
    }
  }
  
  private logError(error: ClaudeError, context?: ErrorContext): void {
    const timestamp = new Date().toISOString();
    const contextStr = context ? JSON.stringify(context, null, 2) : 'No context';
    
    const logEntry = [
      `[${timestamp}] [ERROR] [${error.category}] [${error.severity}]`,
      `Message: ${error.message}`,
      `Code: ${error.code || 'N/A'}`,
      `Recoverable: ${error.recoverable}`,
      `Developer Message: ${error.developerMessage || 'N/A'}`,
      `Context: ${contextStr}`,
      `Stack: ${error.stack || 'N/A'}`
    ].join('\n');
    
    this.outputChannel.appendLine(logEntry);
    this.outputChannel.appendLine('---');
  }
  
  private shouldReportError(error: ClaudeError): boolean {
    // Only report if telemetry is enabled and error is severe enough
    const config = vscode.workspace.getConfiguration('stagewise.claude.telemetry');
    const telemetryEnabled = config.get<boolean>('enabled', false);
    const includeErrors = config.get<boolean>('includeErrorReports', false);
    
    return telemetryEnabled && 
           includeErrors && 
           (error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.ERROR);
  }
  
  private async reportError(error: ClaudeError, context?: ErrorContext): Promise<void> {
    const report: ErrorReport = {
      error,
      context: context || {
        operation: 'unknown',
        component: 'unknown'
      },
      stackTrace: error.stack,
      environment: {
        vscodeVersion: vscode.version,
        extensionVersion: this.context.extension.packageJSON.version,
        platform: process.platform,
        nodeVersion: process.version
      }
    };
    
    // In a real implementation, this would send to a telemetry service
    this.log(`Telemetry report prepared: ${JSON.stringify(report)}`, 'info');
  }
  
  private log(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ERROR_HANDLER] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
  }
}

export function createErrorHandler(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  authService?: ClaudeAuthService,
  claudeService?: ClaudeService
): ErrorHandler {
  return new ErrorHandler(context, outputChannel, authService, claudeService);
}