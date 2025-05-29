import * as vscode from 'vscode';
import type { PromptRequest } from '@stagewise/extension-toolbar-srpc-contract';
import { ClaudeAgent } from '../claude/call-claude-agent';

let claudeAgentInstance: ClaudeAgent | undefined;

// Store the extension context when the extension activates
export function setClaudeAgentContext(context: vscode.ExtensionContext) {
  // Initialize agent with context
  claudeAgentInstance = new ClaudeAgent(context);
}

export async function callClaudeAgent(request: PromptRequest): Promise<void> {
  try {
    // Ensure Claude agent is initialized
    if (!claudeAgentInstance) {
      throw new Error(
        'Claude agent not initialized. Please restart the extension.',
      );
    }

    // Initialize if not already done
    await claudeAgentInstance.initialize();

    // Build the full prompt from the request
    const parts = [request.prompt];

    if (request.files && request.files.length > 0) {
      parts.push('\nFiles to consider:');
      parts.push(...request.files.map((f: string) => `- ${f}`));
    }

    if (request.images && request.images.length > 0) {
      parts.push('\nImages:');
      parts.push(...request.images.map((img: string) => `- ${img}`));
    }

    const prompt = parts.join('\n');

    // Show progress while Claude processes the request
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Processing with Claude...',
        cancellable: false,
      },
      async (progress) => {
        // Call Claude agent
        const result = await claudeAgentInstance.callClaude(prompt, {
          stream: false,
        });

        if (result.success && result.response) {
          // Show response in output channel
          const outputChannel =
            vscode.window.createOutputChannel('Claude Response');
          outputChannel.clear();
          outputChannel.appendLine('=== Claude Response ===');
          outputChannel.appendLine(result.response);

          if (result.usage) {
            outputChannel.appendLine('');
            outputChannel.appendLine(
              `Tokens: ${result.usage.totalTokens} (input: ${result.usage.inputTokens}, output: ${result.usage.outputTokens})`,
            );
          }

          if (result.processInfo) {
            outputChannel.appendLine(
              `Processing time: ${result.processInfo.executionTime}ms`,
            );
          }

          outputChannel.show();
        } else {
          throw new Error(result.error || 'Failed to get Claude response');
        }
      },
    );
  } catch (error) {
    // If Claude is not configured or there's an error, prompt the user
    const errorMessage = error instanceof Error ? error.message : String(error);

    const choice = await vscode.window.showErrorMessage(
      `Claude Code integration error: ${errorMessage}. Would you like to set it up?`,
      'Set up Claude',
      'Cancel',
    );

    if (choice === 'Set up Claude') {
      await vscode.commands.executeCommand('stagewise-cc.claude.setApiKey');
    }
  }
}
