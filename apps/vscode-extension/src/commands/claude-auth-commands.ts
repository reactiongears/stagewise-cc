import * as vscode from 'vscode';
import type { ClaudeAuthService } from '../claude/auth-service';
import { AuthStatus } from '../claude/auth-types';

export function registerClaudeAuthCommands(
  context: vscode.ExtensionContext,
  authService: ClaudeAuthService,
): void {
  // Set API Key Command
  const setApiKeyCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.setApiKey',
    async () => {
      try {
        const apiKey = await vscode.window.showInputBox({
          prompt: 'Enter your Anthropic API Key',
          placeHolder: 'sk-ant-...',
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value) {
              return 'API key is required';
            }
            if (!value.startsWith('sk-ant-')) {
              return 'API key should start with "sk-ant-"';
            }
            return null;
          },
        });

        if (apiKey) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Validating API key...',
              cancellable: false,
            },
            async () => {
              await authService.setApiKey(apiKey);
            },
          );
        }
      } catch (error) {
        // Error handling is done in the auth service
      }
    },
  );

  // Validate API Key Command
  const validateApiKeyCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.validateApiKey',
    async () => {
      try {
        const apiKey = await authService.getApiKey();
        if (!apiKey) {
          vscode.window
            .showWarningMessage(
              'No API key configured. Please set your API key first.',
              'Set API Key',
            )
            .then((selection) => {
              if (selection === 'Set API Key') {
                vscode.commands.executeCommand('stagewise-cc.claude.setApiKey');
              }
            });
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Validating API key...',
            cancellable: false,
          },
          async () => {
            const result = await authService.validateApiKey(apiKey);
            if (result.isValid) {
              vscode.window.showInformationMessage(
                `API key is valid! Available models: ${result.capabilities?.join(', ') || 'Claude'}`,
              );
            } else {
              vscode.window.showErrorMessage(
                result.error || 'API key validation failed',
              );
            }
          },
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          'Failed to validate API key. Check the output channel for details.',
        );
      }
    },
  );

  // Remove API Key Command
  const removeApiKeyCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.removeApiKey',
    async () => {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to remove your Claude API key?',
        { modal: true },
        'Remove',
      );

      if (confirmation === 'Remove') {
        try {
          await authService.deleteApiKey();
        } catch (error) {
          vscode.window.showErrorMessage(
            'Failed to remove API key. Check the output channel for details.',
          );
        }
      }
    },
  );

  // Add commands to subscriptions
  context.subscriptions.push(
    setApiKeyCommand,
    validateApiKeyCommand,
    removeApiKeyCommand,
  );

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  // Update status bar based on auth status
  const updateStatusBar = () => {
    const status = authService.getStatus();

    switch (status) {
      case AuthStatus.NOT_CONFIGURED:
        statusBarItem.text = '$(key) Claude: Not Configured';
        statusBarItem.tooltip = 'Click to set API key';
        statusBarItem.command = 'stagewise-cc.claude.setApiKey';
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        );
        break;

      case AuthStatus.VALIDATING:
        statusBarItem.text = '$(sync~spin) Claude: Validating...';
        statusBarItem.tooltip = 'Validating API key';
        statusBarItem.command = undefined;
        statusBarItem.backgroundColor = undefined;
        break;

      case AuthStatus.VALID:
        statusBarItem.text = '$(check) Claude: Ready';
        statusBarItem.tooltip = 'Click to validate API key';
        statusBarItem.command = 'stagewise-cc.claude.validateApiKey';
        statusBarItem.backgroundColor = undefined;
        break;

      case AuthStatus.INVALID:
        statusBarItem.text = '$(error) Claude: Invalid Key';
        statusBarItem.tooltip = 'Click to update API key';
        statusBarItem.command = 'stagewise-cc.claude.setApiKey';
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
        break;

      case AuthStatus.ERROR:
        statusBarItem.text = '$(warning) Claude: Error';
        statusBarItem.tooltip = 'Click to retry configuration';
        statusBarItem.command = 'stagewise-cc.claude.setApiKey';
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
        break;
    }

    statusBarItem.show();
  };

  // Listen for status changes
  authService.on('statusChange', updateStatusBar);

  // Initial status bar update
  updateStatusBar();

  // Add status bar to subscriptions
  context.subscriptions.push(statusBarItem);
}
