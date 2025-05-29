import * as vscode from 'vscode';
import { Logger } from '../logger';
import type { SettingsManager } from './settings-manager';
import { ClaudeModel } from '../config-types';

/**
 * Provides interactive settings configuration UI
 */
export class SettingsUI {
  private readonly logger = new Logger('SettingsUI');
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Show settings panel
   */
  async showSettingsPanel(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'claudeSettings',
      'Claude Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );

    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleWebviewMessage(message);
      },
      undefined,
      this.context.subscriptions,
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Send current settings to webview
    await this.updateWebviewSettings();
  }

  /**
   * Show quick settings
   */
  async showQuickSettings(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
      {
        label: '$(symbol-method) Model',
        description: this.settingsManager.get<string>('model.name'),
        detail: 'Choose Claude model',
      },
      {
        label: '$(flame) Temperature',
        description: String(
          this.settingsManager.get<number>('model.temperature'),
        ),
        detail: 'Adjust response creativity (0-1)',
      },
      {
        label: '$(symbol-number) Max Tokens',
        description: String(
          this.settingsManager.get<number>('model.maxTokens'),
        ),
        detail: 'Maximum response length',
      },
      {
        label: '$(sync) Stream Responses',
        description: this.settingsManager.get<boolean>(
          'behavior.streamResponses',
        )
          ? 'On'
          : 'Off',
        detail: 'Show responses as they generate',
      },
      {
        label: '$(save) Auto Save',
        description: this.settingsManager.get<boolean>('behavior.autoSave')
          ? 'On'
          : 'Off',
        detail: 'Automatically save changes',
      },
      {
        label: '$(gear) Advanced Settings',
        description: 'Open full settings panel',
        detail: 'Configure all Claude settings',
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a setting to configure',
    });

    if (!selected) return;

    switch (selected.label) {
      case '$(symbol-method) Model':
        await this.showModelPicker();
        break;
      case '$(flame) Temperature':
        await this.showTemperatureInput();
        break;
      case '$(symbol-number) Max Tokens':
        await this.showMaxTokensInput();
        break;
      case '$(sync) Stream Responses':
        await this.toggleStreamResponses();
        break;
      case '$(save) Auto Save':
        await this.toggleAutoSave();
        break;
      case '$(gear) Advanced Settings':
        await this.showSettingsPanel();
        break;
    }
  }

  /**
   * Show setting prompt
   */
  async showSettingPrompt(setting: string): Promise<any> {
    switch (setting) {
      case 'api.key':
        return this.promptApiKey();
      case 'model.name':
        return this.showModelPicker();
      case 'model.temperature':
        return this.showTemperatureInput();
      case 'model.maxTokens':
        return this.showMaxTokensInput();
      default:
        return this.showGenericInput(setting);
    }
  }

  /**
   * Open settings file
   */
  async openSettingsFile(): Promise<void> {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:stagewise.claude',
    );
  }

  /**
   * Show settings import dialog
   */
  async importSettings(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Settings files': ['json'],
      },
      title: 'Import Claude Settings',
    });

    if (!fileUri || fileUri.length === 0) return;

    try {
      const content = await vscode.workspace.fs.readFile(fileUri[0]);
      await this.settingsManager.importSettings(
        Buffer.from(content).toString(),
      );
      vscode.window.showInformationMessage('Settings imported successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to import settings: ${error}`);
    }
  }

  /**
   * Show settings export dialog
   */
  async exportSettings(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('claude-settings.json'),
      filters: {
        'Settings files': ['json'],
      },
      title: 'Export Claude Settings',
    });

    if (!uri) return;

    try {
      const content = await this.settingsManager.exportSettings();
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
      vscode.window.showInformationMessage('Settings exported successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to export settings: ${error}`);
    }
  }

  /**
   * Handle webview messages
   */
  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateSetting':
        await this.settingsManager.set(message.key, message.value);
        break;
      case 'resetSetting':
        await this.settingsManager.reset(message.key);
        await this.updateWebviewSettings();
        break;
      case 'resetAll':
        await this.settingsManager.reset();
        await this.updateWebviewSettings();
        break;
      case 'importSettings':
        await this.importSettings();
        await this.updateWebviewSettings();
        break;
      case 'exportSettings':
        await this.exportSettings();
        break;
      case 'createProfile':
        await this.createProfile(message.name, message.description);
        break;
      case 'switchProfile':
        await this.settingsManager.switchProfile(message.profileId);
        await this.updateWebviewSettings();
        break;
      case 'deleteProfile':
        await this.settingsManager.deleteProfile(message.profileId);
        break;
    }
  }

  /**
   * Update webview with current settings
   */
  private async updateWebviewSettings(): Promise<void> {
    if (!this.panel) return;

    const settings = this.settingsManager.getAll();
    const profiles = this.settingsManager.getProfiles();

    await this.panel.webview.postMessage({
      command: 'updateSettings',
      settings,
      profiles,
    });
  }

  /**
   * Show model picker
   */
  private async showModelPicker(): Promise<void> {
    const models = Object.entries(ClaudeModel).map(([key, value]) => ({
      label: key.replace(/_/g, ' ').replace(/CLAUDE /g, 'Claude '),
      description: value,
      value,
    }));

    const selected = await vscode.window.showQuickPick(models, {
      placeHolder: 'Select Claude model',
    });

    if (selected) {
      await this.settingsManager.set('model.name', selected.value);
    }
  }

  /**
   * Show temperature input
   */
  private async showTemperatureInput(): Promise<void> {
    const current = this.settingsManager.get<number>('model.temperature');
    const value = await vscode.window.showInputBox({
      prompt: 'Enter temperature (0-1)',
      value: String(current),
      validateInput: (value) => {
        const num = Number.parseFloat(value);
        if (Number.isNaN(num) || num < 0 || num > 1) {
          return 'Temperature must be between 0 and 1';
        }
        return undefined;
      },
    });

    if (value !== undefined) {
      await this.settingsManager.set(
        'model.temperature',
        Number.parseFloat(value),
      );
    }
  }

  /**
   * Show max tokens input
   */
  private async showMaxTokensInput(): Promise<void> {
    const current = this.settingsManager.get<number>('model.maxTokens');
    const value = await vscode.window.showInputBox({
      prompt: 'Enter maximum tokens',
      value: String(current),
      validateInput: (value) => {
        const num = Number.parseInt(value, 10);
        if (Number.isNaN(num) || num < 1 || num > 200000) {
          return 'Max tokens must be between 1 and 200000';
        }
        return undefined;
      },
    });

    if (value !== undefined) {
      await this.settingsManager.set(
        'model.maxTokens',
        Number.parseInt(value, 10),
      );
    }
  }

  /**
   * Toggle stream responses
   */
  private async toggleStreamResponses(): Promise<void> {
    const current = this.settingsManager.get<boolean>(
      'behavior.streamResponses',
    );
    await this.settingsManager.set('behavior.streamResponses', !current);
  }

  /**
   * Toggle auto save
   */
  private async toggleAutoSave(): Promise<void> {
    const current = this.settingsManager.get<boolean>('behavior.autoSave');
    await this.settingsManager.set('behavior.autoSave', !current);
  }

  /**
   * Prompt for API key
   */
  private async promptApiKey(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'Enter Claude API key',
      password: true,
      placeHolder: 'sk-ant-...',
    });
  }

  /**
   * Show generic input
   */
  private async showGenericInput(setting: string): Promise<any> {
    const current = this.settingsManager.get(setting);
    const value = await vscode.window.showInputBox({
      prompt: `Enter value for ${setting}`,
      value: String(current),
    });

    if (value !== undefined) {
      await this.settingsManager.set(setting, value);
    }
  }

  /**
   * Create a new profile
   */
  private async createProfile(
    name?: string,
    description?: string,
  ): Promise<void> {
    let profileName = name;
    let profileDescription = description;

    if (!profileName) {
      profileName = await vscode.window.showInputBox({
        prompt: 'Enter profile name',
        placeHolder: 'My Profile',
      });
    }

    if (!profileName) return;

    if (!profileDescription) {
      profileDescription = await vscode.window.showInputBox({
        prompt: 'Enter profile description (optional)',
        placeHolder: 'Description of this profile',
      });
    }

    try {
      await this.settingsManager.createProfile(profileName, profileDescription);
      vscode.window.showInformationMessage(`Profile '${profileName}' created`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create profile: ${error}`);
    }
  }

  /**
   * Get webview content
   */
  private getWebviewContent(): string {
    return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Claude Settings</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
        }
        .section {
          margin-bottom: 30px;
          padding: 20px;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 5px;
        }
        .section h2 {
          margin-top: 0;
          color: var(--vscode-foreground);
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 10px;
        }
        .setting {
          margin-bottom: 15px;
        }
        .setting label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        .setting input, .setting select {
          width: 100%;
          padding: 5px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
        }
        .setting .description {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
          margin-top: 5px;
        }
        button {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          border-radius: 3px;
          cursor: pointer;
          margin-right: 10px;
        }
        button:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .actions {
          margin-top: 20px;
          text-align: right;
        }
        .profile-section {
          background: var(--vscode-sideBar-background);
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <h1>Claude Settings</h1>
      
      <div class="profile-section">
        <h3>Profiles</h3>
        <select id="profileSelect">
          <option value="">Default</option>
        </select>
        <button onclick="createProfile()">New Profile</button>
        <button onclick="deleteProfile()">Delete</button>
      </div>

      <div class="section">
        <h2>Model Configuration</h2>
        <div class="setting">
          <label for="modelName">Model</label>
          <select id="modelName" onchange="updateSetting('model.name', this.value)">
            <option value="claude-3-opus-20240229">Claude 3 Opus</option>
            <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
            <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
            <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
          </select>
          <div class="description">Choose the Claude model to use</div>
        </div>
        
        <div class="setting">
          <label for="temperature">Temperature</label>
          <input type="range" id="temperature" min="0" max="1" step="0.1" 
                 onchange="updateSetting('model.temperature', parseFloat(this.value))">
          <span id="temperatureValue">0.7</span>
          <div class="description">Controls randomness in responses (0 = focused, 1 = creative)</div>
        </div>
        
        <div class="setting">
          <label for="maxTokens">Max Tokens</label>
          <input type="number" id="maxTokens" min="1" max="200000" 
                 onchange="updateSetting('model.maxTokens', parseInt(this.value))">
          <div class="description">Maximum length of response</div>
        </div>
      </div>

      <div class="section">
        <h2>Behavior</h2>
        <div class="setting">
          <label>
            <input type="checkbox" id="streamResponses" 
                   onchange="updateSetting('behavior.streamResponses', this.checked)">
            Stream Responses
          </label>
          <div class="description">Show responses as they are generated</div>
        </div>
        
        <div class="setting">
          <label>
            <input type="checkbox" id="autoSave" 
                   onchange="updateSetting('behavior.autoSave', this.checked)">
            Auto Save
          </label>
          <div class="description">Automatically save changes</div>
        </div>
        
        <div class="setting">
          <label>
            <input type="checkbox" id="confirmBeforeApply" 
                   onchange="updateSetting('behavior.confirmBeforeApply', this.checked)">
            Confirm Before Apply
          </label>
          <div class="description">Ask for confirmation before applying changes</div>
        </div>
      </div>

      <div class="actions">
        <button onclick="resetAll()">Reset All</button>
        <button onclick="importSettings()">Import</button>
        <button onclick="exportSettings()">Export</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let currentSettings = {};
        let profiles = [];

        function updateSetting(key, value) {
          vscode.postMessage({ command: 'updateSetting', key, value });
        }

        function resetAll() {
          if (confirm('Reset all settings to defaults?')) {
            vscode.postMessage({ command: 'resetAll' });
          }
        }

        function importSettings() {
          vscode.postMessage({ command: 'importSettings' });
        }

        function exportSettings() {
          vscode.postMessage({ command: 'exportSettings' });
        }

        function createProfile() {
          const name = prompt('Enter profile name:');
          if (name) {
            vscode.postMessage({ command: 'createProfile', name });
          }
        }

        function deleteProfile() {
          const select = document.getElementById('profileSelect');
          if (select.value && confirm('Delete this profile?')) {
            vscode.postMessage({ command: 'deleteProfile', profileId: select.value });
          }
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.command === 'updateSettings') {
            currentSettings = message.settings;
            profiles = message.profiles || [];
            updateUI();
          }
        });

        function updateUI() {
          // Update model
          document.getElementById('modelName').value = currentSettings.model?.name || '';
          
          // Update temperature
          const temp = currentSettings.model?.temperature || 0.7;
          document.getElementById('temperature').value = temp;
          document.getElementById('temperatureValue').textContent = temp;
          
          // Update max tokens
          document.getElementById('maxTokens').value = currentSettings.model?.maxTokens || 4096;
          
          // Update behavior
          document.getElementById('streamResponses').checked = currentSettings.behavior?.streamResponses || false;
          document.getElementById('autoSave').checked = currentSettings.behavior?.autoSave || false;
          document.getElementById('confirmBeforeApply').checked = currentSettings.behavior?.confirmBeforeApply || false;
          
          // Update profiles
          const profileSelect = document.getElementById('profileSelect');
          profileSelect.innerHTML = '<option value="">Default</option>';
          profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            option.selected = profile.isActive;
            profileSelect.appendChild(option);
          });
        }

        // Temperature slider update
        document.getElementById('temperature').addEventListener('input', function() {
          document.getElementById('temperatureValue').textContent = this.value;
        });

        // Profile change
        document.getElementById('profileSelect').addEventListener('change', function() {
          if (this.value) {
            vscode.postMessage({ command: 'switchProfile', profileId: this.value });
          }
        });
      </script>
    </body>
    </html>`;
  }
}
