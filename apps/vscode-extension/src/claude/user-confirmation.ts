import * as vscode from 'vscode';
import { FileOperation, OperationType, RiskLevel } from './code-extractor';
import { DiffPreview, DiffSummary } from './diff-types';
import { DiffPreviewService } from './diff-preview';
import { Logger } from './logger';

/**
 * User decision for file operations
 */
export enum UserDecision {
  ACCEPT_ALL = 'accept-all',
  ACCEPT_SELECTED = 'accept-selected',
  REJECT = 'reject',
  CANCEL = 'cancel',
  VIEW_DIFF = 'view-diff'
}

/**
 * Configuration for user confirmation
 */
export interface ConfirmationConfig {
  alwaysShowDiff?: boolean;
  autoAcceptLowRisk?: boolean;
  showDetailedStats?: boolean;
  confirmDestructive?: boolean;
  enableQuickActions?: boolean;
}

/**
 * Result of user confirmation
 */
export interface ConfirmationResult {
  decision: UserDecision;
  selectedOperations?: string[];
  rememberChoice?: boolean;
  userFeedback?: string;
}

/**
 * Options for confirmation dialog
 */
interface ConfirmationOptions {
  title?: string;
  placeHolder?: string;
  canPickMany?: boolean;
  ignoreFocusOut?: boolean;
}

/**
 * Handles user confirmation for file operations
 */
export class UserConfirmationService {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private diffPreview: DiffPreviewService;
  private config: ConfirmationConfig;
  private rememberedChoices: Map<string, UserDecision> = new Map();

  constructor(config: ConfirmationConfig = {}) {
    this.outputChannel = vscode.window.createOutputChannel('Claude User Confirmation');
    this.logger = new Logger(this.outputChannel);
    this.diffPreview = new DiffPreviewService();
    this.config = {
      alwaysShowDiff: config.alwaysShowDiff ?? false,
      autoAcceptLowRisk: config.autoAcceptLowRisk ?? false,
      showDetailedStats: config.showDetailedStats ?? true,
      confirmDestructive: config.confirmDestructive ?? true,
      enableQuickActions: config.enableQuickActions ?? true
    };
  }

  /**
   * Request user confirmation for file operations
   */
  async requestConfirmation(
    operations: FileOperation[],
    preview?: DiffPreview
  ): Promise<ConfirmationResult> {
    // Check for auto-accept conditions
    const autoDecision = this.checkAutoAccept(operations, preview);
    if (autoDecision) {
      return autoDecision;
    }

    // Generate preview if not provided
    if (!preview) {
      preview = await this.diffPreview.generatePreview(operations);
    }

    // Check if we should show immediate diff
    if (this.config.alwaysShowDiff) {
      await this.showDiffPreview(preview);
    }

    // Show confirmation dialog
    return await this.showConfirmationDialog(operations, preview);
  }

  /**
   * Check if operations can be auto-accepted
   */
  private checkAutoAccept(
    operations: FileOperation[],
    preview?: DiffPreview
  ): ConfirmationResult | null {
    // Check remembered choices
    const operationKey = this.generateOperationKey(operations);
    const remembered = this.rememberedChoices.get(operationKey);
    if (remembered) {
      return {
        decision: remembered,
        selectedOperations: operations.map(op => op.id)
      };
    }

    // Check auto-accept for low risk
    if (this.config.autoAcceptLowRisk && preview) {
      const allLowRisk = operations.every(op => 
        op.risk === RiskLevel.LOW || 
        op.risk === undefined
      );
      
      if (allLowRisk && preview.summary.riskLevel === RiskLevel.LOW) {
        this.logger.info('Auto-accepting low-risk operations');
        return {
          decision: UserDecision.ACCEPT_ALL,
          selectedOperations: operations.map(op => op.id)
        };
      }
    }

    return null;
  }

