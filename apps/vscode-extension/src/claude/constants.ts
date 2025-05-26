/**
 * Command to execute Claude CLI
 * Checks for 'claude' in PATH
 */
export const CLAUDE_CLI_COMMAND = 'claude';

/**
 * Default timeout for Claude CLI responses
 * 2 minutes (120000ms)
 */
export const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Interval for health check monitoring
 * 30 seconds (30000ms)
 */
export const HEALTH_CHECK_INTERVAL_MS = 30000;

/**
 * Maximum number of restart attempts after process failure
 */
export const MAX_RESTART_ATTEMPTS = 3;

/**
 * Delay between restart attempts
 * 2 seconds (2000ms)
 */
export const RESTART_DELAY_MS = 2000;

/**
 * Pattern to identify complete responses from Claude CLI
 * Matches the end of a complete response
 */
export const RESPONSE_DELIMITER = /\n\n(Human:|Assistant:|$)/;

/**
 * Common error patterns for Claude CLI errors
 */
export const ERROR_PATTERNS = [
  /API key not found/i,
  /Authentication failed/i,
  /Rate limit exceeded/i,
  /Model not found/i,
  /Invalid request/i,
  /Connection timeout/i,
  /Network error/i,
  /Process terminated/i,
  /Claude CLI not found/i,
  /Permission denied/i,
];

/**
 * Buffer size for stdout/stderr streams
 * 64KB
 */
export const BUFFER_SIZE = 64 * 1024;

/**
 * Grace period for process shutdown before force kill
 * 5 seconds (5000ms)
 */
export const SHUTDOWN_GRACE_PERIOD_MS = 5000;
