/**
 * CLI detection and setup system for Claude Code
 */

export { ClaudeCodeCLIDetector } from './cli-detector';
export { CLIInstallationGuide } from './installation-guide';
export { CLISetupAssistant } from './cli-setup-assistant';
export { CLIConfigStorage } from './cli-config-storage';

export type {
  CLIDetectionResult,
  CLIDetectionError,
  InstallationGuidance,
  SetupResult,
  CLIConfig,
  CLIValidation,
  CLICapabilities,
} from './cli-types';