  /**
   * Show confirmation dialog
   */
  private async showConfirmationDialog(
    operations: FileOperation[],
    preview: DiffPreview
  ): Promise<ConfirmationResult> {
    // Create quick pick items
    const items = this.createQuickPickItems(operations, preview);

    // Show quick pick
    const selection = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Review and select operations to apply',
      ignoreFocusOut: true,
      title: `Claude Code Changes (${operations.length} operations)`
    });

    if (!selection || selection.length === 0) {
      return { decision: UserDecision.CANCEL };
    }

    // Handle special actions
    const actionItem = selection.find(item => (item as any).isAction);
    if (actionItem) {
      return await this.handleAction((actionItem as any).action!, operations, preview);
    }

    // Get selected operations
    const selectedOps = selection
      .filter(item => (item as any).operationId)
      .map(item => (item as any).operationId as string);

    // Show final confirmation for destructive operations
    if (this.config.confirmDestructive) {
      const destructive = operations.filter(op => 
        op.type === OperationType.DELETE && 
        selectedOps.includes(op.id)
      );

      if (destructive.length > 0) {
        const confirm = await this.confirmDestructiveOperations(destructive);
        if (!confirm) {
          return { decision: UserDecision.CANCEL };
        }
      }
    }

    return {
      decision: selectedOps.length === operations.length 
        ? UserDecision.ACCEPT_ALL 
        : UserDecision.ACCEPT_SELECTED,
      selectedOperations: selectedOps
    };
  }

  /**
   * Create quick pick items for operations
   */
  private createQuickPickItems(
    operations: FileOperation[],
    preview: DiffPreview
  ): vscode.QuickPickItem[] {
    const items: vscode.QuickPickItem[] = [];

    // Add summary header
    items.push({
      label: '$(info) Summary',
      description: this.formatSummary(preview.summary),
      detail: preview.metadata.warnings?.join(' • '),
      alwaysShow: true
    });

    // Add separator
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    });

    // Add operations
    for (const operation of operations) {
      const fileDiff = preview.fileOperations.find(fd => fd.operation.id === operation.id);
      const icon = this.getOperationIcon(operation.type);
      const stats = fileDiff ? `+${fileDiff.stats.additions} -${fileDiff.stats.deletions}` : '';
      
      items.push({
        label: `${icon} ${vscode.workspace.asRelativePath(operation.targetPath)}`,
        description: `${operation.type} ${stats}`,
        detail: operation.metadata?.description,
        picked: true,
        // Store operation ID in custom property
        operationId: operation.id
      } as any);
    }

    // Add quick actions if enabled
    if (this.config.enableQuickActions) {
      items.push({
        label: '',
        kind: vscode.QuickPickItemKind.Separator
      });

      items.push({
        label: '$(eye) View Diff',
        description: 'Show detailed diff preview',
        alwaysShow: true,
        isAction: true,
        action: 'view-diff'
      } as any);

      items.push({
        label: '$(check-all) Accept All',
        description: 'Apply all operations',
        alwaysShow: true,
        isAction: true,
        action: 'accept-all'
      } as any);

      items.push({
        label: '$(close) Reject All',
        description: 'Cancel all operations',
        alwaysShow: true,
        isAction: true,
        action: 'reject'
      } as any);
    }

    return items;
  }

  /**
   * Handle special actions
   */
  private async handleAction(
    action: string,
    operations: FileOperation[],
    preview: DiffPreview
  ): Promise<ConfirmationResult> {
    switch (action) {
      case 'view-diff':
        await this.showDiffPreview(preview);
        // Show dialog again after viewing diff
        return this.showConfirmationDialog(operations, preview);
      
      case 'accept-all':
        return {
          decision: UserDecision.ACCEPT_ALL,
          selectedOperations: operations.map(op => op.id)
        };
      
      case 'reject':
        return { decision: UserDecision.REJECT };
      
      default:
        return { decision: UserDecision.CANCEL };
    }
  }

  /**
   * Show diff preview
   */
  private async showDiffPreview(preview: DiffPreview): Promise<void> {
    const result = await this.diffPreview.showPreview(preview);
    
    // Handle result if needed
    if (result.action === 'apply' && result.selectedOperations) {
      // This is handled by the caller
    }
  }

  /**
   * Confirm destructive operations
   */
  private async confirmDestructiveOperations(
    operations: FileOperation[]
  ): Promise<boolean> {
    const fileList = operations
      .map(op => `  • ${vscode.workspace.asRelativePath(op.targetPath)}`)
      .join('\n');

    const message = `You are about to delete ${operations.length} file(s):\n\n${fileList}\n\nThis action cannot be undone. Continue?`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Delete Files',
      'Cancel'
    );

    return choice === 'Delete Files';
  }

  /**
   * Show information message with actions
   */
  async showOperationResult(
    success: boolean,
    operationCount: number,
    details?: string
  ): Promise<void> {
    const message = success
      ? `✅ Successfully applied ${operationCount} operations`
      : `❌ Failed to apply operations`;

    const actions = success ? ['View Output'] : ['View Output', 'Report Issue'];
    
    const choice = await vscode.window.showInformationMessage(
      details ? `${message}\n${details}` : message,
      ...actions
    );

    if (choice === 'View Output') {
      this.logger.show();
    } else if (choice === 'Report Issue') {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/stagewise/claude-vscode/issues'));
    }
  }

  /**
   * Format summary for display
   */
  private formatSummary(summary: DiffSummary): string {
    const parts = [];
    
    if (summary.filesCreated > 0) {
      parts.push(`${summary.filesCreated} created`);
    }
    if (summary.filesModified > 0) {
      parts.push(`${summary.filesModified} modified`);
    }
    if (summary.filesDeleted > 0) {
      parts.push(`${summary.filesDeleted} deleted`);
    }

    if (this.config.showDetailedStats) {
      parts.push(`| +${summary.totalAdditions} -${summary.totalDeletions}`);
      parts.push(`| Risk: ${summary.riskLevel}`);
      parts.push(`| ~${summary.estimatedReviewTime}min review`);
    }

    return parts.join(' ');
  }

  /**
   * Get icon for operation type
   */
  private getOperationIcon(type: OperationType): string {
    switch (type) {
      case OperationType.CREATE:
        return '$(new-file)';
      case OperationType.UPDATE:
        return '$(edit)';
      case OperationType.APPEND:
        return '$(add)';
      case OperationType.DELETE:
        return '$(trash)';
      default:
        return '$(file)';
    }
  }

  /**
   * Generate key for operation set (for remembering choices)
   */
  private generateOperationKey(operations: FileOperation[]): string {
    const sorted = operations
      .map(op => `${op.type}:${op.targetPath}`)
      .sort()
      .join('|');
    
    const hash = sorted.split('').reduce((acc, char) => 
      ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0
    );
    return `op_${Math.abs(hash)}`;
  }

  /**
   * Remember user choice for similar operations
   */
  rememberChoice(operations: FileOperation[], decision: UserDecision): void {
    const key = this.generateOperationKey(operations);
    this.rememberedChoices.set(key, decision);
    
    // Limit cache size
    if (this.rememberedChoices.size > 100) {
      const firstKey = this.rememberedChoices.keys().next().value;
      if (firstKey) {
        this.rememberedChoices.delete(firstKey);
      }
    }
  }

  /**
   * Clear remembered choices
   */
  clearRememberedChoices(): void {
    this.rememberedChoices.clear();
    this.logger.info('Cleared remembered choices');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConfirmationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.diffPreview.dispose();
  }
}