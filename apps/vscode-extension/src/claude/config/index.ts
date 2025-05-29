/**
 * Configuration system for Claude integration
 */

export { SettingsManager } from './settings-manager';
export { SettingsUI } from './settings-ui';
export { SettingsValidator } from './settings-validator';
export { SettingsMigration } from './settings-migration';

export type {
  ClaudeSettings,
  SettingsChangeEvent,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SettingsMetadata,
  SettingsProfile,
} from './settings-types';
