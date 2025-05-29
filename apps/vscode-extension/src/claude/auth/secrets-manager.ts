import * as vscode from 'vscode';
import { Logger } from '../logger';

export enum SecretKeys {
  CLAUDE_API_KEY = 'claude.apiKey',
  CLAUDE_REFRESH_TOKEN = 'claude.refreshToken',
  CLAUDE_SESSION_TOKEN = 'claude.sessionToken',
  MCP_CREDENTIALS = 'mcp.credentials',
}

interface SecretMetadata {
  key: string;
  storedAt: string;
  workspace?: string;
}

/**
 * Manages all secret storage operations using VSCode's API
 */
export class SecretsManager {
  private readonly logger = new Logger('SecretsManager');
  private readonly secretPrefix = 'stagewise';

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Store a secret securely
   */
  async store(key: string, value: string): Promise<void> {
    const fullKey = this.getFullKey(key);

    try {
      await this.context.secrets.store(fullKey, value);

      // Store metadata
      await this.storeMetadata(key);

      this.logger.info(`Stored secret: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to store secret ${key}:`, error);
      throw new Error(`Failed to store secret: ${error}`);
    }
  }

  /**
   * Retrieve a secret
   */
  async retrieve(key: string): Promise<string | undefined> {
    const fullKey = this.getFullKey(key);

    try {
      const value = await this.context.secrets.get(fullKey);

      if (value) {
        this.logger.debug(`Retrieved secret: ${key}`);
      }

      return value;
    } catch (error) {
      this.logger.error(`Failed to retrieve secret ${key}:`, error);
      return undefined;
    }
  }

  /**
   * Delete a secret
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);

    try {
      await this.context.secrets.delete(fullKey);

      // Remove metadata
      await this.deleteMetadata(key);

      this.logger.info(`Deleted secret: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete secret ${key}:`, error);
      throw new Error(`Failed to delete secret: ${error}`);
    }
  }

  /**
   * Check if a secret exists
   */
  async exists(key: string): Promise<boolean> {
    const value = await this.retrieve(key);
    return value !== undefined;
  }

  /**
   * Clear all secrets
   */
  async clear(): Promise<void> {
    this.logger.warn('Clearing all secrets');

    // Get all secret keys from metadata
    const metadata = await this.getAllMetadata();

    // Delete each secret
    for (const { key } of metadata) {
      await this.delete(key);
    }

    this.logger.info('All secrets cleared');
  }

  /**
   * Validate secret format before storage
   */
  validateSecret(key: string, value: string): boolean {
    switch (key) {
      case SecretKeys.CLAUDE_API_KEY:
        return /^sk-ant-[a-zA-Z0-9\-_]+$/.test(value);
      case SecretKeys.CLAUDE_SESSION_TOKEN:
        return value.length > 0;
      case SecretKeys.CLAUDE_REFRESH_TOKEN:
        return value.length > 0;
      case SecretKeys.MCP_CREDENTIALS:
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  }

  /**
   * Check if a secret has expired
   */
  async isExpired(key: string, expirationTime?: number): Promise<boolean> {
    if (!expirationTime) return false;

    const metadata = await this.getMetadata(key);
    if (!metadata) return true;

    const storedTime = new Date(metadata.storedAt).getTime();
    return Date.now() - storedTime > expirationTime;
  }

  /**
   * Migrate from old storage methods
   */
  async migrateFromOldStorage(): Promise<void> {
    this.logger.info('Checking for secrets to migrate');

    // Check workspace configuration
    const config = vscode.workspace.getConfiguration('stagewise-cc.claude');
    const workspaceApiKey = config.get<string>('apiKey');

    if (
      workspaceApiKey &&
      this.validateSecret(SecretKeys.CLAUDE_API_KEY, workspaceApiKey)
    ) {
      await this.store(SecretKeys.CLAUDE_API_KEY, workspaceApiKey);
      await config.update(
        'apiKey',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      this.logger.info('Migrated API key from workspace settings');
    }

    // Check environment variable
    const envApiKey = process.env.ANTHROPIC_API_KEY;
    if (envApiKey && !(await this.exists(SecretKeys.CLAUDE_API_KEY))) {
      if (this.validateSecret(SecretKeys.CLAUDE_API_KEY, envApiKey)) {
        await this.store(SecretKeys.CLAUDE_API_KEY, envApiKey);
        this.logger.info('Migrated API key from environment variable');
      }
    }
  }

  /**
   * Get full key with prefix
   */
  private getFullKey(key: string): string {
    return `${this.secretPrefix}.${key}`;
  }

  /**
   * Store metadata about a secret
   */
  private async storeMetadata(key: string): Promise<void> {
    const metadata: SecretMetadata = {
      key,
      storedAt: new Date().toISOString(),
      workspace: vscode.workspace.name,
    };

    const metadataKey = `${this.getFullKey(key)}.metadata`;
    await this.context.globalState.update(metadataKey, metadata);
  }

  /**
   * Get metadata for a secret
   */
  private async getMetadata(key: string): Promise<SecretMetadata | undefined> {
    const metadataKey = `${this.getFullKey(key)}.metadata`;
    return this.context.globalState.get<SecretMetadata>(metadataKey);
  }

  /**
   * Delete metadata for a secret
   */
  private async deleteMetadata(key: string): Promise<void> {
    const metadataKey = `${this.getFullKey(key)}.metadata`;
    await this.context.globalState.update(metadataKey, undefined);
  }

  /**
   * Get all secret metadata
   */
  private async getAllMetadata(): Promise<SecretMetadata[]> {
    const allKeys = this.context.globalState.keys();
    const metadata: SecretMetadata[] = [];

    for (const key of allKeys) {
      if (key.startsWith(this.secretPrefix) && key.endsWith('.metadata')) {
        const data = this.context.globalState.get<SecretMetadata>(key);
        if (data) {
          metadata.push(data);
        }
      }
    }

    return metadata;
  }
}
