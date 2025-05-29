import * as vscode from 'vscode';
import { startServer, stopServer } from '../http-server/server';
import { findAvailablePort } from '../utils/find-available-port';
import {
  getExtensionBridge,
  DEFAULT_PORT,
} from '@stagewise/extension-toolbar-srpc-contract';
import { setupToolbar } from './setup-toolbar';
import { getCurrentIDE } from 'src/utils/get-current-ide';
import { dispatchAgentCall } from 'src/utils/dispatch-agent-call';
import { setClaudeAgentContext } from 'src/utils/call-claude-agent';
import { createLifecycleManager } from '../claude/lifecycle-manager';
import {
  mcpToolbarIntegration,
  connectMCPToolsToToolbar,
} from '../mcp/integration';
import {
  ConfigurationManager,
  migrateConfiguration,
  showSetupGuide,
  getConfiguration,
} from '../utils/configuration';
import { memoryMonitor, resourceManager } from '../utils/performance';
import { errorLogger } from '../utils/error-handling';

// Diagnostic collection specifically for our fake prompt
const fakeDiagCollection =
  vscode.languages.createDiagnosticCollection('stagewise');

// Claude lifecycle manager instance
let claudeLifecycleManager:
  | ReturnType<typeof createLifecycleManager>
  | undefined;

// Configuration manager instance
const configManager = new ConfigurationManager();

// Dummy handler for the setupToolbar command
async function setupToolbarHandler() {
  await setupToolbar();
}

export async function activate(context: vscode.ExtensionContext) {
  const ide = getCurrentIDE();
  if (ide === 'UNKNOWN') {
    vscode.window.showInformationMessage(
      'stagewise does not work for your current IDE.',
    );
    return;
  }
  context.subscriptions.push(fakeDiagCollection); // Dispose on deactivation

  // Initialize Claude agent context for VSCode integration
  setClaudeAgentContext(context);

  try {
    // Migrate configuration if needed
    await migrateConfiguration();

    // Get and validate configuration
    const config = getConfiguration();

    // Start configuration manager
    configManager.start();
    configManager.onConfigurationChange((newConfig) => {
      console.log('Configuration changed:', newConfig);
      // Handle configuration changes
    });

    // Start memory monitoring if enabled
    if (config.stagewise.logging.level === 'debug') {
      memoryMonitor.start(30000); // Check every 30 seconds
    }
    // Find an available port
    const port = await findAvailablePort(DEFAULT_PORT);

    // Register MCP server with the actual port
    // updateCursorMcpConfig(port); // Disabled for now, since MCP tools are not available yet

    // Start the HTTP server with the same port
    const server = await startServer(port);
    const bridge = getExtensionBridge(server);

    bridge.register({
      triggerAgentPrompt: async (request: any, sendUpdate: any) => {
        await dispatchAgentCall(request);
        sendUpdate.sendUpdate({ updateText: 'Called the agent' });

        return { result: { success: true } };
      },
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to start server: ${error}`);
    throw error;
  }

  // Register the setupToolbar command
  const setupToolbarCommand = vscode.commands.registerCommand(
    'stagewise-cc.setupToolbar',
    setupToolbarHandler,
  );
  context.subscriptions.push(setupToolbarCommand);

  // Initialize Claude Code integration
  try {
    claudeLifecycleManager = createLifecycleManager(context);
    await claudeLifecycleManager.activate();
  } catch (error) {
    console.error('Failed to activate Claude Code integration:', error);
    // Don't throw - allow the extension to continue working without Claude
    vscode.window.showWarningMessage(
      'Claude Code integration failed to activate. The extension will continue without AI assistance.',
    );
  }

  // Initialize MCP-Toolbar integration
  try {
    await mcpToolbarIntegration.initialize();
    connectMCPToolsToToolbar();
    console.log('MCP-Toolbar integration activated');
  } catch (error) {
    errorLogger.log(error as Error, {
      operation: 'mcp_toolbar_integration_activation',
      timestamp: new Date(),
    });
    vscode.window.showWarningMessage(
      'Failed to initialize MCP-Toolbar integration. Some features may be limited.',
    );
  }

  // Register setup guide command
  const setupGuideCommand = vscode.commands.registerCommand(
    'stagewise-cc.showSetupGuide',
    showSetupGuide,
  );
  context.subscriptions.push(setupGuideCommand);

  // Show activation message
  vscode.window.showInformationMessage(
    `Stagewise activated successfully on port ${await findAvailablePort(DEFAULT_PORT)}`,
  );
}

export async function deactivate() {
  await stopServer();

  // Deactivate Claude Code integration
  if (claudeLifecycleManager) {
    try {
      await claudeLifecycleManager.deactivate();
    } catch (error) {
      console.error('Error deactivating Claude Code integration:', error);
    }
  }

  // Stop configuration manager
  configManager.stop();

  // Stop memory monitor
  memoryMonitor.stop();

  // Clean up resources
  try {
    await resourceManager.cleanup();
  } catch (error) {
    console.error('Error cleaning up resources:', error);
  }
}
