import { ClaudeConfiguration, ClaudeModel, LogLevel } from './config-types';

export const DEFAULT_CONFIGURATION: ClaudeConfiguration = {
  // Model settings
  model: ClaudeModel.CLAUDE_4_SONNET,
  temperature: 0.7,
  maxTokens: 4096,
  
  // Behavior settings
  streamResponses: true,
  autoSave: true,
  contextWindow: {
    maxSize: 100000,
    includeWorkspaceContext: true,
    includeFileContext: true,
    includeDomContext: true,
    filePatterns: ['**/*.{ts,tsx,js,jsx,py,java,cpp,c,h,go,rs,rb,php,swift,kt,scala,r,m,dart}'],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/vendor/**']
  },
  
  // UI settings
  showInStatusBar: true,
  showNotifications: true,
  outputChannelLevel: LogLevel.INFO,
  
  // Performance settings
  timeout: 120000, // 2 minutes
  maxRetries: 3,
  cacheResponses: true,
  cacheDuration: 3600000, // 1 hour
  
  // Privacy settings
  telemetry: {
    enabled: false,
    includeUsageMetrics: false,
    includeErrorReports: false,
    anonymizeData: true
  },
  
  // Advanced settings
  experimental: {
    enableBetaFeatures: false,
    debugMode: false
  }
};

export const CONFIGURATION_METADATA = {
  'stagewise-cc.claude.model': {
    type: 'string',
    default: DEFAULT_CONFIGURATION.model,
    enum: Object.values(ClaudeModel),
    enumDescriptions: [
      'Claude 3 Opus - Most capable model for complex tasks',
      'Claude 3 Sonnet - Balanced performance and speed',
      'Claude 3 Haiku - Fastest model for simple tasks',
      'Claude 3.5 Sonnet - Latest model with improved capabilities',
      'Claude 4 Opus - Most advanced model with superior reasoning',
      'Claude 4 Sonnet - Latest balanced model with enhanced capabilities'
    ],
    description: 'The Claude model to use for AI assistance'
  },
  'stagewise-cc.claude.temperature': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.temperature,
    minimum: 0,
    maximum: 1,
    description: 'Controls randomness in responses (0 = deterministic, 1 = creative)'
  },
  'stagewise-cc.claude.maxTokens': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.maxTokens,
    minimum: 1,
    maximum: 100000,
    description: 'Maximum number of tokens in Claude responses'
  },
  'stagewise-cc.claude.streamResponses': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.streamResponses,
    description: 'Stream responses as they are generated'
  },
  'stagewise-cc.claude.autoSave': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.autoSave,
    description: 'Automatically save conversation history'
  },
  'stagewise-cc.claude.contextWindow.maxSize': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.contextWindow.maxSize,
    minimum: 1000,
    maximum: 200000,
    description: 'Maximum size of context window in characters'
  },
  'stagewise-cc.claude.contextWindow.includeWorkspaceContext': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.contextWindow.includeWorkspaceContext,
    description: 'Include workspace information in context'
  },
  'stagewise-cc.claude.contextWindow.includeFileContext': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.contextWindow.includeFileContext,
    description: 'Include current file content in context'
  },
  'stagewise-cc.claude.contextWindow.includeDomContext': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.contextWindow.includeDomContext,
    description: 'Include DOM element context from browser'
  },
  'stagewise-cc.claude.contextWindow.filePatterns': {
    type: 'array',
    default: DEFAULT_CONFIGURATION.contextWindow.filePatterns,
    description: 'File patterns to include in context'
  },
  'stagewise-cc.claude.contextWindow.excludePatterns': {
    type: 'array',
    default: DEFAULT_CONFIGURATION.contextWindow.excludePatterns,
    description: 'File patterns to exclude from context'
  },
  'stagewise-cc.claude.showInStatusBar': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.showInStatusBar,
    description: 'Show Claude status in the status bar'
  },
  'stagewise-cc.claude.showNotifications': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.showNotifications,
    description: 'Show notification messages'
  },
  'stagewise-cc.claude.outputChannelLevel': {
    type: 'string',
    default: DEFAULT_CONFIGURATION.outputChannelLevel,
    enum: Object.values(LogLevel),
    description: 'Logging level for the output channel'
  },
  'stagewise-cc.claude.timeout': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.timeout,
    minimum: 10000,
    maximum: 600000,
    description: 'Request timeout in milliseconds'
  },
  'stagewise-cc.claude.maxRetries': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.maxRetries,
    minimum: 0,
    maximum: 10,
    description: 'Maximum number of retry attempts'
  },
  'stagewise-cc.claude.cacheResponses': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.cacheResponses,
    description: 'Cache Claude responses for faster repeated queries'
  },
  'stagewise-cc.claude.cacheDuration': {
    type: 'number',
    default: DEFAULT_CONFIGURATION.cacheDuration,
    minimum: 0,
    maximum: 86400000,
    description: 'Cache duration in milliseconds'
  },
  'stagewise-cc.claude.telemetry.enabled': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.telemetry.enabled,
    description: 'Enable telemetry data collection (opt-in)'
  },
  'stagewise-cc.claude.telemetry.includeUsageMetrics': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.telemetry.includeUsageMetrics,
    description: 'Include usage metrics in telemetry'
  },
  'stagewise-cc.claude.telemetry.includeErrorReports': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.telemetry.includeErrorReports,
    description: 'Include error reports in telemetry'
  },
  'stagewise-cc.claude.telemetry.anonymizeData': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.telemetry.anonymizeData,
    description: 'Anonymize telemetry data before sending'
  },
  'stagewise-cc.claude.experimental.enableBetaFeatures': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.experimental!.enableBetaFeatures,
    description: 'Enable experimental beta features'
  },
  'stagewise-cc.claude.experimental.customEndpoint': {
    type: ['string', 'null'],
    default: null,
    description: 'Custom API endpoint (advanced users only)'
  },
  'stagewise-cc.claude.experimental.debugMode': {
    type: 'boolean',
    default: DEFAULT_CONFIGURATION.experimental!.debugMode,
    description: 'Enable debug mode with verbose logging'
  }
};