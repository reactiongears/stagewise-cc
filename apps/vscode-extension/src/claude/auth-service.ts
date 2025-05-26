import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import {
  AuthStatus,
  type AuthValidationResult,
  type AuthStatusChangeEvent,
} from './auth-types';
import {
  API_KEY_SECRET_KEY,
  VALIDATION_CACHE_DURATION_MS,
  VALIDATION_RETRY_ATTEMPTS,
  VALIDATION_RETRY_DELAY_MS,
  VALIDATION_TIMEOUT_MS,
  API_KEY_PATTERN,
  VALIDATION_ENDPOINT,
  ERROR_MESSAGES,
  MIGRATION_FLAG_KEY,
  LEGACY_STORAGE_KEYS,
} from './auth-constants';

export class ClaudeAuthService extends EventEmitter {
  private status: AuthStatus = AuthStatus.NOT_CONFIGURED;
  private validationCache: Map<
    string,
    { result: AuthValidationResult; timestamp: number }
  > = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel,
  ) {
    super();
  }

  async initialize(): Promise<void> {
    this.log('Initializing Claude authentication service');

    // Run migration if needed
    await this.migrateFromLegacyStorage();

    // Check for existing credentials
    const apiKey = await this.getApiKey();
    if (apiKey) {
      this.log('Found existing API key, validating...');
      const validation = await this.validateApiKey(apiKey);
      if (validation.isValid) {
        this.updateStatus(AuthStatus.VALID);
      } else {
        this.updateStatus(AuthStatus.INVALID);
      }
    } else {
      this.updateStatus(AuthStatus.NOT_CONFIGURED);
    }
  }

  async getApiKey(): Promise<string | undefined> {
    try {
      const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);

      if (apiKey && this.isValidKeyFormat(apiKey)) {
        this.log('Retrieved valid API key from secure storage', 'info', true);
        return apiKey;
      }

      return undefined;
    } catch (error) {
      this.handleError('Failed to retrieve API key', error);
      return undefined;
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    try {
      // Validate format
      if (!this.isValidKeyFormat(apiKey)) {
        throw new Error(ERROR_MESSAGES.INVALID_FORMAT);
      }

      // Store in secure storage
      await this.context.secrets.store(API_KEY_SECRET_KEY, apiKey);
      this.log('API key stored securely', 'info', true);

      // Validate the key
      this.updateStatus(AuthStatus.VALIDATING);
      const validation = await this.validateApiKey(apiKey);

      if (validation.isValid) {
        this.updateStatus(AuthStatus.VALID);
        vscode.window.showInformationMessage(
          'Claude API key configured successfully!',
        );
      } else {
        this.updateStatus(AuthStatus.INVALID);
        throw new Error(validation.error || ERROR_MESSAGES.INVALID_KEY);
      }
    } catch (error) {
      this.handleError('Failed to set API key', error);
      this.updateStatus(AuthStatus.ERROR);
      throw error;
    }
  }

  async deleteApiKey(): Promise<void> {
    try {
      await this.context.secrets.delete(API_KEY_SECRET_KEY);
      this.validationCache.clear();
      this.updateStatus(AuthStatus.NOT_CONFIGURED);
      this.log('API key removed from secure storage');
      vscode.window.showInformationMessage(
        'Claude API key removed successfully.',
      );
    } catch (error) {
      this.handleError('Failed to delete API key', error);
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<AuthValidationResult> {
    // Check cache first
    const cached = this.validationCache.get(apiKey);
    if (
      cached &&
      Date.now() - cached.timestamp < VALIDATION_CACHE_DURATION_MS
    ) {
      this.log('Using cached validation result');
      return cached.result;
    }

    // Validate format
    if (!this.isValidKeyFormat(apiKey)) {
      return { isValid: false, error: ERROR_MESSAGES.INVALID_FORMAT };
    }

    // Attempt validation with retries
    for (let attempt = 1; attempt <= VALIDATION_RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await this.performValidation(apiKey);

        // Cache successful result
        if (result.isValid) {
          this.validationCache.set(apiKey, {
            result,
            timestamp: Date.now(),
          });
        }

        return result;
      } catch (error) {
        if (attempt === VALIDATION_RETRY_ATTEMPTS) {
          return {
            isValid: false,
            error:
              error instanceof Error
                ? error.message
                : ERROR_MESSAGES.VALIDATION_FAILED,
          };
        }

        // Wait before retry
        await new Promise((resolve) =>
          setTimeout(resolve, VALIDATION_RETRY_DELAY_MS),
        );
      }
    }

    return { isValid: false, error: ERROR_MESSAGES.VALIDATION_FAILED };
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  private async performValidation(
    apiKey: string,
  ): Promise<AuthValidationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    try {
      // Make a minimal request to Claude API to validate the key
      const response = await fetch(VALIDATION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return {
          isValid: true,
          capabilities: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        };
      } else if (response.status === 401) {
        return { isValid: false, error: ERROR_MESSAGES.INVALID_KEY };
      } else if (response.status === 429) {
        return { isValid: false, error: ERROR_MESSAGES.RATE_LIMITED };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return {
          isValid: false,
          error:
            (errorData as any).error?.message ||
            `Validation failed with status ${response.status}`,
        };
      }
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { isValid: false, error: 'Validation timeout' };
        } else if (error.message.includes('fetch')) {
          return { isValid: false, error: ERROR_MESSAGES.NETWORK_ERROR };
        }
      }

      throw error;
    }
  }

  private async migrateFromLegacyStorage(): Promise<void> {
    // Check if migration has already been done
    const migrated = this.context.globalState.get<boolean>(MIGRATION_FLAG_KEY);
    if (migrated) {
      return;
    }

    this.log('Checking for API keys in legacy storage locations');

    try {
      // Check workspace settings
      const workspaceConfig =
        vscode.workspace.getConfiguration('stagewise.claude');
      const workspaceKey = workspaceConfig.get<string>('apiKey');

      if (workspaceKey && this.isValidKeyFormat(workspaceKey)) {
        this.log('Found API key in workspace settings, migrating...');
        await this.setApiKey(workspaceKey);
        await workspaceConfig.update(
          'apiKey',
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
        vscode.window.showInformationMessage(
          'Claude API key migrated to secure storage',
        );
      }

      // Check user settings
      const userConfig = vscode.workspace.getConfiguration('stagewise.claude');
      const userKey = userConfig.get<string>('apiKey');

      if (
        userKey &&
        userKey !== workspaceKey &&
        this.isValidKeyFormat(userKey)
      ) {
        this.log('Found API key in user settings, migrating...');
        await this.setApiKey(userKey);
        await userConfig.update(
          'apiKey',
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }

      // Check environment variable
      const envKey = process.env[LEGACY_STORAGE_KEYS.ENV_VARIABLE];
      if (envKey && this.isValidKeyFormat(envKey)) {
        this.log('Found API key in environment variable');
        const currentKey = await this.getApiKey();
        if (!currentKey) {
          await this.setApiKey(envKey);
          vscode.window.showInformationMessage(
            'Claude API key from environment variable stored securely',
          );
        }
      }

      // Mark migration as complete
      await this.context.globalState.update(MIGRATION_FLAG_KEY, true);
      this.log('Legacy storage migration completed');
    } catch (error) {
      this.handleError('Failed to migrate from legacy storage', error);
    }
  }

  private isValidKeyFormat(apiKey: string): boolean {
    return API_KEY_PATTERN.test(apiKey);
  }

  private updateStatus(newStatus: AuthStatus): void {
    const previousStatus = this.status;
    this.status = newStatus;

    const event: AuthStatusChangeEvent = {
      previousStatus,
      currentStatus: newStatus,
      timestamp: new Date(),
    };

    this.emit('statusChange', event);
    this.log(
      `Authentication status changed: ${previousStatus} -> ${newStatus}`,
    );
  }

  private handleError(message: string, error: any): void {
    const errorMessage = `${message}: ${error?.message || error}`;
    this.log(errorMessage, 'error');

    // Show user-friendly error message
    if (
      error?.message &&
      Object.values(ERROR_MESSAGES).includes(error.message)
    ) {
      vscode.window.showErrorMessage(error.message);
    } else {
      vscode.window.showErrorMessage(
        `${message}. Check the output channel for details.`,
      );
    }
  }

  private log(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    maskSensitive = false,
  ): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [AUTH] [${level.toUpperCase()}] ${message}`;

    // Mask sensitive information in logs
    const sanitizedMessage = maskSensitive
      ? logMessage.replace(/sk-ant-[\w-]+/g, 'sk-ant-***')
      : logMessage;

    this.outputChannel.appendLine(sanitizedMessage);

    if (level === 'error') {
      console.error(sanitizedMessage);
    } else if (level === 'warning') {
      console.warn(sanitizedMessage);
    } else {
      console.log(sanitizedMessage);
    }
  }
}
