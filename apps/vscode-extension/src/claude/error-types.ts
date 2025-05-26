export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  CONFIGURATION = 'configuration',
  SUBPROCESS = 'subprocess',
  NETWORK = 'network',
  API = 'api',
  VALIDATION = 'validation',
  SYSTEM = 'system',
  USER = 'user',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  CRITICAL = 'critical',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

export interface ClaudeError extends Error {
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;
  details?: any;
  timestamp: Date;
  recoverable: boolean;
  userMessage?: string;
  developerMessage?: string;
  suggestions?: string[];
}

export class BaseClaudeError extends Error implements ClaudeError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;
  details?: any;
  timestamp: Date;
  recoverable: boolean;
  userMessage?: string;
  developerMessage?: string;
  suggestions?: string[];

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    options?: Partial<ClaudeError>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.severity = severity;
    this.timestamp = new Date();
    this.recoverable = options?.recoverable ?? true;
    this.code = options?.code;
    this.details = options?.details;
    this.userMessage = options?.userMessage;
    this.developerMessage = options?.developerMessage;
    this.suggestions = options?.suggestions;
  }
}

export class AuthenticationError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.AUTHENTICATION, ErrorSeverity.CRITICAL, {
      recoverable: false,
      suggestions: [
        'Check your API key configuration',
        'Ensure your API key is valid and not expired',
        'Run "Claude: Set API Key" command',
      ],
      ...options,
    });
  }
}

export class ConfigurationError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.CONFIGURATION, ErrorSeverity.ERROR, {
      suggestions: [
        'Check your Claude settings',
        'Reset to default configuration',
        'Review the configuration documentation',
      ],
      ...options,
    });
  }
}

export class SubprocessError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.SUBPROCESS, ErrorSeverity.ERROR, {
      suggestions: [
        'Check if Claude CLI is installed',
        'Restart the Claude service',
        'Check the output channel for details',
      ],
      ...options,
    });
  }
}

export class NetworkError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.ERROR, {
      recoverable: true,
      suggestions: [
        'Check your internet connection',
        'Verify proxy settings if applicable',
        'Try again in a few moments',
      ],
      ...options,
    });
  }
}

export class APIError extends BaseClaudeError {
  constructor(
    message: string,
    statusCode?: number,
    options?: Partial<ClaudeError>,
  ) {
    const severity =
      statusCode === 429 ? ErrorSeverity.WARNING : ErrorSeverity.ERROR;
    const suggestions =
      statusCode === 429
        ? ['You have hit the rate limit', 'Wait a moment before trying again']
        : ['Check the API documentation', 'Verify your request parameters'];

    super(message, ErrorCategory.API, severity, {
      code: statusCode?.toString(),
      recoverable: statusCode !== 401,
      suggestions,
      ...options,
    });
  }
}

export class ValidationError extends BaseClaudeError {
  constructor(message: string, field?: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.VALIDATION, ErrorSeverity.WARNING, {
      details: { field },
      suggestions: [
        'Check the input format',
        'Review the validation requirements',
        'Consult the documentation for valid values',
      ],
      ...options,
    });
  }
}

export class SystemError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL, {
      recoverable: false,
      suggestions: [
        'Restart VSCode',
        'Check system resources',
        'Report this issue if it persists',
      ],
      ...options,
    });
  }
}

export class UserError extends BaseClaudeError {
  constructor(message: string, options?: Partial<ClaudeError>) {
    super(message, ErrorCategory.USER, ErrorSeverity.INFO, {
      recoverable: true,
      ...options,
    });
  }
}

export interface ErrorContext {
  operation: string;
  component: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  additionalData?: Record<string, any>;
}

export interface ErrorReport {
  error: ClaudeError;
  context: ErrorContext;
  stackTrace?: string;
  environment: {
    vscodeVersion: string;
    extensionVersion: string;
    platform: string;
    nodeVersion: string;
  };
}

export interface RecoveryStrategy {
  errorCategory: ErrorCategory;
  errorCode?: string;
  canRecover: (error: ClaudeError) => boolean;
  recover: (error: ClaudeError) => Promise<void>;
  maxAttempts: number;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  recoveryAttempts: number;
  successfulRecoveries: number;
  lastError?: ClaudeError;
  startTime: Date;
}
