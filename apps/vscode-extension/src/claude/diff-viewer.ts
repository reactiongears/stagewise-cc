import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import type { FileDiff, DiffPreview } from './diff-types';
import { DiffFormatter } from './diff-formatter';

/**
 * Integrates diff display with VSCode's diff viewer
 */
export class DiffViewer {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private formatter: DiffFormatter;
  private decorationType: vscode.TextEditorDecorationType;
  private tempDirectory: string;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.outputChannel =
      vscode.window.createOutputChannel('Claude Diff Viewer');
    this.logger = new Logger(this.outputChannel);
    this.formatter = new DiffFormatter();

    // Create decoration type for highlighting changes
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });

    // Set temp directory for diff files
    this.tempDirectory = path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      '.stagewise-cc',
      'diff-temp',
    );
  }

  /**
   * Show diff for a single file
   */
  async showDiff(fileDiff: FileDiff): Promise<void> {
    try {
      const originalUri = await this.createTempFile(
        fileDiff.originalContent || '',
        `original_${path.basename(fileDiff.path)}`,
      );

      const modifiedUri = await this.createTempFile(
        fileDiff.modifiedContent || '',
        `modified_${path.basename(fileDiff.path)}`,
      );

      // Open diff editor
      await this.openDiffEditor(
        originalUri,
        modifiedUri,
        `${path.basename(fileDiff.path)} - Claude Changes`,
      );

      // Add decorations
      await this.addDiffDecorations(fileDiff);
    } catch (error) {
      this.logger.error('Failed to show diff', error);
      vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
    }
  }

  /**
   * Show multi-file diff with navigation
   */
  async showMultiFileDiff(preview: DiffPreview): Promise<void> {
    // Create a custom view for multi-file diff
    const panel = vscode.window.createWebviewPanel(
      'claudeDiffPreview',
      'Claude Code Changes',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Generate HTML content
    panel.webview.html = this.generateMultiFileDiffHTML(preview, panel.webview);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'showFile':
            const fileDiff = preview.fileOperations.find(
              (fd) => fd.path === message.path,
            );
            if (fileDiff) {
              await this.showDiff(fileDiff);
            }
            break;

          case 'applyChanges':
            await this.applySelectedChanges(preview, message.selectedFiles);
            break;

          case 'exportDiff':
            await this.exportDiff(preview);
            break;
        }
      },
      undefined,
      this.disposables,
    );

    this.disposables.push(panel);
  }

  /**
   * Create a temporary document for diff display
   */
  async createDiffDocument(
    content: string,
    uri: vscode.Uri,
  ): Promise<vscode.TextDocument> {
    // This is handled by the content provider in the actual implementation
    // For now, we'll use the temporary file approach
    return await vscode.workspace.openTextDocument(uri);
  }

  /**
   * Open VSCode diff editor
   */
  async openDiffEditor(
    left: vscode.Uri,
    right: vscode.Uri,
    title: string,
  ): Promise<void> {
    await vscode.commands.executeCommand('vscode.diff', left, right, title, {
      preview: true,
      preserveFocus: false,
    });
  }

  /**
   * Generate HTML for multi-file diff view
   */
  private generateMultiFileDiffHTML(
    preview: DiffPreview,
    webview: vscode.Webview,
  ): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.getExtensionUri(), 'media', 'diff-viewer.css'),
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.getExtensionUri(), 'media', 'diff-viewer.js'),
    );

    const summary = this.formatter.formatSummary(preview);
    const summaryHtml = this.convertSummaryToHTML(summary);

    let fileListHtml = '';
    for (const fileDiff of preview.fileOperations) {
      const icon = this.getFileIcon(fileDiff.path);
      const changeType = this.getChangeTypeLabel(fileDiff.operation.type);

      fileListHtml += `
        <div class="file-item" data-path="${fileDiff.path}">
          <input type="checkbox" class="file-checkbox" checked>
          <span class="file-icon">${icon}</span>
          <span class="file-path">${fileDiff.path}</span>
          <span class="change-type ${fileDiff.operation.type}">${changeType}</span>
          <span class="file-stats">
            <span class="additions">+${fileDiff.stats.additions}</span>
            <span class="deletions">-${fileDiff.stats.deletions}</span>
          </span>
          <button class="view-diff-btn" onclick="viewDiff('${fileDiff.path}')">View Diff</button>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Claude Code Changes</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
          
          .summary {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 20px;
            margin-bottom: 20px;
          }
          
          .summary h2 {
            margin-top: 0;
            color: var(--vscode-foreground);
          }
          
          .stats {
            display: flex;
            gap: 20px;
            margin: 10px 0;
          }
          
          .stat-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 10px;
            background: var(--vscode-button-secondaryBackground);
            border-radius: 4px;
          }
          
          .stat-value {
            font-size: 24px;
            font-weight: bold;
          }
          
          .stat-label {
            font-size: 12px;
            opacity: 0.8;
          }
          
          .file-list {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
          }
          
          .file-item {
            display: flex;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 10px;
          }
          
          .file-item:last-child {
            border-bottom: none;
          }
          
          .file-checkbox {
            flex-shrink: 0;
          }
          
          .file-icon {
            flex-shrink: 0;
            width: 20px;
          }
          
          .file-path {
            flex-grow: 1;
            font-family: monospace;
          }
          
          .change-type {
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
          }
          
          .change-type.create {
            background: #28a745;
            color: white;
          }
          
          .change-type.update {
            background: #ffc107;
            color: black;
          }
          
          .change-type.delete {
            background: #dc3545;
            color: white;
          }
          
          .file-stats {
            font-family: monospace;
            font-size: 12px;
          }
          
          .additions {
            color: #28a745;
          }
          
          .deletions {
            color: #dc3545;
          }
          
          .view-diff-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
          }
          
          .view-diff-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
          }
          
          .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }
          
          .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          
          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          
          .risk-low { color: #28a745; }
          .risk-medium { color: #ffc107; }
          .risk-high { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Claude Code Changes</h1>
          
          <div class="summary">
            ${summaryHtml}
          </div>
          
          <div class="file-list">
            <h3>Files to Change</h3>
            ${fileListHtml}
          </div>
          
          <div class="actions">
            <button class="btn btn-primary" onclick="applyChanges()">Apply Selected Changes</button>
            <button class="btn btn-secondary" onclick="selectAll()">Select All</button>
            <button class="btn btn-secondary" onclick="deselectAll()">Deselect All</button>
            <button class="btn btn-secondary" onclick="exportDiff()">Export as Patch</button>
          </div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function viewDiff(path) {
            vscode.postMessage({
              command: 'showFile',
              path: path
            });
          }
          
          function applyChanges() {
            const selectedFiles = [];
            document.querySelectorAll('.file-checkbox:checked').forEach(checkbox => {
              const path = checkbox.closest('.file-item').dataset.path;
              selectedFiles.push(path);
            });
            
            vscode.postMessage({
              command: 'applyChanges',
              selectedFiles: selectedFiles
            });
          }
          
          function selectAll() {
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = true);
          }
          
          function deselectAll() {
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
          }
          
          function exportDiff() {
            vscode.postMessage({ command: 'exportDiff' });
          }
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Convert summary text to HTML
   */
  private convertSummaryToHTML(summary: string): string {
    // Convert the text summary to HTML with proper styling
    const lines = summary.split('\n');
    let html = '';

    for (const line of lines) {
      if (line.includes('Overview:')) {
        html += '<h3>Overview</h3>';
      } else if (line.includes('Statistics:')) {
        html += '<h3>Statistics</h3>';
      } else if (line.includes('Risk Assessment:')) {
        html += '<h3>Risk Assessment</h3>';
      } else if (line.trim()) {
        // Parse risk level
        if (line.includes('Risk level:')) {
          const riskMatch = line.match(/Risk level: .* (Low|Medium|High)/);
          if (riskMatch) {
            const riskClass = `risk-${riskMatch[1].toLowerCase()}`;
            html += `<p class="${riskClass}">${line}</p>`;
          } else {
            html += `<p>${line}</p>`;
          }
        } else {
          html += `<p>${line}</p>`;
        }
      }
    }

    return html;
  }

  /**
   * Add decorations to highlight changes in diff view
   */
  private async addDiffDecorations(fileDiff: FileDiff): Promise<void> {
    const editors = vscode.window.visibleTextEditors;

    for (const editor of editors) {
      if (editor.document.uri.path.includes(path.basename(fileDiff.path))) {
        const addDecorations: vscode.DecorationOptions[] = [];
        const deleteDecorations: vscode.DecorationOptions[] = [];

        for (const hunk of fileDiff.hunks) {
          for (const change of hunk.changes) {
            const line = change.lineNumber - 1; // VSCode uses 0-based line numbers

            if (change.type === 'add') {
              addDecorations.push({
                range: new vscode.Range(line, 0, line, Number.MAX_VALUE),
                hoverMessage: 'Added line',
              });
            } else if (change.type === 'delete') {
              deleteDecorations.push({
                range: new vscode.Range(line, 0, line, Number.MAX_VALUE),
                hoverMessage: 'Deleted line',
              });
            }
          }
        }

        // Apply decorations
        editor.setDecorations(
          vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(0, 255, 0, 0.2)',
            isWholeLine: true,
          }),
          addDecorations,
        );

        editor.setDecorations(
          vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.2)',
            isWholeLine: true,
          }),
          deleteDecorations,
        );
      }
    }
  }

  /**
   * Create temporary file for diff
   */
  private async createTempFile(
    content: string,
    fileName: string,
  ): Promise<vscode.Uri> {
    const tempUri = vscode.Uri.joinPath(
      vscode.Uri.file(this.tempDirectory),
      fileName,
    );

    // Ensure directory exists
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(this.tempDirectory),
    );

    // Write content
    await vscode.workspace.fs.writeFile(
      tempUri,
      new TextEncoder().encode(content),
    );

    return tempUri;
  }

  /**
   * Get extension URI
   */
  private getExtensionUri(): vscode.Uri {
    // This would be properly implemented to get the actual extension URI
    return vscode.Uri.file('');
  }

  /**
   * Get file icon based on extension
   */
  private getFileIcon(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const iconMap: Record<string, string> = {
      '.ts': '📘',
      '.tsx': '📘',
      '.js': '📙',
      '.jsx': '📙',
      '.json': '📋',
      '.css': '🎨',
      '.scss': '🎨',
      '.html': '🌐',
      '.md': '📝',
      '.py': '🐍',
      '.java': '☕',
      '.go': '🐹',
      '.rs': '🦀',
    };

    return iconMap[ext] || '📄';
  }

  /**
   * Get change type label
   */
  private getChangeTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      create: 'CREATE',
      update: 'UPDATE',
      delete: 'DELETE',
      move: 'MOVE',
      append: 'APPEND',
    };

    return labels[type] || type.toUpperCase();
  }

  /**
   * Apply selected changes
   */
  private async applySelectedChanges(
    preview: DiffPreview,
    selectedFiles: string[],
  ): Promise<void> {
    const selectedOperations = preview.fileOperations
      .filter((fd) => selectedFiles.includes(fd.path))
      .map((fd) => fd.operation);

    if (selectedOperations.length === 0) {
      vscode.window.showInformationMessage('No files selected');
      return;
    }

    // This would integrate with the file modification service
    vscode.window.showInformationMessage(
      `Applying ${selectedOperations.length} file operations...`,
    );
  }

  /**
   * Export diff as patch file
   */
  private async exportDiff(preview: DiffPreview): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('claude-changes.patch'),
      filters: {
        'Patch files': ['patch'],
        'All files': ['*'],
      },
    });

    if (!saveUri) return;

    // Generate unified diff
    let patchContent = '';
    for (const fileDiff of preview.fileOperations) {
      patchContent += this.formatter.formatUnified(fileDiff);
      patchContent += '\n';
    }

    await vscode.workspace.fs.writeFile(
      saveUri,
      new TextEncoder().encode(patchContent),
    );

    vscode.window.showInformationMessage(`Diff exported to ${saveUri.fsPath}`);
  }

  /**
   * Register commands for diff viewer
   */
  registerCommands(context: vscode.ExtensionContext): void {
    // Navigate between changes
    context.subscriptions.push(
      vscode.commands.registerCommand('stagewise-cc.diff.nextChange', () => {
        this.navigateToChange('next');
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'stagewise-cc.diff.previousChange',
        () => {
          this.navigateToChange('previous');
        },
      ),
    );

    // Toggle change selection
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'stagewise-cc.diff.toggleSelection',
        () => {
          this.toggleChangeSelection();
        },
      ),
    );
  }

  /**
   * Navigate to next/previous change
   */
  private navigateToChange(direction: 'next' | 'previous'): void {
    // Implementation would navigate through diff hunks
    this.logger.debug(`Navigating to ${direction} change`);
  }

  /**
   * Toggle selection of current change
   */
  private toggleChangeSelection(): void {
    // Implementation would toggle checkbox in multi-file view
    this.logger.debug('Toggling change selection');
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Clean up temporary files
    vscode.workspace.fs.delete(vscode.Uri.file(this.tempDirectory), {
      recursive: true,
    });

    // Dispose of decorations
    this.decorationType.dispose();

    // Dispose of other resources
    this.disposables.forEach((d) => d.dispose());
    this.outputChannel.dispose();
    this.formatter.dispose();
  }
}
