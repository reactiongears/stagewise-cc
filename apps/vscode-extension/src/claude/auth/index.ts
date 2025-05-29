/**
 * Authentication system for Claude integration
 */

export { SecretsManager, SecretKeys } from './secrets-manager';
export { CredentialProvider } from './credential-provider';
export { AuthFlow } from './auth-flow';
export { TokenManager } from './token-manager';

export type {
  AuthStatus,
  AuthResult,
  ClaudeCredentials,
  MCPCredentials,
  CredentialType,
  TokenType,
  AuthConfig,
  AuthEvent,
} from './auth-types';
