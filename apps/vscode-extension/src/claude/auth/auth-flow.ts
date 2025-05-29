import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import type { CredentialProvider } from './credential-provider';
import { type SecretsManager, SecretKeys } from './secrets-manager';

export enum AuthStatus {
  NOT_AUTHENTICATED = 'not_authenticated',
  AUTHENTICATING = 'authenticating',
  AUTHENTICATED = 'authenticated',
  ERROR = 'error',
}

export interface AuthResult {
  success: boolean;
  status: AuthStatus;
  error?: string;
  credentials?: any;
}

interface AuthState {
  status: AuthStatus;
  lastAuthTime?: Date;
  sessionExpiry?: Date;
  autoLoginEnabled: boolean;
}

/**
 * Manages the complete authentication flow
 */
export class AuthFlow extends EventEmitter {
  private readonly logger = new Logger('AuthFlow');
  private authState: AuthState;
  private authCheckInterval?: NodeJS.Timer;

  constructor(
    private readonly credentialProvider: CredentialProvider,
    private readonly secretsManager: SecretsManager,
    private readonly context: vscode.ExtensionContext,
  ) {
    super();

    this.authState = {
      status: AuthStatus.NOT_AUTHENTICATED,
      autoLoginEnabled: this.getAutoLoginSetting(),
    };

    this.loadAuthState();
  }

  /**
   * Start the authentication flow
   */
  async authenticate(): Promise<AuthResult> {
    this.logger.info('Starting authentication flow');
    this.updateStatus(AuthStatus.AUTHENTICATING);

    try {
      // Check existing credentials first
      const existingAuth = await this.checkExistingCredentials();
      if (existingAuth.success) {
        this.logger.info('Using existing valid credentials');
        return existingAuth;
      }

      // Show authentication options
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(key) Enter API Key', value: 'apikey' },
          { label: '$(globe) OAuth Login', value: 'oauth' },
          { label: '$(folder) Import from File', value: 'import' },
          { label: '$(cloud) Use Environment Variable', value: 'env' },
        ],
        {
          placeHolder: 'Choose authentication method',
          ignoreFocusOut: true,
        },
      );

      if (!choice) {
        this.updateStatus(AuthStatus.NOT_AUTHENTICATED);
        return {
          success: false,
          status: AuthStatus.NOT_AUTHENTICATED,
          error: 'Authentication cancelled',
        };
      }

      let result: AuthResult;
      switch (choice.value) {
        case 'apikey':
          result = await this.authenticateWithApiKey();
          break;
        case 'oauth':
          result = await this.authenticateWithOAuth();
          break;
        case 'import':
          result = await this.authenticateFromFile();
          break;
        case 'env':
          result = await this.authenticateFromEnvironment();
          break;
        default:
          throw new Error('Invalid authentication method');
      }

      if (result.success) {
        await this.onAuthenticationSuccess();
      }

