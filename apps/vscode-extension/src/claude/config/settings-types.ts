import type { ClaudeModel } from '../config-types';

export interface ClaudeSettings {
  api: {
    key: string;
    endpoint?: string;
    timeout: number;
    maxRetries: number;
  };
  model: {
    name: ClaudeModel;
    temperature: number;
    maxTokens: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
  behavior: {
    streamResponses: boolean;
    autoSave: boolean;
    confirmBeforeApply: boolean;
    autoRetry: boolean;
    retryDelay: number;
  };
  ui: {
    showInStatusBar: boolean;
    showNotifications: boolean;
    theme: 'light' | 'dark' | 'auto';
    compactMode: boolean;
  };
  context: {
    maxFileSize: number;
    maxFiles: number;
    includeHiddenFiles: boolean;
    filePatterns: string[];
    excludePatterns: string[];
  };
  advanced: {
    debugMode: boolean;
    telemetry: boolean;
    experimental: Record<string, any>;
    customHeaders?: Record<string, string>;
    proxy?: {
      enabled: boolean;
      host: string;
      port: number;
      auth?: {
        username: string;
        password: string;
      };
    };
  };
}

export interface SettingsChangeEvent {
  key: string;
  oldValue: any;
  newValue: any;
  scope: 'workspace' | 'user' | 'default';
  timestamp: Date;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  key: string;
  message: string;
  value: any;
  suggestion?: string;
}

export interface ValidationWarning {
  key: string;
  message: string;
  impact?: string;
}

export interface SettingsMetadata {
  version: string;
  lastModified: Date;
  source: 'default' | 'user' | 'workspace' | 'imported';
}

export interface SettingsProfile {
  id: string;
  name: string;
  description?: string;
  settings: Partial<ClaudeSettings>;
  isActive: boolean;
  createdAt: Date;
  modifiedAt: Date;
}
