import * as vscode from 'vscode';
import { Logger } from '../logger';
import { type SecretsManager, SecretKeys } from './secrets-manager';

export interface ClaudeCredentials {
  apiKey: string;
  sessionToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface MCPCredentials {
  serverUrl: string;
  authToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export enum CredentialType {
  CLAUDE = 'claude',
  MCP = 'mcp',
}

interface CredentialSet {
  id: string;
  name: string;
  type: CredentialType;
  isDefault: boolean;
  lastUsed?: Date;
}

/**
 * Provides credentials for various services
 */
export class CredentialProvider {
  private readonly logger = new Logger('CredentialProvider');
  private credentialSets: Map<string, CredentialSet> = new Map();
  private currentSetId?: string;

  constructor(
    private readonly secretsManager: SecretsManager,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.loadCredentialSets();
  }

  /**
   * Get Claude credentials
   */
  async getClaudeCredentials(): Promise<ClaudeCredentials> {
    const apiKey = await this.secretsManager.retrieve(
      SecretKeys.CLAUDE_API_KEY,
    );
    if (!apiKey) {
      throw new Error(
        'Claude API key not found. Please configure your credentials.',
      );
    }

    const sessionToken = await this.secretsManager.retrieve(
      SecretKeys.CLAUDE_SESSION_TOKEN,
    );

    return {
      apiKey,
      sessionToken,
      scopes: ['messages:write', 'messages:read'],
    };
  }

  /**
   * Get MCP credentials
   */
  async getMCPCredentials(): Promise<MCPCredentials> {
    const credentialsJson = await this.secretsManager.retrieve(
      SecretKeys.MCP_CREDENTIALS,
    );
    if (!credentialsJson) {
      throw new Error(
        'MCP credentials not found. Please configure your credentials.',
      );
    }

    try {
      return JSON.parse(credentialsJson);
    } catch (error) {
      this.logger.error('Failed to parse MCP credentials:', error);
      throw new Error('Invalid MCP credentials format');
    }
  }

  /**
   * Refresh credentials
   */
  async refreshCredentials(type: CredentialType): Promise<void> {
    switch (type) {
      case CredentialType.CLAUDE:
        await this.refreshClaudeCredentials();
        break;
      case CredentialType.MCP:
        await this.refreshMCPCredentials();
        break;
      default:
        throw new Error(`Unknown credential type: ${type}`);
    }
  }

  /**
   * Validate credentials
   */
  async validateCredentials(
    credentials: ClaudeCredentials | MCPCredentials,
  ): Promise<boolean> {
    if ('apiKey' in credentials) {
      return this.validateClaudeCredentials(credentials);
    } else {
      return this.validateMCPCredentials(credentials);
    }
  }

  /**
   * Prompt user for Claude credentials
   */
  async promptForClaudeCredentials(): Promise<ClaudeCredentials | undefined> {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Claude API key',
      placeHolder: 'sk-ant-...',
      password: true,
      validateInput: (value) => {
        if (!value) return 'API key is required';
        if (
          !this.secretsManager.validateSecret(SecretKeys.CLAUDE_API_KEY, value)
        ) {
          return 'Invalid API key format. Should start with sk-ant-';
        }
        return undefined;
      },
    });

    if (!apiKey) return undefined;

    // Test the credentials
    const credentials: ClaudeCredentials = { apiKey };
    const isValid = await this.validateClaudeCredentials(credentials);

    if (!isValid) {
      vscode.window.showErrorMessage(
        'Invalid API key. Please check your key and try again.',
      );
      return undefined;
    }

    // Store the validated credentials
    await this.secretsManager.store(SecretKeys.CLAUDE_API_KEY, apiKey);

    vscode.window.showInformationMessage(
      'Claude credentials saved successfully',
    );
    return credentials;
  }

