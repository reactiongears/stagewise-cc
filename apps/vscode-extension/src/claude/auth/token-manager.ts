import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import { type SecretsManager, SecretKeys } from './secrets-manager';

export enum TokenType {
  API_KEY = 'apiKey',
  ACCESS_TOKEN = 'accessToken',
  REFRESH_TOKEN = 'refreshToken',
  SESSION_TOKEN = 'sessionToken',
}

interface TokenInfo {
  value: string;
  type: TokenType;
  expiresAt?: Date;
  issuedAt: Date;
  scopes?: string[];
}

interface TokenValidation {
  isValid: boolean;
  reason?: string;
  remainingTime?: number;
}

/**
 * Manages authentication tokens lifecycle
 */
export class TokenManager extends EventEmitter {
  private readonly logger = new Logger('TokenManager');
  private tokens = new Map<TokenType, TokenInfo>();
  private refreshTimers = new Map<TokenType, NodeJS.Timeout>();
  private readonly tokenRotationInterval = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly secretsManager: SecretsManager) {
    super();
    this.loadTokens();
  }

  /**
   * Set a token
   */
  async setToken(type: TokenType, token: string, expiry?: Date): Promise<void> {
    const tokenInfo: TokenInfo = {
      value: token,
      type,
      expiresAt: expiry,
      issuedAt: new Date(),
    };

    // Validate token before storing
    const validation = await this.validateTokenFormat(type, token);
    if (!validation.isValid) {
      throw new Error(`Invalid token format: ${validation.reason}`);
    }

    // Store in memory
    this.tokens.set(type, tokenInfo);

    // Store securely
    await this.storeToken(type, tokenInfo);

    // Setup auto-refresh if needed
    if (expiry && type !== TokenType.API_KEY) {
      this.setupAutoRefresh(type, expiry);
    }

    this.logger.info(`Token set: ${type}`);
    this.emit('tokenSet', type, tokenInfo);
  }

  /**
   * Get a token
   */
  async getToken(type: TokenType): Promise<string | undefined> {
    // Check memory first
    let tokenInfo = this.tokens.get(type);

    // Load from storage if not in memory
    if (!tokenInfo) {
      tokenInfo = await this.loadToken(type);
      if (tokenInfo) {
        this.tokens.set(type, tokenInfo);
      }
    }

    if (!tokenInfo) {
      return undefined;
    }

    // Check if expired
    if (tokenInfo.expiresAt && new Date() > tokenInfo.expiresAt) {
      this.logger.warn(`Token expired: ${type}`);
      await this.handleExpiredToken(type);
      return undefined;
    }

    return tokenInfo.value;
  }

  /**
   * Refresh a token
   */
  async refreshToken(type: TokenType): Promise<string> {
    this.logger.info(`Refreshing token: ${type}`);

    try {
      let newToken: string;

      switch (type) {
        case TokenType.API_KEY:
          // API keys don't refresh
          throw new Error('API keys cannot be refreshed');

        case TokenType.ACCESS_TOKEN:
          newToken = await this.refreshAccessToken();
          break;

        case TokenType.SESSION_TOKEN:
          newToken = await this.refreshSessionToken();
          break;

        case TokenType.REFRESH_TOKEN:
          // Refresh tokens are refreshed during access token refresh
          throw new Error('Refresh tokens are refreshed automatically');

        default:
          throw new Error(`Unknown token type: ${type}`);
      }

      // Set the new token with appropriate expiry
      const expiry = new Date(Date.now() + 3600 * 1000); // 1 hour default
      await this.setToken(type, newToken, expiry);

      this.emit('tokenRefreshed', type);
      return newToken;
    } catch (error) {
      this.logger.error(`Failed to refresh token ${type}:`, error);
      this.emit('tokenRefreshFailed', type, error);
      throw error;
    }
  }

  /**
   * Check if a token is valid
   */
  async isTokenValid(type: TokenType): Promise<boolean> {
    const token = await this.getToken(type);
    if (!token) return false;

    const validation = await this.validateToken(type, token);
    return validation.isValid;
  }

  /**
   * Clear all tokens
   */
  async clearAllTokens(): Promise<void> {
    this.logger.warn('Clearing all tokens');

    // Clear refresh timers
    this.refreshTimers.forEach((timer) => clearTimeout(timer));
    this.refreshTimers.clear();

    // Clear from storage
    for (const type of Object.values(TokenType)) {
      await this.deleteToken(type as TokenType);
    }

    // Clear from memory
    this.tokens.clear();

    this.emit('tokensCleared');
  }

  /**
   * Get token expiration info
   */
  getTokenExpiration(
    type: TokenType,
  ): { expiresAt?: Date; remainingTime?: number } | undefined {
    const tokenInfo = this.tokens.get(type);
    if (!tokenInfo) return undefined;

    const result: { expiresAt?: Date; remainingTime?: number } = {};

    if (tokenInfo.expiresAt) {
      result.expiresAt = tokenInfo.expiresAt;
      result.remainingTime = tokenInfo.expiresAt.getTime() - Date.now();
    }

    return result;
  }

  /**
   * Enable token rotation
   */
  enableTokenRotation(
    type: TokenType,
    interval: number = this.tokenRotationInterval,
  ): void {
    if (type === TokenType.API_KEY) {
      this.logger.info('API key rotation enabled');

      setInterval(async () => {
        this.emit('tokenRotationRequired', type);
      }, interval);
    }
  }

  /**
   * Store token securely
   */
  private async storeToken(
    type: TokenType,
    tokenInfo: TokenInfo,
  ): Promise<void> {
    const key = this.getSecretKey(type);
    const data = JSON.stringify({
      value: tokenInfo.value,
      expiresAt: tokenInfo.expiresAt?.toISOString(),
      issuedAt: tokenInfo.issuedAt.toISOString(),
      scopes: tokenInfo.scopes,
    });

    await this.secretsManager.store(key, data);
  }

  /**
   * Load token from storage
   */
  private async loadToken(type: TokenType): Promise<TokenInfo | undefined> {
    const key = this.getSecretKey(type);
    const data = await this.secretsManager.retrieve(key);

    if (!data) return undefined;

    try {
      const parsed = JSON.parse(data);
      return {
        value: parsed.value,
        type,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
        issuedAt: new Date(parsed.issuedAt),
        scopes: parsed.scopes,
      };
    } catch (error) {
      this.logger.error(`Failed to parse token data for ${type}:`, error);
      return undefined;
    }
  }

  /**
   * Delete token from storage
   */
  private async deleteToken(type: TokenType): Promise<void> {
    const key = this.getSecretKey(type);
    await this.secretsManager.delete(key);
  }

  /**
   * Load all tokens on startup
   */
  private async loadTokens(): Promise<void> {
    for (const type of Object.values(TokenType)) {
      const tokenInfo = await this.loadToken(type as TokenType);
      if (tokenInfo) {
        this.tokens.set(type as TokenType, tokenInfo);

        // Setup auto-refresh if needed
        if (tokenInfo.expiresAt && type !== TokenType.API_KEY) {
          this.setupAutoRefresh(type as TokenType, tokenInfo.expiresAt);
        }
      }
    }
  }

  /**
   * Get secret key for token type
   */
  private getSecretKey(type: TokenType): string {
    switch (type) {
      case TokenType.API_KEY:
        return SecretKeys.CLAUDE_API_KEY;
      case TokenType.SESSION_TOKEN:
        return SecretKeys.CLAUDE_SESSION_TOKEN;
      case TokenType.REFRESH_TOKEN:
        return SecretKeys.CLAUDE_REFRESH_TOKEN;
      case TokenType.ACCESS_TOKEN:
        return 'claude.accessToken';
      default:
        return `claude.token.${type}`;
    }
  }

  /**
   * Validate token format
   */
  private async validateTokenFormat(
    type: TokenType,
    token: string,
  ): Promise<TokenValidation> {
    switch (type) {
      case TokenType.API_KEY:
        if (!token.startsWith('sk-ant-')) {
          return { isValid: false, reason: 'API key must start with sk-ant-' };
        }
        break;

      case TokenType.ACCESS_TOKEN:
      case TokenType.SESSION_TOKEN:
      case TokenType.REFRESH_TOKEN:
        if (token.length < 10) {
          return { isValid: false, reason: 'Token too short' };
        }
        break;
    }

    return { isValid: true };
  }

  /**
   * Validate token with API
   */
  private async validateToken(
    type: TokenType,
    token: string,
  ): Promise<TokenValidation> {
    // For API keys, check with the API
    if (type === TokenType.API_KEY) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': token,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1,
          }),
        });

        return { isValid: response.status !== 401 };
      } catch {
        return { isValid: false, reason: 'Network error' };
      }
    }

    // For other tokens, check expiration
    const tokenInfo = this.tokens.get(type);
    if (!tokenInfo) {
      return { isValid: false, reason: 'Token not found' };
    }

    if (tokenInfo.expiresAt && new Date() > tokenInfo.expiresAt) {
      return {
        isValid: false,
        reason: 'Token expired',
        remainingTime: 0,
      };
    }

    return {
      isValid: true,
      remainingTime: tokenInfo.expiresAt
        ? tokenInfo.expiresAt.getTime() - Date.now()
        : undefined,
    };
  }

  /**
   * Setup automatic token refresh
   */
  private setupAutoRefresh(type: TokenType, expiresAt: Date): void {
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(type);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate when to refresh (5 minutes before expiry)
    const refreshTime = expiresAt.getTime() - Date.now() - 5 * 60 * 1000;

    if (refreshTime > 0) {
      const timer = setTimeout(async () => {
        try {
          await this.refreshToken(type);
        } catch (error) {
          this.logger.error(`Auto-refresh failed for ${type}:`, error);
        }
      }, refreshTime);

      this.refreshTimers.set(type, timer);
      this.logger.info(
        `Auto-refresh scheduled for ${type} in ${refreshTime}ms`,
      );
    }
  }

  /**
   * Handle expired token
   */
  private async handleExpiredToken(type: TokenType): Promise<void> {
    this.tokens.delete(type);
    await this.deleteToken(type);

    // Clear refresh timer
    const timer = this.refreshTimers.get(type);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(type);
    }

    this.emit('tokenExpired', type);
  }

  /**
   * Refresh access token (placeholder)
   */
  private async refreshAccessToken(): Promise<string> {
    // This would use a refresh token to get a new access token
    throw new Error('Access token refresh not implemented');
  }

  /**
   * Refresh session token (placeholder)
   */
  private async refreshSessionToken(): Promise<string> {
    // This would create a new session
    throw new Error('Session token refresh not implemented');
  }
}
