import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import { ClaudeModel } from '../config-types';
import type {
  ClaudeSettings,
  SettingsChangeEvent,
  SettingsMetadata,
  SettingsProfile,
} from './settings-types';

/**
 * Manages all Claude configuration settings
 */
export class SettingsManager extends EventEmitter {
  private readonly logger = new Logger('SettingsManager');
  private readonly configSection = 'stagewise.claude';
  private settings: ClaudeSettings;
  private metadata: SettingsMetadata;
  private profiles = new Map<string, SettingsProfile>();
  private activeProfileId?: string;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
    this.settings = this.getDefaultSettings();
    this.metadata = {
      version: '1.0.0',
      lastModified: new Date(),
      source: 'default',
    };
    this.initialize();
  }

  /**
   * Get a setting value
   */
  get<T>(key: string): T {
    const keys = key.split('.');
    let value: any = this.settings;

    for (const k of keys) {
      value = value?.[k];
    }

    return value as T;
  }

  /**
   * Set a setting value
   */
  async set(key: string, value: any): Promise<void> {
    const oldValue = this.get(key);

    // Update in-memory settings
    const keys = key.split('.');
    let target: any = this.settings;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]]) {
        target[keys[i]] = {};
      }
      target = target[keys[i]];
    }

    target[keys[keys.length - 1]] = value;

    // Save to VSCode settings
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);

    // Update metadata
    this.metadata.lastModified = new Date();
    this.metadata.source = 'user';

    // Emit change event
    const event: SettingsChangeEvent = {
      key,
      oldValue,
      newValue: value,
      scope: 'workspace',
      timestamp: new Date(),
    };

    this.emit('change', event);
    this.logger.info(`Setting updated: ${key} = ${JSON.stringify(value)}`);
  }

  /**
   * Get all settings
   */
  getAll(): ClaudeSettings {
    return { ...this.settings };
  }

  /**
   * Reset settings to defaults
   */
  async reset(key?: string): Promise<void> {
    if (key) {
      // Reset specific key
      const defaultValue = this.getDefaultValue(key);
      await this.set(key, defaultValue);
    } else {
      // Reset all settings
      this.settings = this.getDefaultSettings();
      const config = vscode.workspace.getConfiguration(this.configSection);

      // Clear all custom settings
      for (const section of Object.keys(this.settings)) {
        await config.update(
          section,
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
        await config.update(
          section,
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }

      this.metadata.source = 'default';
      this.emit('reset');
      this.logger.info('All settings reset to defaults');
    }
  }

  /**
   * Listen for setting changes
   */
  onDidChange(listener: (e: SettingsChangeEvent) => void): vscode.Disposable {
    this.on('change', listener);
    return new vscode.Disposable(() => {
      this.off('change', listener);
    });
  }

  /**
   * Export settings
   */
  async exportSettings(): Promise<string> {
    const exportData = {
      version: this.metadata.version,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      profiles: Array.from(this.profiles.values()),
      activeProfile: this.activeProfileId,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import settings
   */
  async importSettings(data: string): Promise<void> {
    try {
      const importData = JSON.parse(data);

      // Validate version compatibility
      if (!this.isVersionCompatible(importData.version)) {
        throw new Error(`Incompatible settings version: ${importData.version}`);
      }

      // Import settings
      this.settings = { ...this.getDefaultSettings(), ...importData.settings };

      // Import profiles
      if (importData.profiles) {
        for (const profile of importData.profiles) {
          this.profiles.set(profile.id, profile);
        }
      }

      // Set active profile
      if (
        importData.activeProfile &&
        this.profiles.has(importData.activeProfile)
      ) {
        this.activeProfileId = importData.activeProfile;
      }

      // Save to VSCode settings
      await this.saveAllSettings();

      this.metadata.source = 'imported';
      this.emit('imported');
      this.logger.info('Settings imported successfully');
    } catch (error) {
      this.logger.error('Failed to import settings:', error);
      throw new Error(`Failed to import settings: ${error}`);
    }
  }

  /**
   * Create a settings profile
   */
  async createProfile(name: string, description?: string): Promise<string> {
    const id = `profile_${Date.now()}`;
    const profile: SettingsProfile = {
      id,
      name,
      description,
      settings: { ...this.settings },
      isActive: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
    };

    this.profiles.set(id, profile);
    await this.saveProfiles();

    this.logger.info(`Created profile: ${name} (${id})`);
    return id;
  }

  /**
   * Switch to a profile
   */
  async switchProfile(profileId: string): Promise<void> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    // Deactivate current profile
    if (this.activeProfileId) {
      const currentProfile = this.profiles.get(this.activeProfileId);
      if (currentProfile) {
        currentProfile.isActive = false;
      }
    }

    // Apply profile settings
    this.settings = { ...this.getDefaultSettings(), ...profile.settings };
    await this.saveAllSettings();

    // Activate new profile
    profile.isActive = true;
    this.activeProfileId = profileId;
    await this.saveProfiles();

    this.emit('profileChanged', profileId);
    this.logger.info(`Switched to profile: ${profile.name}`);
  }

  /**
   * Delete a profile
   */
  async deleteProfile(profileId: string): Promise<void> {
    if (profileId === this.activeProfileId) {
      throw new Error('Cannot delete active profile');
    }

    this.profiles.delete(profileId);
    await this.saveProfiles();

    this.logger.info(`Deleted profile: ${profileId}`);
  }

  /**
   * Get all profiles
   */
  getProfiles(): SettingsProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.removeAllListeners();
  }

  /**
   * Initialize settings
   */
  private initialize(): void {
    // Load settings from VSCode configuration
    this.loadSettings();

    // Load profiles
    this.loadProfiles();

    // Watch for configuration changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(this.configSection)) {
        this.handleConfigurationChange(e);
      }
    });

    this.disposables.push(configWatcher);
  }

  /**
   * Load settings from VSCode configuration
   */
  private loadSettings(): void {
    const config = vscode.workspace.getConfiguration(this.configSection);
    const defaults = this.getDefaultSettings();

    // Merge with defaults
    this.settings = this.mergeSettings(defaults, config);
    this.logger.debug('Settings loaded:', this.settings);
  }

  /**
   * Load profiles from storage
   */
  private loadProfiles(): void {
    const stored = this.context.globalState.get<SettingsProfile[]>(
      'claude.profiles',
      [],
    );

    for (const profile of stored) {
      this.profiles.set(profile.id, profile);
      if (profile.isActive) {
        this.activeProfileId = profile.id;
      }
    }
  }

  /**
   * Save all settings to VSCode configuration
   */
  private async saveAllSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);

    // Save each section
    for (const [section, values] of Object.entries(this.settings)) {
      await config.update(
        section,
        values,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  }

  /**
   * Save profiles to storage
   */
  private async saveProfiles(): Promise<void> {
    const profiles = Array.from(this.profiles.values());
    await this.context.globalState.update('claude.profiles', profiles);
  }

  /**
   * Handle configuration changes
   */
  private handleConfigurationChange(e: vscode.ConfigurationChangeEvent): void {
    const oldSettings = { ...this.settings };
    this.loadSettings();

    // Find changed keys
    const changedKeys = this.findChangedKeys(oldSettings, this.settings);

    // Emit change events for each changed key
    for (const key of changedKeys) {
      const event: SettingsChangeEvent = {
        key,
        oldValue: this.getValueByPath(oldSettings, key),
        newValue: this.getValueByPath(this.settings, key),
        scope: 'workspace',
        timestamp: new Date(),
      };

      this.emit('change', event);
    }
  }

  /**
   * Get default settings
   */
  private getDefaultSettings(): ClaudeSettings {
    return {
      api: {
        key: '',
        endpoint: 'https://api.anthropic.com',
        timeout: 30000,
        maxRetries: 3,
      },
      model: {
        name: ClaudeModel.CLAUDE_3_5_SONNET,
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1,
        topK: undefined,
        stopSequences: [],
      },
      behavior: {
        streamResponses: true,
        autoSave: true,
        confirmBeforeApply: true,
        autoRetry: true,
        retryDelay: 1000,
      },
      ui: {
        showInStatusBar: true,
        showNotifications: true,
        theme: 'auto',
        compactMode: false,
      },
      context: {
        maxFileSize: 1024 * 1024, // 1MB
        maxFiles: 10,
        includeHiddenFiles: false,
        filePatterns: [
          '**/*.{ts,tsx,js,jsx,py,java,cpp,c,h,cs,go,rs,php,rb,swift}',
        ],
        excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      },
      advanced: {
        debugMode: false,
        telemetry: true,
        experimental: {},
        customHeaders: undefined,
        proxy: undefined,
      },
    };
  }

  /**
   * Get default value for a key
   */
  private getDefaultValue(key: string): any {
    return this.getValueByPath(this.getDefaultSettings(), key);
  }

  /**
   * Merge settings with defaults
   */
  private mergeSettings(defaults: any, config: any): any {
    const merged: any = {};

    for (const key in defaults) {
      if (typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
        merged[key] = this.mergeSettings(defaults[key], config.get(key, {}));
      } else {
        merged[key] = config.get(key, defaults[key]);
      }
    }

    return merged;
  }

  /**
   * Find changed keys between two settings objects
   */
  private findChangedKeys(
    oldSettings: any,
    newSettings: any,
    prefix = '',
  ): string[] {
    const changed: string[] = [];

    for (const key in newSettings) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (
        typeof newSettings[key] === 'object' &&
        !Array.isArray(newSettings[key])
      ) {
        changed.push(
          ...this.findChangedKeys(
            oldSettings[key] || {},
            newSettings[key],
            fullKey,
          ),
        );
      } else if (oldSettings[key] !== newSettings[key]) {
        changed.push(fullKey);
      }
    }

    return changed;
  }

  /**
   * Get value by path
   */
  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      value = value?.[key];
    }

    return value;
  }

  /**
   * Check version compatibility
   */
  private isVersionCompatible(version: string): boolean {
    // Simple major version check
    const [major] = version.split('.');
    const [currentMajor] = this.metadata.version.split('.');
    return major === currentMajor;
  }
}
