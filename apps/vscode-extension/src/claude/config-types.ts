export interface ClaudeConfiguration {
  // Model settings
  model: ClaudeModel;
  temperature: number;
  maxTokens: number;

  // Behavior settings
  streamResponses: boolean;
  autoSave: boolean;
  contextWindow: ContextWindowConfig;

  // UI settings
  showInStatusBar: boolean;
  showNotifications: boolean;
  outputChannelLevel: LogLevel;

  // Performance settings
  timeout: number;
  maxRetries: number;
  cacheResponses: boolean;
  cacheDuration: number;

  // Privacy settings
  telemetry: TelemetryConfig;

  // Advanced settings
  customHeaders?: Record<string, string>;
  proxy?: ProxyConfig;
  experimental?: ExperimentalConfig;
}

export enum ClaudeModel {
  CLAUDE_3_OPUS = 'claude-3-opus-20240229',
  CLAUDE_3_SONNET = 'claude-3-sonnet-20240229',
  CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',
  CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20241022',
  CLAUDE_4_OPUS = 'claude-4-opus-20250115',
  CLAUDE_4_SONNET = 'claude-4-sonnet-20250115',
}

export interface ContextWindowConfig {
  maxSize: number;
  includeWorkspaceContext: boolean;
  includeFileContext: boolean;
  includeDomContext: boolean;
  filePatterns: string[];
  excludePatterns: string[];
}

export enum LogLevel {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace',
}

export interface TelemetryConfig {
  enabled: boolean;
  includeUsageMetrics: boolean;
  includeErrorReports: boolean;
  anonymizeData: boolean;
}

export interface ProxyConfig {
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
}

export interface ExperimentalConfig {
  enableBetaFeatures: boolean;
  customEndpoint?: string;
  debugMode: boolean;
}

export interface ConfigurationProfile {
  name: string;
  description?: string;
  config: Partial<ClaudeConfiguration>;
  isDefault?: boolean;
}

export interface ConfigurationValidationResult {
  isValid: boolean;
  errors: ConfigurationError[];
  warnings: string[];
}

export interface ConfigurationError {
  field: string;
  message: string;
  value?: any;
}

export enum ConfigurationScope {
  WORKSPACE = 'workspace',
  USER = 'user',
  DEFAULT = 'default',
}

export interface ConfigurationChangeEvent {
  affectedKeys: string[];
  scope: ConfigurationScope;
  oldValues: Partial<ClaudeConfiguration>;
  newValues: Partial<ClaudeConfiguration>;
}
