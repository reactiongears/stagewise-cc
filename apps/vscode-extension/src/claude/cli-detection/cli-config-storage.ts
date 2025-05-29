import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from '../logger';
import type { CLIConfig } from './cli-types';

/**
 * Manages CLI configuration persistence
 */
export class CLIConfigStorage {
  private readonly logger = new Logger('CLIConfigStorage');
  private readonly configKey = 'claude.cli.config';

  /**
   * Get stored CLI configuration
   */
  async getConfig(): Promise<CLIConfig | undefined> {
    try {
      // Try workspace state first
      const context = await this.getContext();
      if (context) {
        const workspaceConfig = context.workspaceState.get<CLIConfig>(
          this.configKey,
        );
        if (workspaceConfig) {
          return workspaceConfig;
        }
      }

      // Fall back to global settings
      const config = vscode.workspace.getConfiguration('claude');
      const cliPath = config.get<string>('cliPath');

      if (cliPath) {
        return {
          path: cliPath,
          detectedAt: new Date().toISOString(),
          verified: false, // Needs verification
        };
      }

      // Check environment variable
      const envPath = process.env.CLAUDE_CLI_PATH;
      if (envPath) {
        return {
          path: envPath,
          detectedAt: new Date().toISOString(),
          verified: false, // Needs verification
        };
      }

      return undefined;
    } catch (error) {
      this.logger.error('Failed to get CLI config', error);
      return undefined;
    }
  }

  /**
   * Save CLI configuration
   */
  async saveConfig(config: CLIConfig): Promise<void> {
    try {
      // Save to workspace state
      const context = await this.getContext();
      if (context) {
        await context.workspaceState.update(this.configKey, config);
      }

      // Also update user settings for persistence
      const vsConfig = vscode.workspace.getConfiguration('claude');
      await vsConfig.update(
        'cliPath',
        config.path,
        vscode.ConfigurationTarget.Global,
      );

      this.logger.info(`CLI config saved: ${config.path}`);
    } catch (error) {
      this.logger.error('Failed to save CLI config', error);
      throw error;
    }
  }

  /**
   * Clear CLI configuration
   */
  async clearConfig(): Promise<void> {
    try {
      const context = await this.getContext();
      if (context) {
        await context.workspaceState.update(this.configKey, undefined);
      }

      const config = vscode.workspace.getConfiguration('claude');
      await config.update(
        'cliPath',
        undefined,
        vscode.ConfigurationTarget.Global,
      );

      this.logger.info('CLI config cleared');
    } catch (error) {
      this.logger.error('Failed to clear CLI config', error);
      throw error;
    }
  }

