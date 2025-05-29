import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Logger } from '../logger';
import type {
  CLIDetectionResult,
  CLIDetectionError,
  CLIValidation,
} from './cli-types';

const execAsync = promisify(exec);

/**
 * Detects Claude Code CLI installation
 */
export class ClaudeCodeCLIDetector {
  private readonly logger = new Logger('CLIDetector');

  private readonly commonPaths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '~/.local/bin/claude',
    '~/.npm-global/bin/claude',
    '/usr/bin/claude',
    'C:\\Program Files\\Claude\\claude.exe',
    'C:\\Program Files (x86)\\Claude\\claude.exe',
    'C:\\Users\\%USERNAME%\\AppData\\Local\\Claude\\claude.exe',
    'C:\\Users\\%USERNAME%\\AppData\\Roaming\\npm\\claude.cmd',
  ];

  private readonly knownCommands = [
    'claude',
    'claude-code',
    'claude-cli',
    'anthropic',
  ];

  /**
   * Detect Claude CLI
   */
  async detect(): Promise<CLIDetectionResult> {
    this.logger.info('Starting Claude CLI detection');

    // Try multiple detection methods in order of preference
    const methods = [
      this.detectFromPath.bind(this),
      this.detectFromCommonLocations.bind(this),
      this.detectFromNpm.bind(this),
      this.detectFromHomebrew.bind(this),
      this.detectFromRegistry.bind(this), // Windows only
      this.detectFromEnvironment.bind(this),
    ];

    for (const method of methods) {
      try {
        const result = await method();
        if (result.found) {
          this.logger.info(`CLI found: ${result.path} (v${result.version})`);
          return result;
        }
      } catch (error) {
        this.logger.debug(`Detection method failed: ${error}`);
      }
    }

    return this.buildNotFoundResult();
  }

  /**
   * Validate CLI installation
   */
  async validate(cliPath: string): Promise<CLIValidation> {
    try {
      // Check if file exists
      const stats = await fs.stat(cliPath);

      // Check permissions
      const hasCorrectPermissions = (stats.mode & 0o111) !== 0; // Executable

      // Check version
      const version = await this.getVersion(cliPath);
      const isCorrectVersion =
        version !== 'unknown' && !version.includes('error');

      // Test execution
      const canExecute = await this.testExecution(cliPath);

      return {
        isValid: hasCorrectPermissions && isCorrectVersion && canExecute,
        hasCorrectPermissions,
        isCorrectVersion,
        canExecute,
      };
    } catch (error) {
      return {
        isValid: false,
        hasCorrectPermissions: false,
        isCorrectVersion: false,
        canExecute: false,
      };
    }
  }

  /**
   * Detect from PATH environment variable
   */
  private async detectFromPath(): Promise<CLIDetectionResult> {
    for (const command of this.knownCommands) {
      try {
        const whereCommand = os.platform() === 'win32' ? 'where' : 'which';
        const { stdout } = await execAsync(`${whereCommand} ${command}`);

        if (stdout) {
          const paths = stdout.trim().split('\n');
          for (const path of paths) {
            const trimmedPath = path.trim();
            if (trimmedPath) {
              const version = await this.getVersion(trimmedPath);
              return { found: true, path: trimmedPath, version };
            }
          }
        }
      } catch (error) {
        // Command not found, continue
      }
    }

    return { found: false };
  }

  /**
   * Detect from common installation locations
   */
  private async detectFromCommonLocations(): Promise<CLIDetectionResult> {
    const pathsToCheck = this.expandPaths(this.commonPaths);

    for (const cliPath of pathsToCheck) {
      try {
        await fs.access(cliPath, fs.constants.X_OK);
        const version = await this.getVersion(cliPath);
        return { found: true, path: cliPath, version };
      } catch (error) {
        // Path doesn't exist or not executable
      }
    }

    return { found: false };
  }

  /**
   * Detect from npm global installation
   */
  private async detectFromNpm(): Promise<CLIDetectionResult> {
    try {
      const { stdout } = await execAsync('npm list -g --depth=0 claude-code');
      if (stdout.includes('claude-code')) {
        // Get npm global bin directory
        const { stdout: binPath } = await execAsync('npm bin -g');
        const cliPath = path.join(binPath.trim(), 'claude');

        try {
          await fs.access(cliPath);
          const version = await this.getVersion(cliPath);
          return { found: true, path: cliPath, version };
        } catch {
          // Binary not found in npm bin
        }
      }
    } catch (error) {
      // Not installed via npm
    }

    return { found: false };
  }

  /**
   * Detect from Homebrew (macOS)
   */
  private async detectFromHomebrew(): Promise<CLIDetectionResult> {
    if (os.platform() !== 'darwin') {
      return { found: false };
    }

    try {
      const { stdout } = await execAsync('brew list claude-code');
      if (stdout) {
        const { stdout: prefix } = await execAsync('brew --prefix');
        const cliPath = path.join(prefix.trim(), 'bin', 'claude');

        try {
          await fs.access(cliPath);
          const version = await this.getVersion(cliPath);
          return { found: true, path: cliPath, version };
        } catch {
          // Binary not found in Homebrew
        }
      }
    } catch (error) {
      // Not installed via Homebrew
    }

    return { found: false };
  }

  /**
   * Detect from Windows Registry
   */
  private async detectFromRegistry(): Promise<CLIDetectionResult> {
    if (os.platform() !== 'win32') {
      return { found: false };
    }

    try {
      const { stdout } = await execAsync(
        'reg query "HKLM\\SOFTWARE\\Claude" /v InstallPath',
      );

      const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
      if (match) {
        const installPath = match[1].trim();
        const cliPath = path.join(installPath, 'claude.exe');

        try {
          await fs.access(cliPath);
          const version = await this.getVersion(cliPath);
          return { found: true, path: cliPath, version };
        } catch {
          // Binary not found at registry path
        }
      }
    } catch (error) {
      // Registry key not found
    }

    return { found: false };
  }

  /**
   * Detect from environment variables
   */
  private async detectFromEnvironment(): Promise<CLIDetectionResult> {
    const envPaths = [
      process.env.CLAUDE_CLI_PATH,
      process.env.CLAUDE_CODE_PATH,
      process.env.ANTHROPIC_CLI_PATH,
    ].filter(Boolean);

    for (const envPath of envPaths) {
      if (envPath) {
        try {
          await fs.access(envPath, fs.constants.X_OK);
          const version = await this.getVersion(envPath);
          return { found: true, path: envPath, version };
        } catch {
          // Path from env var doesn't exist
        }
      }
    }

    return { found: false };
  }

  /**
   * Get CLI version
   */
  private async getVersion(cliPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`"${cliPath}" --version`);
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      return versionMatch ? versionMatch[1] : stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Test CLI execution
   */
  private async testExecution(cliPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`"${cliPath}" --help`);
      return stdout.includes('claude') || stdout.includes('Usage:');
    } catch {
      return false;
    }
  }

  /**
   * Expand paths with environment variables
   */
  private expandPaths(paths: string[]): string[] {
    return paths.map((p) => {
      let expandedPath = p;

      // Expand home directory
      if (expandedPath.startsWith('~')) {
        expandedPath = path.join(os.homedir(), expandedPath.slice(1));
      }

      // Expand environment variables on Windows
      if (os.platform() === 'win32') {
        expandedPath = expandedPath.replace(
          /%([^%]+)%/g,
          (_, key) => process.env[key] || _,
        );
      }

      return expandedPath;
    });
  }

  /**
   * Build not found result with suggestions
   */
  private buildNotFoundResult(): CLIDetectionResult {
    const platform = os.platform();
    const suggestions: string[] = [];

    switch (platform) {
      case 'darwin':
        suggestions.push(
          'Install via Homebrew: brew install claude-code',
          'Install via npm: npm install -g claude-code',
          'Download from https://claude.ai/download',
        );
        break;
      case 'win32':
        suggestions.push(
          'Download installer from https://claude.ai/download',
          'Install via npm: npm install -g claude-code',
          'Install via Chocolatey: choco install claude-code',
        );
        break;
      default:
        suggestions.push(
          'Install via npm: npm install -g claude-code',
          'Download from https://claude.ai/download',
          'Build from source: https://github.com/anthropics/claude-cli',
        );
    }

    const error: CLIDetectionError = {
      type: 'not_found',
      message: 'Claude Code CLI not found on your system',
      details: {
        searchedPaths: this.commonPaths,
        searchedCommands: this.knownCommands,
      },
    };

    return {
      found: false,
      error,
      suggestions,
    };
  }

  /**
   * Get CLI capabilities
   */
  async getCapabilities(cliPath: string): Promise<{
    supportsStreaming: boolean;
    supportsInteractive: boolean;
    supportedModels: string[];
    maxContextLength: number;
  }> {
    try {
      const { stdout } = await execAsync(`"${cliPath}" --capabilities`);

      // Parse capabilities from output
      // This is a placeholder - actual implementation would parse real CLI output
      return {
        supportsStreaming: true,
        supportsInteractive: true,
        supportedModels: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        maxContextLength: 100000,
      };
    } catch {
      // Return default capabilities
      return {
        supportsStreaming: false,
        supportsInteractive: false,
        supportedModels: [],
        maxContextLength: 0,
      };
    }
  }
}
