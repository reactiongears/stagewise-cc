/**
 * Prefix for all Claude-related secret storage keys
 */
export const SECRET_KEY_PREFIX = 'stagewise.claude';

/**
 * Full secret key for API key storage
 */
export const API_KEY_SECRET_KEY = `${SECRET_KEY_PREFIX}.apiKey`;

/**
 * Duration to cache validation results
 * 24 hours (86400000ms)
 */
export const VALIDATION_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Number of retry attempts for API key validation
 */
export const VALIDATION_RETRY_ATTEMPTS = 3;

/**
 * Delay between validation retry attempts
 * 1 second (1000ms)
 */
export const VALIDATION_RETRY_DELAY_MS = 1000;

/**
 * Maximum time to wait for validation response
 * 10 seconds (10000ms)
 */
export const VALIDATION_TIMEOUT_MS = 10000;

/**
 * Regex pattern for validating Anthropic API key format
 * Matches keys starting with 'sk-ant-' followed by alphanumeric characters
 */
export const API_KEY_PATTERN = /^sk-ant-[a-zA-Z0-9\-_]+$/;

/**
 * URL endpoint for validating API keys with Claude
 */
export const VALIDATION_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * User-friendly error messages for authentication issues
 */
export const ERROR_MESSAGES = {
  INVALID_FORMAT:
    'Invalid API key format. Anthropic API keys should start with "sk-ant-".',
  NETWORK_ERROR:
    'Unable to connect to Claude API. Please check your internet connection.',
  INVALID_KEY:
    'The API key is invalid or has been revoked. Please check your key.',
  RATE_LIMITED: 'Rate limit exceeded. Please try again later.',
  VALIDATION_FAILED: 'Failed to validate API key. Please try again.',
  STORAGE_ERROR:
    'Failed to store API key securely. Please check VSCode permissions.',
  NOT_CONFIGURED:
    'Claude API key not configured. Please set your API key to continue.',
  UNKNOWN_ERROR:
    'An unexpected error occurred. Please try again or check the output channel for details.',
} as const;

/**
 * Migration flag key for global state
 */
export const MIGRATION_FLAG_KEY = `${SECRET_KEY_PREFIX}.migrated`;

/**
 * Legacy storage locations to check during migration
 */
export const LEGACY_STORAGE_KEYS = {
  WORKSPACE_SETTING: 'stagewise-cc.claude.apiKey',
  USER_SETTING: 'stagewise-cc.claude.apiKey',
  ENV_VARIABLE: 'ANTHROPIC_API_KEY',
} as const;
