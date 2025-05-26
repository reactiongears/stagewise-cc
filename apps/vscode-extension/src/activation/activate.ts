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
import { createLifecycleManager } from '../claude/lifecycle-manager';

// Diagnostic collection specifically for our fake prompt
const fakeDiagCollection =
  vscode.languages.createDiagnosticCollection('stagewise');

// Claude lifecycle manager instance
let claudeLifecycleManager: ReturnType<typeof createLifecycleManager> | undefined;

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

  try {
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
      'Claude Code integration failed to activate. The extension will continue without AI assistance.'
    );
  }
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
}
