export interface CLIDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
  error?: CLIDetectionError;
  suggestions?: string[];
}

export interface CLIDetectionError {
  type: 'not_found' | 'permission_denied' | 'version_mismatch' | 'unknown';
  message: string;
  details?: any;
}

export interface InstallationGuidance {
  title: string;
  steps: string[];
  troubleshooting: string[];
  verificationCommand?: string;
  downloadUrl?: string;
}

export interface SetupResult {
  success: boolean;
  path?: string;
  cancelled?: boolean;
  skipped?: boolean;
  error?: string;
}

export interface CLIConfig {
  path: string;
  detectedAt: string;
  version?: string;
  verified: boolean;
}

export interface CLIValidation {
  isValid: boolean;
  hasCorrectPermissions: boolean;
  isCorrectVersion: boolean;
  canExecute: boolean;
}

export interface CLICapabilities {
  supportsStreaming: boolean;
  supportsInteractive: boolean;
  supportedModels: string[];
  maxContextLength: number;
}
