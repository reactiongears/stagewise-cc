/**
 * Authentication types and interfaces
 */

export {
  AuthStatus,
  type AuthResult,
} from './auth-flow';

export {
  type ClaudeCredentials,
  type MCPCredentials,
  CredentialType,
} from './credential-provider';

export { TokenType } from './token-manager';

export { SecretKeys } from './secrets-manager';

export interface AuthConfig {
  autoLogin: boolean;
  rememberCredentials: boolean;
  sessionTimeout: number;
  tokenRefreshInterval: number;
  maxRetries: number;
}

export interface AuthEvent {
  type: 'authenticated' | 'logout' | 'tokenRefreshed' | 'statusChanged';
  timestamp: Date;
  data?: any;
}
