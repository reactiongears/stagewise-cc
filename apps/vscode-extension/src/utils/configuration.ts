import * as vscode from 'vscode';
import { z } from 'zod';
import { ErrorCode, StagewiseError } from './error-handling';

// Configuration schema
const ConfigurationSchema = z.object({
  stagewise: z.object({
    server: z.object({
      port: z.number().min(1024).max(65535).default(5746),
      host: z.string().default('localhost'),
      autoStart: z.boolean().default(true),
    }),
    mcp: z.object({
      enabled: z.boolean().default(true),
      maxConcurrentTools: z.number().min(1).max(10).default(5),
      timeout: z.number().min(1000).max(300000).default(30000), // 30 seconds
    }),
    performance: z.object({
      cacheEnabled: z.boolean().default(true),
      cacheTTL: z.number().min(60000).max(3600000).default(300000), // 5 minutes
      rateLimitPerMinute: z.number().min(10).max(100).default(30),
    }),
    images: z.object({
      maxSizeMB: z.number().min(1).max(10).default(5),
      maxDimension: z.number().min(512).max(4096).default(2048),
      compressionQuality: z.number().min(0.1).max(1).default(0.9),
    }),
    logging: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      maxLogSize: z.number().min(100).max(10000).default(1000),
    }),
  }),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

/**
 * Gets the current configuration with validation
 */
export function getConfiguration(): Configuration {
  const config = vscode.workspace.getConfiguration();

  try {
    const rawConfig = {
      stagewise: {
        server: {
          port: config.get<number>('stagewise.server.port', 5746),
          host: config.get<string>('stagewise.server.host', 'localhost'),
          autoStart: config.get<boolean>('stagewise.server.autoStart', true),
        },
        mcp: {
          enabled: config.get<boolean>('stagewise.mcp.enabled', true),
          maxConcurrentTools: config.get<number>(
            'stagewise.mcp.maxConcurrentTools',
            5,
          ),
          timeout: config.get<number>('stagewise.mcp.timeout', 30000),
        },
        performance: {
          cacheEnabled: config.get<boolean>(
            'stagewise.performance.cacheEnabled',
            true,
          ),
          cacheTTL: config.get<number>(
            'stagewise.performance.cacheTTL',
            300000,
          ),
          rateLimitPerMinute: config.get<number>(
            'stagewise.performance.rateLimitPerMinute',
            30,
          ),
        },
        images: {
          maxSizeMB: config.get<number>('stagewise.images.maxSizeMB', 5),
          maxDimension: config.get<number>(
            'stagewise.images.maxDimension',
            2048,
          ),
          compressionQuality: config.get<number>(
            'stagewise.images.compressionQuality',
            0.9,
          ),
        },
        logging: {
          level: config.get<'debug' | 'info' | 'warn' | 'error'>(
            'stagewise.logging.level',
            'info',
          ),
          maxLogSize: config.get<number>('stagewise.logging.maxLogSize', 1000),
        },
      },
    };

    return ConfigurationSchema.parse(rawConfig);
  } catch (error) {
    throw new StagewiseError(
      ErrorCode.CONFIGURATION_ERROR,
      'Invalid configuration',
      { error: error instanceof z.ZodError ? error.errors : error },
      false,
    );
  }
}

/**
 * Validates a partial configuration update
 */
export function validateConfiguration(config: unknown): Configuration {
  try {
    return ConfigurationSchema.parse(config);
  } catch (error) {
    throw new StagewiseError(
      ErrorCode.CONFIGURATION_ERROR,
      'Invalid configuration',
      { error: error instanceof z.ZodError ? error.errors : error },
      false,
    );
  }
}

/**
 * Configuration change handler
 */
export class ConfigurationManager {
  private listeners: Array<(config: Configuration) => void> = [];
  private disposable: vscode.Disposable | null = null;