      return result;
    } catch (error) {
      this.logger.error('Authentication error:', error);
      this.updateStatus(AuthStatus.ERROR);

      return {
        success: false,
        status: AuthStatus.ERROR,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Re-authenticate (refresh tokens, etc.)
   */
  async reauthenticate(): Promise<AuthResult> {
    this.logger.info('Re-authenticating');

    try {
      // For API key auth, just validate again
      const credentials = await this.credentialProvider.getClaudeCredentials();
      const isValid =
        await this.credentialProvider.validateCredentials(credentials);

      if (isValid) {
        this.updateStatus(AuthStatus.AUTHENTICATED);
        return {
          success: true,
          status: AuthStatus.AUTHENTICATED,
          credentials,
        };
      } else {
        // Credentials invalid, start fresh auth
        return this.authenticate();
      }
    } catch (error) {
      return this.authenticate();
    }
  }

  /**
   * Logout and clear credentials
   */
  async logout(): Promise<void> {
    this.logger.info('Logging out');

    // Clear credentials
    await this.secretsManager.delete(SecretKeys.CLAUDE_API_KEY);
    await this.secretsManager.delete(SecretKeys.CLAUDE_SESSION_TOKEN);
    await this.secretsManager.delete(SecretKeys.CLAUDE_REFRESH_TOKEN);

    // Update state
    this.updateStatus(AuthStatus.NOT_AUTHENTICATED);
    this.authState.lastAuthTime = undefined;
    this.authState.sessionExpiry = undefined;
    await this.saveAuthState();

    // Stop session monitoring
    if (this.authCheckInterval) {
      clearInterval(this.authCheckInterval);
      this.authCheckInterval = undefined;
    }

    vscode.window.showInformationMessage('Successfully logged out');
    this.emit('logout');
  }

  /**
   * Get current authentication status
   */
  getAuthStatus(): AuthStatus {
    return this.authState.status;
  }

  /**
   * Enable/disable auto-login
   */
  async setAutoLogin(enabled: boolean): Promise<void> {
    this.authState.autoLoginEnabled = enabled;
    await this.context.globalState.update('claude.autoLogin', enabled);
    this.logger.info(`Auto-login ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Initialize authentication on startup
   */
  async initialize(): Promise<void> {
    if (this.authState.autoLoginEnabled) {
      const result = await this.checkExistingCredentials();
      if (result.success) {
        this.logger.info('Auto-login successful');
        await this.onAuthenticationSuccess();
      }
    }
  }

  /**
   * Check existing credentials
   */
  private async checkExistingCredentials(): Promise<AuthResult> {
    try {
      const credentials = await this.credentialProvider.getClaudeCredentials();
      const isValid =
        await this.credentialProvider.validateCredentials(credentials);

      if (isValid) {
        this.updateStatus(AuthStatus.AUTHENTICATED);
        return {
          success: true,
          status: AuthStatus.AUTHENTICATED,
          credentials,
        };
      }
    } catch (error) {
      // No existing credentials or invalid
    }

    return {
      success: false,
      status: AuthStatus.NOT_AUTHENTICATED,
    };
  }

  /**
   * Authenticate with API key
   */
  private async authenticateWithApiKey(): Promise<AuthResult> {
    const credentials =
      await this.credentialProvider.promptForClaudeCredentials();

    if (!credentials) {
      return {
        success: false,
        status: AuthStatus.NOT_AUTHENTICATED,
        error: 'No credentials provided',
      };
    }

    this.updateStatus(AuthStatus.AUTHENTICATED);
    return {
      success: true,
      status: AuthStatus.AUTHENTICATED,
      credentials,
    };
  }

  /**
   * Authenticate with OAuth (placeholder)
   */
  private async authenticateWithOAuth(): Promise<AuthResult> {
    vscode.window.showInformationMessage('OAuth authentication coming soon!');

    return {
      success: false,
      status: AuthStatus.NOT_AUTHENTICATED,
      error: 'OAuth not yet implemented',
    };
  }

  /**
   * Authenticate from file
   */
  private async authenticateFromFile(): Promise<AuthResult> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'JSON files': ['json'],
        'All files': ['*'],
      },
      title: 'Select credentials file',
    });

    if (!fileUri || fileUri.length === 0) {
      return {
        success: false,
        status: AuthStatus.NOT_AUTHENTICATED,
        error: 'No file selected',
      };
    }

    try {
      const fileContent = await vscode.workspace.fs.readFile(fileUri[0]);
      const credentials = JSON.parse(Buffer.from(fileContent).toString());

      if (!credentials.apiKey) {
        throw new Error('No API key found in file');
      }

      // Validate and store
      if (
        !this.secretsManager.validateSecret(
          SecretKeys.CLAUDE_API_KEY,
          credentials.apiKey,
        )
      ) {
        throw new Error('Invalid API key format');
      }

      await this.secretsManager.store(
        SecretKeys.CLAUDE_API_KEY,
        credentials.apiKey,
      );

      this.updateStatus(AuthStatus.AUTHENTICATED);
      return {
        success: true,
        status: AuthStatus.AUTHENTICATED,
        credentials,
      };
    } catch (error) {
      return {
        success: false,
        status: AuthStatus.ERROR,
        error: `Failed to import credentials: ${error}`,
      };
    }
  }

  /**
   * Authenticate from environment variable
   */
  private async authenticateFromEnvironment(): Promise<AuthResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        status: AuthStatus.NOT_AUTHENTICATED,
        error: 'No API key found in environment variables',
      };
    }

    if (
      !this.secretsManager.validateSecret(SecretKeys.CLAUDE_API_KEY, apiKey)
    ) {
      return {
        success: false,
        status: AuthStatus.ERROR,
        error: 'Invalid API key format in environment variable',
      };
    }

    await this.secretsManager.store(SecretKeys.CLAUDE_API_KEY, apiKey);

    this.updateStatus(AuthStatus.AUTHENTICATED);
    return {
      success: true,
      status: AuthStatus.AUTHENTICATED,
      credentials: { apiKey },
    };
  }

  /**
   * Handle successful authentication
   */
  private async onAuthenticationSuccess(): Promise<void> {
    this.authState.lastAuthTime = new Date();
    this.authState.sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await this.saveAuthState();

    // Start session monitoring
    this.startSessionMonitoring();

    // Emit success event
    this.emit('authenticated');

    vscode.window.showInformationMessage(
      'Successfully authenticated with Claude',
    );
  }

  /**
   * Start monitoring session validity
   */
  private startSessionMonitoring(): void {
    if (this.authCheckInterval) {
      clearInterval(this.authCheckInterval);
    }

    // Check every 5 minutes
    this.authCheckInterval = setInterval(
      async () => {
        if (
          this.authState.sessionExpiry &&
          new Date() > this.authState.sessionExpiry
        ) {
          this.logger.info('Session expired, re-authenticating');
          await this.reauthenticate();
        }
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Update authentication status
   */
  private updateStatus(status: AuthStatus): void {
    const previousStatus = this.authState.status;
    this.authState.status = status;

    this.logger.info(`Auth status changed: ${previousStatus} -> ${status}`);
    this.emit('statusChanged', { previousStatus, currentStatus: status });
  }

  /**
   * Load auth state from storage
   */
  private async loadAuthState(): Promise<void> {
    const stored =
      this.context.globalState.get<Partial<AuthState>>('claude.authState');
    if (stored) {
      this.authState = { ...this.authState, ...stored };
    }
  }

  /**
   * Save auth state to storage
   */
  private async saveAuthState(): Promise<void> {
    await this.context.globalState.update('claude.authState', this.authState);
  }

  /**
   * Get auto-login setting
   */
  private getAutoLoginSetting(): boolean {
    return this.context.globalState.get<boolean>('claude.autoLogin', true);
  }
}