  /**
   * Verify stored configuration is still valid
   */
  async verifyConfig(config: CLIConfig): Promise<boolean> {
    try {
      // Check if file exists
      await fs.access(config.path, fs.constants.X_OK);

      // Try to execute version command
      const { exec } = require('node:child_process');
      const { promisify } = require('node:util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`"${config.path}" --version`);
      const hasVersion = stdout?.includes('claude');

      // Update verification status
      if (hasVersion) {
        config.verified = true;
        config.version = stdout.trim();
        await this.saveConfig(config);
      }

      return hasVersion;
    } catch (error) {
      this.logger.warn(`CLI verification failed for ${config.path}`, error);
      return false;
    }
  }

  /**
   * Get CLI history (previous configurations)
   */
  async getHistory(): Promise<CLIConfig[]> {
    try {
      const context = await this.getContext();
      if (!context) {
        return [];
      }

      const history = context.globalState.get<CLIConfig[]>(
        'claude.cli.history',
        [],
      );
      return history;
    } catch (error) {
      this.logger.error('Failed to get CLI history', error);
      return [];
    }
  }

  /**
   * Add to CLI history
   */
  async addToHistory(config: CLIConfig): Promise<void> {
    try {
      const context = await this.getContext();
      if (!context) {
        return;
      }

      const history = await this.getHistory();

      // Avoid duplicates
      const exists = history.some((h) => h.path === config.path);
      if (!exists) {
        history.unshift(config);

        // Keep only last 10 entries
        if (history.length > 10) {
          history.length = 10;
        }

        await context.globalState.update('claude.cli.history', history);
      }
    } catch (error) {
      this.logger.error('Failed to add to CLI history', error);
    }
  }

  /**
   * Export configuration for sharing
   */
  async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    if (!config) {
      throw new Error('No CLI configuration found');
    }

    const exportData = {
      claude_cli_config: {
        path: config.path,
        version: config.version,
        platform: process.platform,
        exportedAt: new Date().toISOString(),
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import configuration
   */
  async importConfig(jsonData: string): Promise<void> {
    try {
      const data = JSON.parse(jsonData);

      if (!data.claude_cli_config || !data.claude_cli_config.path) {
        throw new Error('Invalid configuration format');
      }

      const config: CLIConfig = {
        path: data.claude_cli_config.path,
        version: data.claude_cli_config.version,
        detectedAt: new Date().toISOString(),
        verified: false, // Always re-verify imported configs
      };

      // Verify before saving
      const isValid = await this.verifyConfig(config);
      if (!isValid) {
        throw new Error('Imported CLI path is not valid on this system');
      }

      await this.saveConfig(config);
      await this.addToHistory(config);
    } catch (error) {
      this.logger.error('Failed to import CLI config', error);
      throw error;
    }
  }

  /**
   * Get suggested CLI paths based on platform
   */
  getSuggestedPaths(): string[] {
    const platform = process.platform;
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    switch (platform) {
      case 'darwin':
        return [
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          path.join(homeDir, '.local/bin/claude'),
          path.join(homeDir, '.npm-global/bin/claude'),
        ];

      case 'win32':
        return [
          'C:\\Program Files\\Claude\\claude.exe',
          'C:\\Program Files (x86)\\Claude\\claude.exe',
          path.join(homeDir, 'AppData\\Local\\Claude\\claude.exe'),
          path.join(homeDir, 'AppData\\Roaming\\npm\\claude.cmd'),
        ];

      case 'linux':
        return [
          '/usr/local/bin/claude',
          '/usr/bin/claude',
          path.join(homeDir, '.local/bin/claude'),
          path.join(homeDir, '.npm-global/bin/claude'),
          '/opt/claude/bin/claude',
        ];

      default:
        return [
          '/usr/local/bin/claude',
          path.join(homeDir, '.local/bin/claude'),
        ];
    }
  }

  /**
   * Get extension context
   */
  private async getContext(): Promise<vscode.ExtensionContext | undefined> {
    // In a real implementation, this would be injected or retrieved
    // For now, we'll use a workaround
    const ext = vscode.extensions.getExtension('stagewise.claude-vscode');
    if (ext?.isActive) {
      return ext.exports?.context;
    }
    return undefined;
  }

  /**
   * Monitor CLI availability
   */
  async monitorCLI(
    config: CLIConfig,
    callback: (available: boolean) => void,
  ): Promise<vscode.Disposable> {
    let isAvailable = true;

    // Check periodically
    const interval = setInterval(async () => {
      try {
        await fs.access(config.path, fs.constants.X_OK);
        if (!isAvailable) {
          isAvailable = true;
          callback(true);
          this.logger.info('CLI became available again');
        }
      } catch (error) {
        if (isAvailable) {
          isAvailable = false;
          callback(false);
          this.logger.warn('CLI became unavailable');
        }
      }
    }, 10000); // Check every 10 seconds

    // Return disposable
    return new vscode.Disposable(() => {
      clearInterval(interval);
    });
  }

  /**
   * Get platform-specific configuration tips
   */
  getConfigurationTips(): string[] {
    const platform = process.platform;
    const tips: string[] = [];

    switch (platform) {
      case 'darwin':
        tips.push(
          'Tip: If installed via Homebrew, the CLI is usually in /opt/homebrew/bin (M1/M2) or /usr/local/bin (Intel)',
          'Tip: Add Claude to your PATH by editing ~/.zshrc or ~/.bash_profile',
          'Tip: You can create an alias: alias claude="/path/to/claude"',
        );
        break;

      case 'win32':
        tips.push(
          'Tip: Add Claude to your PATH through System Properties > Environment Variables',
          'Tip: You may need to restart VSCode after installing the CLI',
          'Tip: Use "where claude" in Command Prompt to find the CLI location',
        );
        break;

      case 'linux':
        tips.push(
          'Tip: Make sure the CLI has execute permissions: chmod +x /path/to/claude',
          'Tip: Add Claude to your PATH by editing ~/.bashrc or ~/.profile',
          'Tip: Use "which claude" to find the CLI if it\'s in your PATH',
        );
        break;
    }

    tips.push(
      'Tip: Set CLAUDE_CLI_PATH environment variable to override auto-detection',
      'Tip: The CLI configuration is stored in your VSCode settings',
    );

    return tips;
  }
}