  start(): void {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stagewise')) {
        try {
          const config = getConfiguration();
          this.notifyListeners(config);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
    });
  }

  stop(): void {
    if (this.disposable) {
      this.disposable.dispose();
      this.disposable = null;
    }
  }

  onConfigurationChange(listener: (config: Configuration) => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(config: Configuration): void {
    this.listeners.forEach((listener) => {
      try {
        listener(config);
      } catch (error) {
        console.error('Configuration listener error:', error);
      }
    });
  }
}

/**
 * Environment verification
 */
export interface EnvironmentCheck {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

export async function verifyEnvironment(): Promise<EnvironmentCheck[]> {
  const checks: EnvironmentCheck[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = Number.parseInt(nodeVersion.split('.')[0].substring(1));
  checks.push({
    name: 'Node.js Version',
    passed: majorVersion >= 16,
    message:
      majorVersion >= 16
        ? `Node.js ${nodeVersion} is supported`
        : `Node.js ${nodeVersion} is too old. Please upgrade to v16 or later.`,
    details: { version: nodeVersion, required: '>=16.0.0' },
  });

  // Check workspace
  const hasWorkspace =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0;
  checks.push({
    name: 'Workspace',
    passed: hasWorkspace,
    message: hasWorkspace
      ? 'Workspace folder is open'
      : 'No workspace folder is open. Please open a folder to use Stagewise.',
  });

  // Check extension dependencies
  const requiredExtensions = [
    // Add any required extension IDs here
  ];

  for (const extId of requiredExtensions) {
    const ext = vscode.extensions.getExtension(extId);
    checks.push({
      name: `Extension: ${extId}`,
      passed: !!ext,
      message: ext
        ? `Required extension ${extId} is installed`
        : `Required extension ${extId} is not installed`,
      details: { extensionId: extId },
    });
  }

  // Check configuration validity
  try {
    getConfiguration();
    checks.push({
      name: 'Configuration',
      passed: true,
      message: 'Configuration is valid',
    });
  } catch (error) {
    checks.push({
      name: 'Configuration',
      passed: false,
      message: 'Configuration is invalid',
      details: error,
    });
  }

  return checks;
}

/**
 * Shows setup wizard/guide
 */
export async function showSetupGuide(): Promise<void> {
  const checks = await verifyEnvironment();
  const failedChecks = checks.filter((c) => !c.passed);

  if (failedChecks.length === 0) {
    vscode.window.showInformationMessage(
      'Stagewise is properly configured and ready to use!',
    );
    return;
  }

  const items = failedChecks.map((check) => ({
    label: check.name,
    description: check.message,
    detail: check.details ? JSON.stringify(check.details) : undefined,
  }));

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: 'The following issues were found. Select one to see details:',
    canPickMany: false,
  });

  if (selection) {
    const actions: string[] = ['Dismiss'];

    // Add specific actions based on the issue
    if (selection.label === 'Workspace') {
      actions.push('Open Folder');
    } else if (selection.label === 'Configuration') {
      actions.push('Open Settings');
    }

    const action = await vscode.window.showErrorMessage(
      selection.description,
      ...actions,
    );

    if (action === 'Open Folder') {
      vscode.commands.executeCommand('vscode.openFolder');
    } else if (action === 'Open Settings') {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'stagewise',
      );
    }
  }
}

/**
 * Configuration migration for updates
 */
export async function migrateConfiguration(): Promise<void> {
  const config = vscode.workspace.getConfiguration();

  // Example: Migrate old configuration keys to new ones
  const migrations = [
    {
      old: 'stagewise.port',
      new: 'stagewise.server.port',
    },
    {
      old: 'stagewise.enableMcp',
      new: 'stagewise.mcp.enabled',
    },
  ];

  let migrated = false;

  for (const migration of migrations) {
    const oldValue = config.get(migration.old);
    if (oldValue !== undefined) {
      await config.update(
        migration.new,
        oldValue,
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        migration.old,
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      migrated = true;
    }
  }

  if (migrated) {
    vscode.window.showInformationMessage(
      'Stagewise configuration has been migrated to the new format.',
    );
  }
}