  /**
   * Add multi-account support
   */
  async addCredentialSet(name: string, type: CredentialType): Promise<string> {
    const id = this.generateSetId();
    const credentialSet: CredentialSet = {
      id,
      name,
      type,
      isDefault: this.credentialSets.size === 0,
      lastUsed: new Date(),
    };

    this.credentialSets.set(id, credentialSet);
    await this.saveCredentialSets();

    this.logger.info(`Added credential set: ${name} (${id})`);
    return id;
  }

  /**
   * Switch to a different credential set
   */
  async switchCredentialSet(id: string): Promise<void> {
    const credentialSet = this.credentialSets.get(id);
    if (!credentialSet) {
      throw new Error(`Credential set ${id} not found`);
    }

    this.currentSetId = id;
    credentialSet.lastUsed = new Date();

    // Update default if needed
    if (!credentialSet.isDefault) {
      this.credentialSets.forEach((set) => {
        set.isDefault = set.id === id;
      });
    }

    await this.saveCredentialSets();
    this.logger.info(`Switched to credential set: ${credentialSet.name}`);
  }

  /**
   * Get all credential sets
   */
  getCredentialSets(): CredentialSet[] {
    return Array.from(this.credentialSets.values());
  }

  /**
   * Remove a credential set
   */
  async removeCredentialSet(id: string): Promise<void> {
    const credentialSet = this.credentialSets.get(id);
    if (!credentialSet) return;

    // Don't remove the last set
    if (this.credentialSets.size === 1) {
      throw new Error('Cannot remove the last credential set');
    }

    // Clear associated secrets
    const prefix = `${id}.`;
    for (const key of Object.values(SecretKeys)) {
      await this.secretsManager.delete(prefix + key);
    }

    this.credentialSets.delete(id);

    // Select new default if needed
    if (credentialSet.isDefault && this.credentialSets.size > 0) {
      const firstSet = this.credentialSets.values().next().value;
      firstSet.isDefault = true;
      this.currentSetId = firstSet.id;
    }

    await this.saveCredentialSets();
    this.logger.info(`Removed credential set: ${credentialSet.name}`);
  }

  /**
   * Validate Claude credentials
   */
  private async validateClaudeCredentials(
    credentials: ClaudeCredentials,
  ): Promise<boolean> {
    try {
      // Make a minimal API call to validate the key
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': credentials.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });

      if (response.status === 401) {
        return false;
      }

      if (response.status === 200) {
        return true;
      }

      // Rate limit or other error - assume valid
      return true;
    } catch (error) {
      this.logger.error('Failed to validate Claude credentials:', error);
      return false;
    }
  }

  /**
   * Validate MCP credentials
   */
  private async validateMCPCredentials(
    credentials: MCPCredentials,
  ): Promise<boolean> {
    // Basic validation for now
    return credentials.serverUrl.startsWith('http');
  }

  /**
   * Refresh Claude credentials
   */
  private async refreshClaudeCredentials(): Promise<void> {
    // Claude uses API keys, not refresh tokens
    // This would be used for OAuth-based auth in the future
    this.logger.info('Claude uses API keys, no refresh needed');
  }

  /**
   * Refresh MCP credentials
   */
  private async refreshMCPCredentials(): Promise<void> {
    // Implement MCP token refresh if needed
    this.logger.info('MCP credential refresh not implemented');
  }

  /**
   * Load credential sets from storage
   */
  private async loadCredentialSets(): Promise<void> {
    const stored = this.context.globalState.get<CredentialSet[]>(
      'credentialSets',
      [],
    );

    for (const set of stored) {
      this.credentialSets.set(set.id, set);
      if (set.isDefault) {
        this.currentSetId = set.id;
      }
    }

    // Create default set if none exist
    if (this.credentialSets.size === 0) {
      const id = await this.addCredentialSet('Default', CredentialType.CLAUDE);
      this.currentSetId = id;
    }
  }

  /**
   * Save credential sets to storage
   */
  private async saveCredentialSets(): Promise<void> {
    const sets = Array.from(this.credentialSets.values());
    await this.context.globalState.update('credentialSets', sets);
  }

  /**
   * Generate a unique set ID
   */
  private generateSetId(): string {
    return `set_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
