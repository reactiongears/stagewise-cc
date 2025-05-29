import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';
import {
  type ClaudeConfiguration,
  ConfigurationScope,
  type ConfigurationValidationResult,
  type ConfigurationError,
  type ConfigurationChangeEvent,
  type ConfigurationProfile,
} from './config-types';
import {
  DEFAULT_CONFIGURATION,
  CONFIGURATION_METADATA,
} from './config-defaults';

export class ClaudeConfigService extends EventEmitter {
  private static readonly CONFIG_PREFIX = 'stagewise.claude';
  private static readonly PROFILES_KEY = 'stagewise-cc.claude.profiles';
  private currentConfig: ClaudeConfiguration;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel,
  ) {
    super();
    this.currentConfig = this.loadConfiguration();
    this.setupConfigurationWatcher();
  }

  getConfiguration(): ClaudeConfiguration {
    return { ...this.currentConfig };
  }

  async updateConfiguration(
    updates: Partial<ClaudeConfiguration>,
    scope: ConfigurationScope = ConfigurationScope.WORKSPACE,
  ): Promise<void> {
    const validation = this.validateConfiguration({
      ...this.currentConfig,
      ...updates,
    });
    if (!validation.isValid) {
      throw new Error(
        `Invalid configuration: ${validation.errors.map((e) => e.message).join(', ')}`,
      );
    }

    const target =
      scope === ConfigurationScope.WORKSPACE
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    const config = vscode.workspace.getConfiguration(
      ClaudeConfigService.CONFIG_PREFIX,
    );

    for (const [key, value] of Object.entries(updates)) {
      const configKey = this.flattenKey(key, value);
      for (const [flatKey, flatValue] of Object.entries(configKey)) {
        await config.update(flatKey, flatValue, target);
      }
    }

    this.log(`Configuration updated in ${scope} scope`);
  }

  validateConfiguration(
    config: Partial<ClaudeConfiguration>,
  ): ConfigurationValidationResult {
    const errors: ConfigurationError[] = [];
    const warnings: string[] = [];

    // Validate temperature
    if (config.temperature !== undefined) {
      if (config.temperature < 0 || config.temperature > 1) {
        errors.push({
          field: 'temperature',
          message: 'Temperature must be between 0 and 1',
          value: config.temperature,
        });
      }
    }

    // Validate maxTokens
    if (config.maxTokens !== undefined) {
      if (config.maxTokens < 1 || config.maxTokens > 100000) {
        errors.push({
          field: 'maxTokens',
          message: 'Max tokens must be between 1 and 100,000',
          value: config.maxTokens,
        });
      }
    }

    // Validate timeout
    if (config.timeout !== undefined) {
      if (config.timeout < 10000) {
        errors.push({
          field: 'timeout',
          message: 'Timeout must be at least 10 seconds',
          value: config.timeout,
        });
      }
    }

    // Validate context window
    if (config.contextWindow?.maxSize !== undefined) {
      if (
        config.contextWindow.maxSize < 1000 ||
        config.contextWindow.maxSize > 200000
      ) {
        errors.push({
          field: 'contextWindow.maxSize',
          message:
            'Context window size must be between 1,000 and 200,000 characters',
          value: config.contextWindow.maxSize,
        });
      }
    }

    // Warnings
    if (config.telemetry?.enabled) {
      warnings.push(
        'Telemetry is enabled. Your usage data will be collected anonymously.',
      );
    }

    if (config.experimental?.enableBetaFeatures) {
      warnings.push('Beta features are enabled. These may be unstable.');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async resetConfiguration(
    scope: ConfigurationScope = ConfigurationScope.WORKSPACE,
  ): Promise<void> {
    const target =
      scope === ConfigurationScope.WORKSPACE
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    const config = vscode.workspace.getConfiguration(
      ClaudeConfigService.CONFIG_PREFIX,
    );

    // Reset all configuration values to defaults
    for (const key of Object.keys(CONFIGURATION_METADATA)) {
      const configKey = key.replace(
        `${ClaudeConfigService.CONFIG_PREFIX}.`,
        '',
      );
      await config.update(configKey, undefined, target);
    }

    this.log(`Configuration reset to defaults in ${scope} scope`);
  }

  async saveProfile(name: string, description?: string): Promise<void> {
    const profiles = this.getProfiles();
    const profile: ConfigurationProfile = {
      name,
      description,
      config: this.currentConfig,
    };

    profiles[name] = profile;
    await this.context.globalState.update(
      ClaudeConfigService.PROFILES_KEY,
      profiles,
    );

    this.log(`Configuration profile '${name}' saved`);
    vscode.window.showInformationMessage(
      `Configuration profile '${name}' saved successfully`,
    );
  }

  async loadProfile(name: string): Promise<void> {
    const profiles = this.getProfiles();
    const profile = profiles[name];

    if (!profile) {
      throw new Error(`Profile '${name}' not found`);
    }

    await this.updateConfiguration(
      profile.config,
      ConfigurationScope.WORKSPACE,
    );
    this.log(`Configuration profile '${name}' loaded`);
    vscode.window.showInformationMessage(
      `Configuration profile '${name}' loaded successfully`,
    );
  }

  getProfiles(): Record<string, ConfigurationProfile> {
    return this.context.globalState.get<Record<string, ConfigurationProfile>>(
      ClaudeConfigService.PROFILES_KEY,
      {},
    );
  }

  async deleteProfile(name: string): Promise<void> {
    const profiles = this.getProfiles();
    delete profiles[name];
    await this.context.globalState.update(
      ClaudeConfigService.PROFILES_KEY,
      profiles,
    );

    this.log(`Configuration profile '${name}' deleted`);
  }

  async exportConfiguration(): Promise<string> {
    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      configuration: this.currentConfig,
      profiles: this.getProfiles(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  async importConfiguration(data: string): Promise<void> {
    try {
      const importData = JSON.parse(data);

      if (!importData.version || !importData.configuration) {
        throw new Error('Invalid configuration format');
      }

      const validation = this.validateConfiguration(importData.configuration);
      if (!validation.isValid) {
        throw new Error(
          `Invalid configuration: ${validation.errors.map((e) => e.message).join(', ')}`,
        );
      }

      await this.updateConfiguration(
        importData.configuration,
        ConfigurationScope.WORKSPACE,
      );

      if (importData.profiles) {
        await this.context.globalState.update(
          ClaudeConfigService.PROFILES_KEY,
          importData.profiles,
        );
      }

      this.log('Configuration imported successfully');
      vscode.window.showInformationMessage(
        'Configuration imported successfully',
      );
    } catch (error) {
      throw new Error(`Failed to import configuration: ${error}`);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.removeAllListeners();
  }

  private loadConfiguration(): ClaudeConfiguration {
    const config = vscode.workspace.getConfiguration(
      ClaudeConfigService.CONFIG_PREFIX,
    );
    const result: any = { ...DEFAULT_CONFIGURATION };

    // Load each configuration value
    for (const [key, metadata] of Object.entries(CONFIGURATION_METADATA)) {
      const configKey = key.replace(
        `${ClaudeConfigService.CONFIG_PREFIX}.`,
        '',
      );
      const value = config.get(configKey);

      if (value !== undefined) {
        this.setNestedValue(result, configKey, value);
      }
    }

    return result as ClaudeConfiguration;
  }

  private setupConfigurationWatcher(): void {
    const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(ClaudeConfigService.CONFIG_PREFIX)) {
        const oldConfig = this.currentConfig;
        this.currentConfig = this.loadConfiguration();

        const changeEvent: ConfigurationChangeEvent = {
          affectedKeys: this.getChangedKeys(oldConfig, this.currentConfig),
          scope: ConfigurationScope.WORKSPACE,
          oldValues: oldConfig,
          newValues: this.currentConfig,
        };

        this.emit('configurationChanged', changeEvent);
        this.log('Configuration changed');
      }
    });

    this.disposables.push(watcher);
  }

  private flattenKey(
    key: string,
    value: any,
    prefix = '',
  ): Record<string, any> {
    const result: Record<string, any> = {};

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        const newKey = prefix ? `${prefix}.${k}` : k;
        Object.assign(result, this.flattenKey(k, v, newKey));
      }
    } else {
      const finalKey = prefix || key;
      result[finalKey] = value;
    }

    return result;
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
  }

  private getChangedKeys(
    oldConfig: any,
    newConfig: any,
    prefix = '',
  ): string[] {
    const changes: string[] = [];

    const allKeys = new Set([
      ...Object.keys(oldConfig),
      ...Object.keys(newConfig),
    ]);

    for (const key of allKeys) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (oldConfig[key] !== newConfig[key]) {
        if (
          typeof oldConfig[key] === 'object' &&
          typeof newConfig[key] === 'object'
        ) {
          changes.push(
            ...this.getChangedKeys(oldConfig[key], newConfig[key], fullKey),
          );
        } else {
          changes.push(fullKey);
        }
      }
    }

    return changes;
  }

  private log(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
  ): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [CONFIG] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
  }
}
