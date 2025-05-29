import * as vscode from 'vscode';
import { Logger } from '../logger';
import { ClaudeCodeCLIDetector } from './cli-detector';
import { CLIInstallationGuide } from './installation-guide';
import { CLIConfigStorage } from './cli-config-storage';
import type { SetupResult } from './cli-types';

/**
 * Interactive CLI setup assistant
 */
export class CLISetupAssistant {
  private readonly logger = new Logger('CLISetupAssistant');
  private readonly detector = new ClaudeCodeCLIDetector();
  private readonly configStorage = new CLIConfigStorage();
  private webviewPanel: vscode.WebviewPanel | undefined;

  /**
   * Show setup assistant
   */
  async showSetup(context: vscode.ExtensionContext): Promise<SetupResult> {
    this.logger.info('Starting CLI setup assistant');

    // First, check if CLI is already configured
    const existingConfig = await this.configStorage.getConfig();
    if (existingConfig?.verified) {
      const useExisting = await vscode.window.showInformationMessage(
        `Claude CLI is already configured at: ${existingConfig.path}`,
        'Use Existing',
        'Reconfigure',
      );

      if (useExisting === 'Use Existing') {
        return {
          success: true,
          path: existingConfig.path,
          skipped: true,
        };
      }
    }

    // Try automatic detection first
    const detectionResult = await this.detector.detect();
    if (detectionResult.found && detectionResult.path) {
      const useDetected = await vscode.window.showInformationMessage(
        `Claude CLI detected at: ${detectionResult.path} (v${detectionResult.version})`,
        'Use This',
        'Browse...',
        'Install Guide',
      );

      switch (useDetected) {
        case 'Use This':
          await this.configStorage.saveConfig({
            path: detectionResult.path,
            detectedAt: new Date().toISOString(),
            version: detectionResult.version,
            verified: true,
          });
          return {
            success: true,
            path: detectionResult.path,
          };
        case 'Browse...':
          return this.browseForCLI();
        case 'Install Guide':
          return this.showInstallationGuide(context);
      }
    }

    // CLI not found - show options
    const action = await vscode.window.showWarningMessage(
      'Claude CLI not found on your system',
      'Install Guide',
      'Browse...',
      'Skip',
    );

    switch (action) {
      case 'Install Guide':
        return this.showInstallationGuide(context);
      case 'Browse...':
        return this.browseForCLI();
      case 'Skip':
        return {
          success: false,
          skipped: true,
        };
      default:
        return {
          success: false,
          cancelled: true,
        };
    }
  }

