import * as vscode from 'vscode';
import { diffLines } from 'diff';
import { Logger } from './logger';
import { type FileOperation, OperationType, RiskLevel } from './code-extractor';
import type {
  DiffPreview,
  FileDiff,
  DiffHunk,
  DiffChange,
  DiffSummary,
  DiffMetadata,
  DiffStats,
  PreviewResult,
  DiffOptions,
  RiskAssessment,
  RiskFactor,
} from './diff-types';

/**
 * Generates and manages diff previews for file operations
 */
export class DiffPreviewService {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private currentPreview: DiffPreview | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      'Claude Diff Preview',
    );
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Generate a complete diff preview for multiple operations
   */
  async generatePreview(
    operations: FileOperation[],
    options?: DiffOptions,
  ): Promise<DiffPreview> {
    this.logger.info(
      `Generating diff preview for ${operations.length} operations`,
    );

    const fileOperations: FileDiff[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    // Generate diff for each operation
    for (const operation of operations) {
      try {
        const fileDiff = await this.createFileDiff(operation, options);
        fileOperations.push(fileDiff);
        totalAdditions += fileDiff.stats.additions;
        totalDeletions += fileDiff.stats.deletions;
      } catch (error) {
        this.logger.error(
          `Failed to create diff for ${operation.targetPath}`,
          error,
        );
      }
    }

    // Create summary
    const summary = this.createSummary(fileOperations, operations);

    // Generate metadata
    const metadata: DiffMetadata = {
      generatedAt: new Date(),
      generatedBy: 'Claude Code',
      warnings: this.generateWarnings(operations),
      suggestions: this.generateSuggestions(operations),
    };

    const preview: DiffPreview = {
      fileOperations,
      summary,
      metadata,
    };

    this.currentPreview = preview;
    return preview;
  }

  /**
   * Create diff for a single file operation
   */
  async createFileDiff(
    operation: FileOperation,
    options?: DiffOptions,
  ): Promise<FileDiff> {
    let originalContent = '';
    let modifiedContent = operation.content || '';

    // Get original content for update/delete operations
    if (
      operation.type === OperationType.UPDATE ||
      operation.type === OperationType.DELETE ||
      operation.type === OperationType.APPEND
    ) {
      try {
        const uri = vscode.Uri.file(operation.targetPath);
        const fileContent = await vscode.workspace.fs.readFile(uri);
        originalContent = new TextDecoder().decode(fileContent);

        if (operation.type === OperationType.APPEND) {
          modifiedContent = originalContent + '\n' + operation.content;
        } else if (operation.type === OperationType.DELETE) {
          modifiedContent = '';
        }
      } catch (error) {
        // File doesn't exist yet
        this.logger.debug(`Original file not found: ${operation.targetPath}`);
      }
    }

    // Generate hunks
    const hunks = this.generateHunks(originalContent, modifiedContent, options);

    // Calculate statistics
    const stats = this.calculateStats(hunks);

    const fileDiff: FileDiff = {
      path: operation.targetPath,
      operation,
      hunks,
      language: this.detectLanguage(operation.targetPath),
      originalContent,
      modifiedContent,
      stats,
    };

    return fileDiff;
  }

  /**
   * Show preview to user and get their decision
   */
  async showPreview(preview: DiffPreview): Promise<PreviewResult> {
    // Create a quick pick with all file operations
    const items = preview.fileOperations.map((fd) => ({
      label: `$(file) ${vscode.workspace.asRelativePath(fd.path)}`,
      description: `${fd.operation.type} - ${fd.stats.additions}+ ${fd.stats.deletions}-`,
      detail: fd.operation.metadata?.description,
      picked: true,
      operationId: fd.operation.id,
    }));

    // Add summary item at the top
    items.unshift({
      label: '$(info) Summary',
      description: `${preview.summary.totalFiles} files, ${preview.summary.totalAdditions}+ ${preview.summary.totalDeletions}-`,
      detail: `Risk: ${preview.summary.riskLevel}`,
      picked: false,
      operationId: '',
    });

    const selection = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select operations to apply',
      title: 'Review Claude Code Changes',
    });

    if (!selection) {
      return { action: 'cancel' };
    }

    // Filter out summary item
    const selectedOperations = selection
      .filter((item) => item.operationId !== '')
      .map((item) => item.operationId);

    if (selectedOperations.length === 0) {
      return { action: 'reject' };
    }

    // Show confirmation
    const confirmAction = await vscode.window.showWarningMessage(
      `Apply ${selectedOperations.length} file operations?`,
      { modal: true },
      'Apply',
      'View Diff',
      'Cancel',
    );

    if (confirmAction === 'Apply') {
      return {
        action: 'apply',
        selectedOperations,
      };
    } else if (confirmAction === 'View Diff') {
      // Show detailed diff view
      await this.showDetailedDiff(preview, selectedOperations[0]);
      return this.showPreview(preview); // Recursive call to show selection again
    }

    return { action: 'cancel' };
  }

  /**
   * Apply the previewed changes
   */
  async applyPreview(
    preview: DiffPreview,
    selectedOperations?: string[],
  ): Promise<void> {
    const operationsToApply = preview.fileOperations
      .map((fd) => fd.operation)
      .filter(
        (op) => !selectedOperations || selectedOperations.includes(op.id),
      );

    if (operationsToApply.length === 0) {
      vscode.window.showInformationMessage('No operations selected');
      return;
    }

    // This would integrate with FileModificationService
    this.logger.info(`Applying ${operationsToApply.length} operations`);
  }

  /**
   * Generate diff hunks using diff library
   */
  private generateHunks(
    original: string,
    modified: string,
    options?: DiffOptions,
  ): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const contextLines = options?.contextLines ?? 3;

    // Use diff library to get changes
    const changes = diffLines(original, modified, {
      ignoreWhitespace: options?.ignoreWhitespace,
    });

    let currentHunk: DiffHunk | null = null;
    let lineNumberOriginal = 1;
    let lineNumberModified = 1;

    for (const change of changes) {
      const lines = change.value.split('\n').filter((line) => line !== '');

      if (change.added || change.removed) {
        // Start new hunk if needed
        if (
          !currentHunk ||
          this.shouldStartNewHunk(currentHunk, lineNumberOriginal)
        ) {
          if (currentHunk) {
            hunks.push(currentHunk);
          }

          currentHunk = {
            startLine: Math.max(1, lineNumberOriginal - contextLines),
            endLine: lineNumberOriginal,
            additions: 0,
            deletions: 0,
            changes: [],
          };

          // Add context lines before change
          this.addContextLines(
            currentHunk,
            original,
            lineNumberOriginal - contextLines,
            contextLines,
          );
        }

        // Add changes to current hunk
        for (const line of lines) {
          const diffChange: DiffChange = {
            type: change.added ? 'add' : 'delete',
            lineNumber: change.added ? lineNumberModified : lineNumberOriginal,
            content: line,
            originalLine: change.removed ? lineNumberOriginal : undefined,
            modifiedLine: change.added ? lineNumberModified : undefined,
          };

          currentHunk.changes.push(diffChange);

          if (change.added) {
            currentHunk.additions++;
            lineNumberModified++;
          } else {
            currentHunk.deletions++;
            lineNumberOriginal++;
          }
        }

        currentHunk.endLine = lineNumberOriginal + contextLines;
      } else {
        // Context lines
        if (currentHunk && lineNumberOriginal <= currentHunk.endLine) {
          for (const line of lines) {
            currentHunk.changes.push({
              type: 'context',
              lineNumber: lineNumberOriginal,
              content: line,
              originalLine: lineNumberOriginal,
              modifiedLine: lineNumberModified,
            });
          }
        }

        lineNumberOriginal += lines.length;
        lineNumberModified += lines.length;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  /**
   * Determine if we should start a new hunk
   */
  private shouldStartNewHunk(
    currentHunk: DiffHunk,
    currentLine: number,
  ): boolean {
    const lastChange = currentHunk.changes[currentHunk.changes.length - 1];
    if (!lastChange) return true;

    const lineGap =
      currentLine - (lastChange.originalLine || lastChange.lineNumber);
    return lineGap > 6; // Start new hunk if more than 6 lines apart
  }

  /**
   * Add context lines to a hunk
   */
  private addContextLines(
    hunk: DiffHunk,
    content: string,
    startLine: number,
    count: number,
  ): void {
    const lines = content.split('\n');
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, start + count);

    for (let i = start; i < end; i++) {
      hunk.changes.push({
        type: 'context',
        lineNumber: i + 1,
        content: lines[i],
        originalLine: i + 1,
        modifiedLine: i + 1,
      });
    }
  }

  /**
   * Calculate statistics from hunks
   */
  private calculateStats(hunks: DiffHunk[]): DiffStats {
    let additions = 0;
    let deletions = 0;
    let modifications = 0;

    for (const hunk of hunks) {
      additions += hunk.additions;
      deletions += hunk.deletions;

      // Count modifications (lines that were both added and deleted)
      const minChanges = Math.min(hunk.additions, hunk.deletions);
      modifications += minChanges;
    }

    const totalChanges = additions + deletions;
    const percentageChanged =
      totalChanges > 0 ? (totalChanges / (totalChanges + 100)) * 100 : 0;

    return {
      additions,
      deletions,
      modifications,
      totalChanges,
      percentageChanged: Math.round(percentageChanged),
    };
  }

  /**
   * Create summary of all changes
   */
  private createSummary(
    fileDiffs: FileDiff[],
    operations: FileOperation[],
  ): DiffSummary {
    const summary: DiffSummary = {
      totalFiles: fileDiffs.length,
      filesCreated: operations.filter((op) => op.type === OperationType.CREATE)
        .length,
      filesModified: operations.filter(
        (op) =>
          op.type === OperationType.UPDATE || op.type === OperationType.APPEND,
      ).length,
      filesDeleted: operations.filter((op) => op.type === OperationType.DELETE)
        .length,
      totalAdditions: 0,
      totalDeletions: 0,
      riskLevel: RiskLevel.LOW,
      estimatedReviewTime: 0,
    };

    // Calculate totals
    for (const diff of fileDiffs) {
      summary.totalAdditions += diff.stats.additions;
      summary.totalDeletions += diff.stats.deletions;
    }

    // Assess risk
    const riskAssessment = this.assessRisk(operations);
    summary.riskLevel = riskAssessment.level;

    // Estimate review time (rough estimate: 30 seconds per 10 lines changed)
    const totalLines = summary.totalAdditions + summary.totalDeletions;
    summary.estimatedReviewTime = Math.ceil((totalLines / 10) * 0.5);

    return summary;
  }

  /**
   * Assess risk of operations
   */
  private assessRisk(operations: FileOperation[]): RiskAssessment {
    const factors: RiskFactor[] = [];
    let maxSeverity: RiskLevel = RiskLevel.LOW;

    // Check for critical files
    const criticalFiles = operations.filter(
      (op) =>
        op.targetPath.includes('package.json') ||
        op.targetPath.includes('tsconfig.json') ||
        op.targetPath.includes('.env'),
    );

    if (criticalFiles.length > 0) {
      factors.push({
        type: 'breaking-change',
        severity: 'high',
        description: 'Modifying critical configuration files',
        mitigation: 'Review changes carefully and test thoroughly',
      });
      maxSeverity = RiskLevel.HIGH;
    }

    // Check for deletions
    const deletions = operations.filter(
      (op) => op.type === OperationType.DELETE,
    );
    if (deletions.length > 0) {
      factors.push({
        type: 'breaking-change',
        severity: 'medium',
        description: `Deleting ${deletions.length} files`,
        mitigation: 'Ensure files are not needed elsewhere',
      });
      if (maxSeverity === RiskLevel.LOW) maxSeverity = RiskLevel.MEDIUM;
    }

    // Check for large changes
    const largeOperations = operations.filter(
      (op) => op.content && op.content.split('\n').length > 100,
    );

    if (largeOperations.length > 0) {
      factors.push({
        type: 'complexity',
        severity: 'medium',
        description: 'Large code changes detected',
        mitigation: 'Consider breaking into smaller changes',
      });
      if (maxSeverity === RiskLevel.LOW) maxSeverity = RiskLevel.MEDIUM;
    }

    return {
      level: maxSeverity,
      factors,
      recommendations: factors.map((f) => f.mitigation || ''),
      requiresReview: maxSeverity !== RiskLevel.LOW,
    };
  }

  /**
   * Generate warnings for operations
   */
  private generateWarnings(operations: FileOperation[]): string[] {
    const warnings: string[] = [];

    // Check for destructive operations
    const deleteOps = operations.filter(
      (op) => op.type === OperationType.DELETE,
    );
    if (deleteOps.length > 0) {
      warnings.push(`${deleteOps.length} files will be deleted`);
    }

    // Check for large files
    const largeOps = operations.filter(
      (op) => op.content && op.content.length > 100000,
    );
    if (largeOps.length > 0) {
      warnings.push(`${largeOps.length} large file operations detected`);
    }

    return warnings;
  }

  /**
   * Generate suggestions for operations
   */
  private generateSuggestions(operations: FileOperation[]): string[] {
    const suggestions: string[] = [];

    // Suggest testing
    if (
      operations.some(
        (op) =>
          op.targetPath.includes('.test.') || op.targetPath.includes('.spec.'),
      )
    ) {
      suggestions.push('Run tests after applying changes');
    }

    // Suggest commit
    if (operations.length > 5) {
      suggestions.push('Consider committing changes in smaller batches');
    }

    return suggestions;
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): string | undefined {
    const extension = filePath.split('.').pop()?.toLowerCase();

    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      css: 'css',
      scss: 'scss',
      html: 'html',
      xml: 'xml',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
    };

    return extension ? languageMap[extension] : undefined;
  }

  /**
   * Show detailed diff for a specific operation
   */
  private async showDetailedDiff(
    preview: DiffPreview,
    operationId: string,
  ): Promise<void> {
    const fileDiff = preview.fileOperations.find(
      (fd) => fd.operation.id === operationId,
    );
    if (!fileDiff) return;

    // Create temporary files for diff view
    const originalUri = vscode.Uri.parse(
      `claude-diff:original/${fileDiff.path}`,
    );
    const modifiedUri = vscode.Uri.parse(
      `claude-diff:modified/${fileDiff.path}`,
    );

    // Register content provider if not already done
    this.registerDiffContentProvider();

    // Open diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `${vscode.workspace.asRelativePath(fileDiff.path)} (Claude Changes)`,
      { preview: true },
    );
  }

  /**
   * Register content provider for diff URIs
   */
  private registerDiffContentProvider(): void {
    vscode.workspace.registerTextDocumentContentProvider('claude-diff', {
      provideTextDocumentContent: (uri: vscode.Uri) => {
        if (!this.currentPreview) return '';

        const path = uri.path.substring(uri.path.indexOf('/') + 1);
        const fileDiff = this.currentPreview.fileOperations.find(
          (fd) => fd.path === path,
        );

        if (!fileDiff) return '';

        if (uri.path.startsWith('original/')) {
          return fileDiff.originalContent || '';
        } else if (uri.path.startsWith('modified/')) {
          return fileDiff.modifiedContent || '';
        }

        return '';
      },
    });
  }

  /**
   * Export diff as patch file
   */
  async exportDiff(preview: DiffPreview, outputPath: string): Promise<void> {
    // Generate unified diff format
    let patchContent = '';

    for (const fileDiff of preview.fileOperations) {
      patchContent += this.generateUnifiedDiff(fileDiff);
      patchContent += '\n';
    }

    // Write to file
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(outputPath),
      new TextEncoder().encode(patchContent),
    );

    this.logger.info(`Exported diff to ${outputPath}`);
  }

  /**
   * Generate unified diff format for a file
   */
  private generateUnifiedDiff(fileDiff: FileDiff): string {
    const header = `--- a/${fileDiff.path}\n+++ b/${fileDiff.path}\n`;
    let diff = header;

    for (const hunk of fileDiff.hunks) {
      // Generate hunk header
      const oldStart = hunk.startLine;
      const oldLength = hunk.changes.filter((c) => c.type !== 'add').length;
      const newStart = hunk.startLine;
      const newLength = hunk.changes.filter((c) => c.type !== 'delete').length;

      diff += `@@ -${oldStart},${oldLength} +${newStart},${newLength} @@\n`;

      // Add changes
      for (const change of hunk.changes) {
        let prefix = ' ';
        if (change.type === 'add') prefix = '+';
        else if (change.type === 'delete') prefix = '-';

        diff += `${prefix}${change.content}\n`;
      }
    }

    return diff;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}
