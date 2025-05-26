import * as vscode from 'vscode';
import { ClaudeService } from '../claude/claude-service';
import { ClaudeRequest } from '../claude/service-types';

export function registerClaudeInteractionCommands(
  context: vscode.ExtensionContext,
  claudeService: ClaudeService
): void {
  // Send Prompt Command
  const sendPromptCommand = vscode.commands.registerCommand(
    'stagewise.claude.sendPrompt',
    async (providedPrompt?: string) => {
      try {
        // Ensure we have a session
        let session = claudeService.getCurrentSession();
        if (!session) {
          session = await claudeService.createSession({
            name: 'Interactive Session',
            description: 'Created from command palette'
          });
        }

        // Get prompt from user or use provided prompt
        const prompt = providedPrompt || await vscode.window.showInputBox({
          prompt: 'Enter your prompt for Claude',
          placeHolder: 'Ask Claude anything...',
          ignoreFocusOut: true
        });

        if (!prompt) {
          return;
        }

        // Show progress
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Sending prompt to Claude...',
            cancellable: false
          },
          async (progress) => {
            try {
              const request: ClaudeRequest = {
                prompt,
                options: {
                  stream: false
                }
              };

              const response = await claudeService.sendPrompt(request);
              
              // Show response in output channel
              const outputChannel = vscode.window.createOutputChannel('Claude Response');
              outputChannel.clear();
              outputChannel.appendLine('=== Claude Response ===');
              outputChannel.appendLine(response.content);
              outputChannel.appendLine('');
              outputChannel.appendLine(`Model: ${response.metadata.model}`);
              outputChannel.appendLine(`Processing time: ${response.metadata.processingTime}ms`);
              outputChannel.show();

            } catch (error) {
              vscode.window.showErrorMessage(`Failed to get response: ${error}`);
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to send prompt: ${error}`);
      }
    }
  );

  // Send Selection to Claude
  const sendSelectionCommand = vscode.commands.registerCommand(
    'stagewise.claude.sendSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }

      const selectedText = editor.document.getText(selection);
      
      try {
        // Ensure we have a session
        let session = claudeService.getCurrentSession();
        if (!session) {
          session = await claudeService.createSession({
            name: 'Code Analysis Session',
            description: 'Analyzing selected code'
          });
        }

        // Ask what to do with selection
        const action = await vscode.window.showQuickPick([
          { label: '$(comment) Explain this code', value: 'explain' },
          { label: '$(debug) Find issues', value: 'debug' },
          { label: '$(edit) Refactor', value: 'refactor' },
          { label: '$(test-view-icon) Generate tests', value: 'test' },
          { label: '$(book) Add documentation', value: 'document' },
          { label: '$(question) Custom prompt', value: 'custom' }
        ], {
          placeHolder: 'What would you like Claude to do with the selected code?'
        });

        if (!action) {
          return;
        }

        let prompt = '';
        switch (action.value) {
          case 'explain':
            prompt = `Please explain the following code:\n\n${selectedText}`;
            break;
          case 'debug':
            prompt = `Please analyze the following code for potential issues or bugs:\n\n${selectedText}`;
            break;
          case 'refactor':
            prompt = `Please suggest refactoring improvements for the following code:\n\n${selectedText}`;
            break;
          case 'test':
            prompt = `Please generate unit tests for the following code:\n\n${selectedText}`;
            break;
          case 'document':
            prompt = `Please add comprehensive documentation comments to the following code:\n\n${selectedText}`;
            break;
          case 'custom':
            const customPrompt = await vscode.window.showInputBox({
              prompt: 'Enter your custom prompt',
              placeHolder: 'What would you like to know about the selected code?'
            });
            if (!customPrompt) {
              return;
            }
            prompt = `${customPrompt}\n\nCode:\n${selectedText}`;
            break;
        }

        // Send to Claude
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Getting Claude\'s response...',
            cancellable: false
          },
          async () => {
            const request: ClaudeRequest = {
              prompt,
              options: {
                stream: false
              }
            };

            const response = await claudeService.sendPrompt(request);
            
            // Show response
            const outputChannel = vscode.window.createOutputChannel('Claude Analysis');
            outputChannel.clear();
            outputChannel.appendLine(`=== ${action.label} ===`);
            outputChannel.appendLine('');
            outputChannel.appendLine(response.content);
            outputChannel.show();

            // Offer to apply changes if it's a refactor or documentation
            if (action.value === 'refactor' || action.value === 'document') {
              const apply = await vscode.window.showInformationMessage(
                'Would you like to apply Claude\'s suggestions?',
                'Apply',
                'Cancel'
              );
              
              if (apply === 'Apply') {
                // This is a simplified implementation
                // In a real implementation, you'd parse Claude's response
                // and apply the changes intelligently
                await editor.edit(editBuilder => {
                  editBuilder.replace(selection, response.content);
                });
              }
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to analyze selection: ${error}`);
      }
    }
  );

  // New Session Command
  const newSessionCommand = vscode.commands.registerCommand(
    'stagewise.claude.newSession',
    async () => {
      try {
        const name = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new session',
          placeHolder: 'My Session',
          value: `Session ${new Date().toLocaleString()}`
        });

        if (!name) {
          return;
        }

        const session = await claudeService.createSession({
          name,
          description: 'Created from command palette',
          timestamp: new Date()
        });

        vscode.window.showInformationMessage(`Created new session: ${name}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create session: ${error}`);
      }
    }
  );

  // Switch Session Command
  const switchSessionCommand = vscode.commands.registerCommand(
    'stagewise.claude.switchSession',
    async () => {
      const sessions = claudeService.getAllSessions();
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No sessions available');
        return;
      }

      const current = claudeService.getCurrentSession();
      const items = sessions.map(session => ({
        label: session.metadata.name || session.id,
        description: `${session.history.length} messages`,
        detail: session.id === current?.id ? '(current)' : `Started ${session.startTime.toLocaleString()}`,
        session
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a session to switch to'
      });

      if (selected) {
        claudeService.setCurrentSession(selected.session.id);
        vscode.window.showInformationMessage(`Switched to session: ${selected.label}`);
      }
    }
  );

  // Clear History Command
  const clearHistoryCommand = vscode.commands.registerCommand(
    'stagewise.claude.clearHistory',
    async () => {
      const session = claudeService.getCurrentSession();
      if (!session) {
        vscode.window.showWarningMessage('No active session');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Clear all history for session "${session.metadata.name || session.id}"?`,
        { modal: true },
        'Clear'
      );

      if (confirm === 'Clear') {
        await claudeService.clearHistory();
        vscode.window.showInformationMessage('Session history cleared');
      }
    }
  );

  // Show Session History Command
  const showHistoryCommand = vscode.commands.registerCommand(
    'stagewise.claude.showHistory',
    async () => {
      const session = claudeService.getCurrentSession();
      if (!session) {
        vscode.window.showWarningMessage('No active session');
        return;
      }

      if (session.history.length === 0) {
        vscode.window.showInformationMessage('No history in current session');
        return;
      }

      // Create a webview to show history
      const panel = vscode.window.createWebviewPanel(
        'claudeHistory',
        `Claude History: ${session.metadata.name || session.id}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );

      // Generate HTML for history
      const historyHtml = session.history.map(entry => `
        <div class="entry ${entry.role}">
          <div class="header">
            <span class="role">${entry.role === 'user' ? 'You' : 'Claude'}</span>
            <span class="timestamp">${entry.timestamp.toLocaleString()}</span>
          </div>
          <div class="content">${escapeHtml(entry.content)}</div>
        </div>
      `).join('');

      panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: var(--vscode-font-family);
              color: var(--vscode-foreground);
              background: var(--vscode-editor-background);
              padding: 20px;
              line-height: 1.6;
            }
            .entry {
              margin-bottom: 20px;
              padding: 15px;
              border-radius: 8px;
              background: var(--vscode-editor-inactiveSelectionBackground);
            }
            .entry.user {
              background: var(--vscode-editor-selectionBackground);
            }
            .header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              font-size: 0.9em;
              opacity: 0.8;
            }
            .role {
              font-weight: bold;
            }
            .content {
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          <h1>Session History</h1>
          ${historyHtml}
        </body>
        </html>
      `;
    }
  );

  // Check Health Command
  const checkHealthCommand = vscode.commands.registerCommand(
    'stagewise.claude.checkHealth',
    async () => {
      try {
        const health = await claudeService.getHealth();
        
        const items = [
          `Overall: ${health.overall}`,
          `Subprocess: ${health.subprocess.status} - ${health.subprocess.message || 'OK'}`,
          `Authentication: ${health.auth.status} - ${health.auth.message || 'OK'}`,
          `Configuration: ${health.config.status} - ${health.config.message || 'OK'}`,
          `Last check: ${health.lastCheck.toLocaleString()}`
        ];

        vscode.window.showInformationMessage(
          'Claude Service Health',
          { modal: true, detail: items.join('\n') },
          'OK'
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to check health: ${error}`);
      }
    }
  );

  // Add all commands to subscriptions
  context.subscriptions.push(
    sendPromptCommand,
    sendSelectionCommand,
    newSessionCommand,
    switchSessionCommand,
    clearHistoryCommand,
    showHistoryCommand,
    checkHealthCommand
  );
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}