  /**
   * Browse for CLI executable
   */
  private async browseForCLI(): Promise<SetupResult> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: 'Select Claude CLI Executable',
      filters: {
        Executables:
          process.platform === 'win32' ? ['exe', 'cmd', 'bat'] : ['*'],
      },
    });

    if (!result || result.length === 0) {
      return {
        success: false,
        cancelled: true,
      };
    }

    const selectedPath = result[0].fsPath;

    // Validate the selected file
    try {
      const validation = await this.detector.validate(selectedPath);
      if (!validation.isValid) {
        const retry = await vscode.window.showErrorMessage(
          'Selected file does not appear to be a valid Claude CLI executable',
          'Try Again',
          'Cancel',
        );

        if (retry === 'Try Again') {
          return this.browseForCLI();
        }

        return {
          success: false,
          error: 'Invalid CLI executable',
        };
      }

      // Get version
      const { stdout } = await require('node:util').promisify(
        require('node:child_process').exec,
      )(`"${selectedPath}" --version`);
      const version = stdout.trim();

      // Save configuration
      await this.configStorage.saveConfig({
        path: selectedPath,
        detectedAt: new Date().toISOString(),
        version,
        verified: true,
      });

      vscode.window.showInformationMessage(
        `Claude CLI configured successfully at: ${selectedPath}`,
      );

      return {
        success: true,
        path: selectedPath,
      };
    } catch (error) {
      this.logger.error('Failed to validate CLI', error);
      return {
        success: false,
        error: `Failed to validate CLI: ${error}`,
      };
    }
  }

  /**
   * Show installation guide in webview
   */
  private async showInstallationGuide(
    context: vscode.ExtensionContext,
  ): Promise<SetupResult> {
    // Create webview panel
    this.webviewPanel = vscode.window.createWebviewPanel(
      'claudeCLIInstallation',
      'Install Claude CLI',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Get installation guide
    const guide = CLIInstallationGuide.getGuidance();

    // Set webview content
    this.webviewPanel.webview.html = this.getWebviewContent(guide);

    // Handle messages from webview
    const result = await new Promise<SetupResult>((resolve) => {
      const disposable = this.webviewPanel!.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case 'verify': {
              const detection = await this.detector.detect();
              if (detection.found && detection.path) {
                await this.configStorage.saveConfig({
                  path: detection.path,
                  detectedAt: new Date().toISOString(),
                  version: detection.version,
                  verified: true,
                });

                this.webviewPanel!.webview.postMessage({
                  command: 'verificationResult',
                  success: true,
                  path: detection.path,
                  version: detection.version,
                });

                resolve({
                  success: true,
                  path: detection.path,
                });
              } else {
                this.webviewPanel!.webview.postMessage({
                  command: 'verificationResult',
                  success: false,
                  error: 'CLI not found after installation',
                });
              }
              break;
            }

            case 'browse': {
              const browseResult = await this.browseForCLI();
              if (browseResult.success) {
                resolve(browseResult);
              }
              break;
            }

            case 'skip':
              resolve({
                success: false,
                skipped: true,
              });
              break;

            case 'openExternal':
              vscode.env.openExternal(vscode.Uri.parse(message.url));
              break;
          }
        },
        undefined,
        context.subscriptions,
      );

      // Clean up on panel disposal
      this.webviewPanel!.onDidDispose(() => {
        disposable.dispose();
        resolve({
          success: false,
          cancelled: true,
        });
      });
    });

    // Dispose webview
    if (this.webviewPanel) {
      this.webviewPanel.dispose();
      this.webviewPanel = undefined;
    }

    return result;
  }

  /**
   * Get webview HTML content
   */
  private getWebviewContent(guide: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Install Claude CLI</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        
        h1 {
            color: var(--vscode-titleBar-activeForeground);
            border-bottom: 2px solid var(--vscode-titleBar-border);
            padding-bottom: 10px;
        }
        
        .section {
            margin: 20px 0;
            padding: 15px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
        }
        
        .steps {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 5px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow-x: auto;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            margin: 5px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .button-container {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .success {
            color: var(--vscode-testing-iconPassed);
            margin: 10px 0;
            padding: 10px;
            background-color: var(--vscode-diffEditor-insertedTextBackground);
            border-radius: 5px;
        }
        
        .error {
            color: var(--vscode-testing-iconFailed);
            margin: 10px 0;
            padding: 10px;
            background-color: var(--vscode-diffEditor-removedTextBackground);
            border-radius: 5px;
        }
        
        .link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
        }
        
        .link:hover {
            color: var(--vscode-textLink-activeForeground);
        }
        
        #verificationStatus {
            margin-top: 20px;
            padding: 15px;
            border-radius: 5px;
            display: none;
        }
        
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid var(--vscode-progressBar-background);
            border-radius: 50%;
            border-top-color: var(--vscode-focusBorder);
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <h1>${guide.title}</h1>
    
    <div class="section">
        <h2>Installation Steps</h2>
        <div class="steps">${guide.steps.join('\n')}</div>
    </div>
    
    <div class="section">
        <h2>Troubleshooting</h2>
        <div class="steps">${guide.troubleshooting.join('\n')}</div>
    </div>
    
    <div class="section">
        <h2>Download</h2>
        <p>
            <span class="link" onclick="openExternal('${guide.downloadUrl}')">
                Download Claude CLI from the official website
            </span>
        </p>
    </div>
    
    <div id="verificationStatus"></div>
    
    <div class="button-container">
        <button onclick="verifyInstallation()">Verify Installation</button>
        <button onclick="browseForCLI()">Browse for CLI...</button>
        <button onclick="skip()">Skip Setup</button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function openExternal(url) {
            vscode.postMessage({
                command: 'openExternal',
                url: url
            });
        }
        
        function verifyInstallation() {
            const statusEl = document.getElementById('verificationStatus');
            statusEl.style.display = 'block';
            statusEl.className = '';
            statusEl.innerHTML = '<div class="spinner"></div> Verifying CLI installation...';
            
            vscode.postMessage({ command: 'verify' });
        }
        
        function browseForCLI() {
            vscode.postMessage({ command: 'browse' });
        }
        
        function skip() {
            vscode.postMessage({ command: 'skip' });
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'verificationResult') {
                const statusEl = document.getElementById('verificationStatus');
                
                if (message.success) {
                    statusEl.className = 'success';
                    statusEl.innerHTML = \`
                        ✓ Claude CLI successfully configured!<br>
                        Path: \${message.path}<br>
                        Version: \${message.version}
                    \`;
                    
                    // Close panel after short delay
                    setTimeout(() => {
                        window.close();
                    }, 2000);
                } else {
                    statusEl.className = 'error';
                    statusEl.innerHTML = \`
                        ✗ \${message.error || 'CLI verification failed'}<br>
                        Please follow the installation steps above and try again.
                    \`;
                }
            }
        });
    </script>
</body>
</html>`;
  }

  /**
   * Quick setup with automatic detection
   */
  async quickSetup(): Promise<SetupResult> {
    this.logger.info('Running quick CLI setup');

    const detection = await this.detector.detect();
    if (detection.found && detection.path) {
      await this.configStorage.saveConfig({
        path: detection.path,
        detectedAt: new Date().toISOString(),
        version: detection.version,
        verified: true,
      });

      return {
        success: true,
        path: detection.path,
      };
    }

    return {
      success: false,
      error: detection.error?.message || 'CLI not found',
    };
  }
}
