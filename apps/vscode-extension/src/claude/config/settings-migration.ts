import { Logger } from '../logger';
import { ClaudeModel } from '../config-types';
import type { ClaudeSettings } from './settings-types';

interface Migration {
  version: string;
  description: string;
  migrate: (settings: any) => any;
}

interface MigrationResult {
  success: boolean;
  settings: ClaudeSettings;
  fromVersion: string;
  toVersion: string;
  appliedMigrations: string[];
  errors?: string[];
}

/**
 * Handles settings version migrations
 */
export class SettingsMigration {
  private readonly logger = new Logger('SettingsMigration');
  private readonly currentVersion = '2.0.0';

  private readonly migrations: Migration[] = [
    {
      version: '1.0.0',
      description: 'Initial migration from v1 to v2 format',
      migrate: this.migrateV1ToV2.bind(this),
    },
    {
      version: '1.5.0',
      description: 'Add support for new Claude models',
      migrate: this.migrateV1_5ToV2.bind(this),
    },
    {
      version: '2.0.0',
      description: 'Restructure settings for better organization',
      migrate: this.migrateToV2.bind(this),
    },
  ];

  /**
   * Migrate settings to current version
   */
  async migrate(settings: any, fromVersion?: string): Promise<ClaudeSettings> {
    const detectedVersion = fromVersion || this.getSettingsVersion(settings);

    this.logger.info(
      `Migrating settings from v${detectedVersion} to v${this.currentVersion}`,
    );

    // Backup original settings
    const backup = await this.backupSettings(settings);

    try {
      const result = this.runMigrations(settings, detectedVersion);

      if (!result.success) {
        throw new Error(`Migration failed: ${result.errors?.join(', ')}`);
      }

      this.logger.info(
        `Successfully migrated settings to v${result.toVersion}`,
      );
      return result.settings;
    } catch (error) {
      this.logger.error('Migration failed, restoring backup:', error);
      await this.restoreBackup(backup);
      throw error;
    }
  }

  /**
   * Check if migration is needed
   */
  needsMigration(settings: any): boolean {
    const version = this.getSettingsVersion(settings);
    return version !== this.currentVersion;
  }

  /**
   * Get settings version
   */
  getSettingsVersion(settings: any): string {
    // Check for explicit version field
    if (settings._version) {
      return settings._version;
    }

    // Detect version by structure
    if (settings.api && settings.model && settings.behavior) {
      return '2.0.0'; // Current structure
    }

    if (settings.modelConfig && settings.behaviorConfig) {
      return '1.5.0'; // Intermediate structure
    }

    if (settings.model && typeof settings.model === 'string') {
      return '1.0.0'; // Legacy flat structure
    }

    return '0.0.0'; // Unknown/very old version
  }

  /**
   * Backup settings before migration
   */
  async backupSettings(settings: any): Promise<string> {
    const backup = {
      timestamp: new Date().toISOString(),
      version: this.getSettingsVersion(settings),
      settings: JSON.parse(JSON.stringify(settings)), // Deep clone
    };

    const backupKey = `claude.settings.backup.${Date.now()}`;
    // In a real implementation, this would save to storage
    this.logger.info(`Created settings backup: ${backupKey}`);

    return backupKey;
  }

  /**
   * Restore settings from backup
   */
  async restoreBackup(backupKey: string): Promise<void> {
    // In a real implementation, this would restore from storage
    this.logger.info(`Restored settings from backup: ${backupKey}`);
  }

  /**
   * Run migrations in sequence
   */
  private runMigrations(settings: any, fromVersion: string): MigrationResult {
    let currentSettings = { ...settings };
    const appliedMigrations: string[] = [];
    const errors: string[] = [];

    // Find migrations to apply
    const applicableMigrations = this.migrations.filter(
      (m) =>
        this.compareVersions(m.version, fromVersion) > 0 &&
        this.compareVersions(m.version, this.currentVersion) <= 0,
    );

    // Apply migrations in order
    for (const migration of applicableMigrations) {
      try {
        this.logger.info(`Applying migration: ${migration.description}`);
        currentSettings = migration.migrate(currentSettings);
        appliedMigrations.push(migration.version);
      } catch (error) {
        const errorMsg = `Migration ${migration.version} failed: ${error}`;
        this.logger.error(errorMsg);
        errors.push(errorMsg);
        return {
          success: false,
          settings: currentSettings as ClaudeSettings,
          fromVersion,
          toVersion: migration.version,
          appliedMigrations,
          errors,
        };
      }
    }

    // Add version to migrated settings
    currentSettings._version = this.currentVersion;

    return {
      success: true,
      settings: currentSettings as ClaudeSettings,
      fromVersion,
      toVersion: this.currentVersion,
      appliedMigrations,
    };
  }

