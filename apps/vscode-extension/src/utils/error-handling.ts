import * as vscode from 'vscode';

export enum ErrorCode {
  MCP_CONNECTION_FAILED = 'MCP_CONNECTION_FAILED',
  MCP_TOOL_EXECUTION_FAILED = 'MCP_TOOL_EXECUTION_FAILED',
  IMAGE_PROCESSING_FAILED = 'IMAGE_PROCESSING_FAILED',
  IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class StagewiseError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any,
    public isRetryable = false,
  ) {
    super(message);
    this.name = 'StagewiseError';
  }
}

export interface ErrorContext {
  operation: string;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  additionalData?: Record<string, any>;
}

/**
 * Central error logger
 */
class ErrorLogger {
  private errors: Array<{ error: Error; context: ErrorContext }> = [];
  private maxErrors = 100;

  log(error: Error, context: ErrorContext): void {
    // Add to internal log
    this.errors.push({ error, context });

    // Trim if too many
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Log to console for debugging
    console.error(`[${context.operation}] ${error.message}`, {
      error,
      context,
    });

    // Log to VSCode output channel
    const outputChannel = vscode.window.createOutputChannel('Stagewise');
    outputChannel.appendLine(
      `[${new Date().toISOString()}] ERROR in ${context.operation}:`,
    );
    outputChannel.appendLine(`  Message: ${error.message}`);
    outputChannel.appendLine(`  Stack: ${error.stack}`);
    if (context.additionalData) {
      outputChannel.appendLine(
        `  Additional Data: ${JSON.stringify(context.additionalData, null, 2)}`,
      );
    }
  }

  getRecentErrors(count = 10): Array<{ error: Error; context: ErrorContext }> {
    return this.errors.slice(-count);
  }

  clear(): void {
    this.errors = [];
  }
}

export const errorLogger = new ErrorLogger();

/**
 * User-friendly error messages
 */
const USER_FRIENDLY_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.MCP_CONNECTION_FAILED]:
    'Failed to connect to the AI assistant. Please try again.',
  [ErrorCode.MCP_TOOL_EXECUTION_FAILED]:
    'The requested operation failed. Please try again.',
  [ErrorCode.IMAGE_PROCESSING_FAILED]:
    'Failed to process the image. Please try with a different image.',
  [ErrorCode.IMAGE_TOO_LARGE]:
    'The image is too large. Please use an image smaller than 5MB.',
  [ErrorCode.NETWORK_ERROR]:
    'Network connection failed. Please check your internet connection.',
  [ErrorCode.FILE_SYSTEM_ERROR]:
    'Failed to access the file. Please check file permissions.',
  [ErrorCode.CONFIGURATION_ERROR]:
    'Configuration error. Please check your settings.',
  [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.',
};

/**
 * Converts an error to a user-friendly message
 */
export function getUserFriendlyMessage(error: Error): string {
  if (error instanceof StagewiseError) {
    return USER_FRIENDLY_MESSAGES[error.code] || error.message;
  }
  return USER_FRIENDLY_MESSAGES[ErrorCode.UNKNOWN_ERROR];
}

/**
 * Shows an error message to the user with optional retry
 */
export async function showErrorWithRetry(
  error: Error,
  operation: string,
  onRetry?: () => Promise<void>,
): Promise<void> {
  const message = getUserFriendlyMessage(error);
  const isRetryable =
    error instanceof StagewiseError ? error.isRetryable : false;

  if (isRetryable && onRetry) {
    const action = await vscode.window.showErrorMessage(
      message,
      'Retry',
      'Cancel',
    );
    if (action === 'Retry') {
      try {
        await onRetry();
      } catch (retryError) {
        vscode.window.showErrorMessage(
          'Retry failed: ' + getUserFriendlyMessage(retryError as Error),
        );
      }
    }
  } else {
    vscode.window.showErrorMessage(message);
  }
}

/**
 * Wraps an async function with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  operation: string,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      const err = error as Error;
      errorLogger.log(err, {
        operation,
        timestamp: new Date(),
      });

      // Re-throw as StagewiseError if not already
      if (!(err instanceof StagewiseError)) {
        throw new StagewiseError(
          ErrorCode.UNKNOWN_ERROR,
          err.message,
          { originalError: err },
          false,
        );
      }
      throw err;
    }
  }) as T;
}

/**
 * Retry mechanism with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry if it's not retryable
      if (error instanceof StagewiseError && !error.isRetryable) {
        throw error;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }
  }

  throw new StagewiseError(
    ErrorCode.UNKNOWN_ERROR,
    `Operation failed after ${maxAttempts} attempts: ${lastError?.message}`,
    { originalError: lastError, attempts: maxAttempts },
    false,
  );
}

/**
 * Circuit breaker pattern for external services
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000, // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new StagewiseError(
          ErrorCode.NETWORK_ERROR,
          'Service temporarily unavailable',
          { state: this.state },
          true,
        );
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
}
