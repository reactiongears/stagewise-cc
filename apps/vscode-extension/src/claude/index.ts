// Subprocess management
export { ClaudeSubprocessWrapper } from './subprocess-wrapper';
export * from './types';
export * from './constants';

// Authentication
export { ClaudeAuthService } from './auth-service';
export * from './auth-types';
export * from './auth-constants';

// Configuration
export { ClaudeConfigService } from './config-service';
export * from './config-types';
export * from './config-defaults';

// Core service
export { ClaudeService } from './claude-service';
export * from './service-types';

// Error handling
export { ErrorHandler, createErrorHandler } from './error-handler';
export {
  ErrorCategory,
  ErrorSeverity,
  ClaudeError,
  BaseClaudeError,
  AuthenticationError,
  ConfigurationError as ConfigurationClaudeError,
  SubprocessError,
  NetworkError,
  APIError,
  ValidationError,
  SystemError,
  UserError,
  ErrorContext,
  ErrorReport,
  RecoveryStrategy,
  ErrorMetrics,
} from './error-types';

// Lifecycle management
export { LifecycleManager, createLifecycleManager } from './lifecycle-manager';

// Logging
export {
  Logger,
  ScopedLogger,
  createLogger,
  createScopedLogger,
} from './logger';

// Context interfaces
export * from './prompt-context';
export {
  // Export everything except Position to avoid conflict with service-types
  type WorkspaceInfo,
  type WorkspaceFolder,
  type FileInfo,
  type FileSelection,
  type ProjectStructure,
  type PackageInfo,
  type GitInfo,
  validateWorkspaceInfo,
  validateFileInfo,
  createFileInfo,
  isConfigurationFile,
  estimateFileImportance,
} from './workspace-types';
export {
  // Export everything except Position to avoid conflict
  type DOMElementData,
  type DOMRect,
  type DOMElementMetadata,
  type AccessibilityInfo,
  StructuralRole,
  type DOMSerializationOptions,
  DEFAULT_SERIALIZATION_OPTIONS,
  validateDOMElementData,
  createDOMElementData,
  isInteractiveElement,
  estimateElementImportance,
  serializeDOMElement,
  truncateTextContent,
} from './dom-types';
export * from './transformation-types';

// Workspace collection
export { WorkspaceCollector } from './workspace-collector';
export { FileAnalyzer } from './file-analyzer';
export { ProjectDetector } from './project-detector';
export { GitInfoCollector } from './git-info-collector';

// Prompt transformation
export { PromptTransformer } from './prompt-transformer';
export { ContextFormatter } from './context-formatter';
export { TokenManager } from './token-manager';
export * from './prompt-templates';

// Claude Agent - Task 7
export { ClaudeAgent, createClaudeAgent } from './call-claude-agent';
export type { ClaudeAgentConfig, ClaudeAgentResult } from './call-claude-agent';