  /**
   * Migrate from v1 flat structure to v2
   */
  private migrateV1ToV2(settings: any): any {
    const migrated: any = {
      api: {
        key: settings.apiKey || '',
        endpoint: settings.endpoint || 'https://api.anthropic.com',
        timeout: settings.timeout || 30000,
        maxRetries: settings.maxRetries || 3,
      },
      model: {
        name: settings.model || ClaudeModel.CLAUDE_3_5_SONNET,
        temperature: settings.temperature || 0.7,
        maxTokens: settings.maxTokens || 4096,
      },
      behavior: {
        streamResponses: settings.streamResponses !== false,
        autoSave: settings.autoSave !== false,
        confirmBeforeApply: settings.confirmBeforeApply !== false,
        autoRetry: true,
        retryDelay: 1000,
      },
      ui: {
        showInStatusBar: settings.showInStatusBar !== false,
        showNotifications: settings.showNotifications !== false,
        theme: 'auto',
        compactMode: false,
      },
      context: {
        maxFileSize: settings.maxFileSize || 1024 * 1024,
        maxFiles: settings.maxFiles || 10,
        includeHiddenFiles: false,
        filePatterns: settings.filePatterns || ['**/*.{ts,tsx,js,jsx}'],
        excludePatterns: settings.excludePatterns || ['**/node_modules/**'],
      },
      advanced: {
        debugMode: settings.debugMode || false,
        telemetry: settings.telemetry !== false,
        experimental: settings.experimental || {},
      },
    };

    // Preserve unknown fields in experimental
    const knownFields = new Set([
      'apiKey',
      'endpoint',
      'timeout',
      'maxRetries',
      'model',
      'temperature',
      'maxTokens',
      'streamResponses',
      'autoSave',
      'confirmBeforeApply',
      'showInStatusBar',
      'showNotifications',
      'maxFileSize',
      'maxFiles',
      'filePatterns',
      'excludePatterns',
      'debugMode',
      'telemetry',
      'experimental',
    ]);

    for (const [key, value] of Object.entries(settings)) {
      if (!knownFields.has(key)) {
        migrated.advanced.experimental[key] = value;
      }
    }

    return migrated;
  }

  /**
   * Migrate from v1.5 to v2
   */
  private migrateV1_5ToV2(settings: any): any {
    const migrated: any = {
      api: settings.apiConfig || {
        key: settings.apiKey || '',
        endpoint: 'https://api.anthropic.com',
        timeout: 30000,
        maxRetries: 3,
      },
      model: settings.modelConfig || {
        name: ClaudeModel.CLAUDE_3_5_SONNET,
        temperature: 0.7,
        maxTokens: 4096,
      },
      behavior: settings.behaviorConfig || {
        streamResponses: true,
        autoSave: true,
        confirmBeforeApply: true,
        autoRetry: true,
        retryDelay: 1000,
      },
      ui: settings.uiConfig || {
        showInStatusBar: true,
        showNotifications: true,
        theme: 'auto',
        compactMode: false,
      },
      context: settings.contextConfig || {
        maxFileSize: 1024 * 1024,
        maxFiles: 10,
        includeHiddenFiles: false,
        filePatterns: ['**/*.{ts,tsx,js,jsx}'],
        excludePatterns: ['**/node_modules/**'],
      },
      advanced: settings.advancedConfig || {
        debugMode: false,
        telemetry: true,
        experimental: {},
      },
    };

    return migrated;
  }

  /**
   * Final migration to v2.0.0
   */
  private migrateToV2(settings: any): any {
    // This handles any final adjustments for v2.0.0
    const migrated = { ...settings };

    // Ensure all required fields exist
    migrated.api = migrated.api || {};
    migrated.model = migrated.model || {};
    migrated.behavior = migrated.behavior || {};
    migrated.ui = migrated.ui || {};
    migrated.context = migrated.context || {};
    migrated.advanced = migrated.advanced || {};

    // Update model names to latest versions
    if (
      migrated.model.name === 'claude-3-opus' ||
      migrated.model.name === 'claude-3-opus-20240229'
    ) {
      migrated.model.name = ClaudeModel.CLAUDE_3_OPUS;
    }

    // Add new fields with defaults
    migrated.model.topP = migrated.model.topP ?? undefined;
    migrated.model.topK = migrated.model.topK ?? undefined;
    migrated.model.stopSequences = migrated.model.stopSequences ?? [];

    migrated.behavior.autoRetry = migrated.behavior.autoRetry ?? true;
    migrated.behavior.retryDelay = migrated.behavior.retryDelay ?? 1000;

    migrated.ui.theme = migrated.ui.theme ?? 'auto';
    migrated.ui.compactMode = migrated.ui.compactMode ?? false;

    return migrated;
  }

  /**
   * Compare version strings
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;

      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }

    return 0;
  }

  /**
   * Create migration report
   */
  createMigrationReport(result: MigrationResult): string {
    const lines = [
      '# Settings Migration Report',
      '',
      `From Version: ${result.fromVersion}`,
      `To Version: ${result.toVersion}`,
      `Success: ${result.success}`,
      '',
      '## Applied Migrations:',
      ...result.appliedMigrations.map((v) => `- v${v}`),
    ];

    if (result.errors && result.errors.length > 0) {
      lines.push('', '## Errors:', ...result.errors.map((e) => `- ${e}`));
    }

    lines.push(
      '',
      '## Next Steps:',
      result.success
        ? '- Review your settings to ensure they are correct'
        : '- Restore from backup and manually update settings',
    );

    return lines.join('\n');
  }
}
