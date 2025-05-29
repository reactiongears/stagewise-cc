import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ClaudeConfigService } from '../claude/config-service';
import { ConfigurationScope, ClaudeModel } from '../claude/config-types';

export function registerClaudeConfigCommands(
  context: vscode.ExtensionContext,
  configService: ClaudeConfigService,
): void {
  // Open Settings Command
  const openSettingsCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.openSettings',
    () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'stagewise.claude',
      );
    },
  );

  // Reset Settings Command
  const resetSettingsCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.resetSettings',
    async () => {
      const choice = await vscode.window.showWarningMessage(
        'Are you sure you want to reset Claude settings to defaults?',
        { modal: true },
        'Reset Workspace Settings',
        'Reset User Settings',
      );

      if (choice) {
        try {
          const scope =
            choice === 'Reset Workspace Settings'
              ? ConfigurationScope.WORKSPACE
              : ConfigurationScope.USER;

          await configService.resetConfiguration(scope);
          vscode.window.showInformationMessage(
            `Claude settings reset to defaults (${scope} scope)`,
          );
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to reset settings: ${error}`);
        }
      }
    },
  );

  // Export Configuration Command
  const exportConfigCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.exportConfig',
    async () => {
      try {
        const configData = await configService.exportConfiguration();

        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(vscode.workspace.rootPath || '', 'claude-config.json'),
          ),
          filters: {
            JSON: ['json'],
          },
        });

        if (saveUri) {
          await fs.writeFile(saveUri.fsPath, configData, 'utf8');
          vscode.window.showInformationMessage(
            'Configuration exported successfully',
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to export configuration: ${error}`,
        );
      }
    },
  );

  // Import Configuration Command
  const importConfigCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.importConfig',
    async () => {
      try {
        const openUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            JSON: ['json'],
          },
        });

        if (openUri?.[0]) {
          const configData = await fs.readFile(openUri[0].fsPath, 'utf8');
          await configService.importConfiguration(configData);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import configuration: ${error}`,
        );
      }
    },
  );

  // Save Profile Command
  const saveProfileCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.saveProfile',
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for this configuration profile',
        placeHolder: 'My Profile',
        validateInput: (value) => {
          if (!value) {
            return 'Profile name is required';
          }
          return null;
        },
      });

      if (name) {
        const description = await vscode.window.showInputBox({
          prompt: 'Enter a description for this profile (optional)',
          placeHolder: 'Configuration for Python development',
        });

        try {
          await configService.saveProfile(name, description);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to save profile: ${error}`);
        }
      }
    },
  );

  // Load Profile Command
  const loadProfileCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.loadProfile',
    async () => {
      const profiles = configService.getProfiles();
      const profileNames = Object.keys(profiles);

      if (profileNames.length === 0) {
        vscode.window.showInformationMessage('No saved profiles found');
        return;
      }

      const items = profileNames.map((name) => ({
        label: name,
        description: profiles[name].description || '',
        detail: profiles[name].isDefault ? '(Default)' : undefined,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a profile to load',
      });

      if (selected) {
        try {
          await configService.loadProfile(selected.label);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to load profile: ${error}`);
        }
      }
    },
  );

  // Delete Profile Command
  const deleteProfileCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.deleteProfile',
    async () => {
      const profiles = configService.getProfiles();
      const profileNames = Object.keys(profiles);

      if (profileNames.length === 0) {
        vscode.window.showInformationMessage('No saved profiles found');
        return;
      }

      const selected = await vscode.window.showQuickPick(profileNames, {
        placeHolder: 'Select a profile to delete',
      });

      if (selected) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the profile "${selected}"?`,
          { modal: true },
          'Delete',
        );

        if (confirm === 'Delete') {
          try {
            await configService.deleteProfile(selected);
            vscode.window.showInformationMessage(
              `Profile "${selected}" deleted`,
            );
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to delete profile: ${error}`,
            );
          }
        }
      }
    },
  );

  // Quick Configure Command
  const quickConfigureCommand = vscode.commands.registerCommand(
    'stagewise-cc.claude.quickConfigure',
    async () => {
      const choices = [
        {
          label: '$(zap) Fast & Simple',
          description: 'Haiku model, low temperature, optimized for speed',
          config: {
            model: ClaudeModel.CLAUDE_3_HAIKU,
            temperature: 0.3,
            maxTokens: 2048,
          },
        },
        {
          label: '$(beaker) Balanced',
          description: 'Sonnet model, medium temperature, good for most tasks',
          config: {
            model: ClaudeModel.CLAUDE_4_SONNET,
            temperature: 0.7,
            maxTokens: 4096,
          },
        },
        {
          label: '$(telescope) Advanced & Creative',
          description: 'Opus model, high temperature, best for complex tasks',
          config: {
            model: ClaudeModel.CLAUDE_4_OPUS,
            temperature: 0.9,
            maxTokens: 8192,
          },
        },
      ];

      const selected = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Select a configuration preset',
      });

      if (selected) {
        try {
          await configService.updateConfiguration(selected.config);
          vscode.window.showInformationMessage(
            'Configuration updated successfully',
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to update configuration: ${error}`,
          );
        }
      }
    },
  );

  // Add commands to subscriptions
  context.subscriptions.push(
    openSettingsCommand,
    resetSettingsCommand,
    exportConfigCommand,
    importConfigCommand,
    saveProfileCommand,
    loadProfileCommand,
    deleteProfileCommand,
    quickConfigureCommand,
  );
}
