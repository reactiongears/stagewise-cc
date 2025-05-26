import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { FileOperation, OperationType, RiskLevel } from './code-extractor';
import { BackupManager } from './backup-manager';
import { PermissionChecker, PermissionResult } from './permission-checker';
import { WorkspaceManager } from './workspace-manager';
import { AtomicOperationsManager } from './atomic-operations';

/**
 * Legacy transaction interface for backward compatibility
 */
interface Transaction {
  id: string;
  operations: FileOperation[];
  backups: Map<string, string>;
  completed: Set<string>;
  failed: Set<string>;
  startTime: Date;
}

/**
 * Result of a file operation
 */
export interface OperationResult {
  operationId: string;
  success: boolean;
  filePath: string;
  operation: OperationType;
  error?: string;
  backup?: string;
  changes?: {
    added: number;
    removed: number;
    modified: number;
  };
}


/**
 * Handles file modifications in VSCode workspace
 */
export class FileModificationService {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private backupManager: BackupManager;
  private permissionChecker: PermissionChecker;
  private workspaceManager: WorkspaceManager;
  private atomicOperations: AtomicOperationsManager;
  private activeTransaction: Transaction | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude File Modifications');
    this.logger = new Logger(this.outputChannel);
    this.backupManager = new BackupManager();
    this.permissionChecker = new PermissionChecker();
    this.workspaceManager = new WorkspaceManager();
    this.atomicOperations = new AtomicOperationsManager(this.backupManager);
  }

  /**
   * Apply multiple file operations atomically
   */
  async applyOperations(operations: FileOperation[]): Promise<OperationResult[]> {
    // Use atomic operations manager for better transaction support
    const result = await this.atomicOperations.executeAtomic(operations, {
      validateBeforeApply: true,
      createBackups: true
    });

    if (!result.success) {
      throw result.error || new Error('Atomic operation failed');
    }

    // Convert to OperationResult format
    return result.results.map((r, index) => ({
      operationId: operations[index].id,
      success: r.success,
      filePath: operations[index].targetPath,
      operation: operations[index].type,
      error: r.error?.message
    }));
  }

  /**
   * Apply multiple file operations with legacy transaction handling
   */
  private async applyOperationsLegacy(operations: FileOperation[]): Promise<OperationResult[]> {
    if (operations.length === 0) {
      return [];
    }

    this.logger.info(`Starting atomic operation batch with ${operations.length} operations`);

    // Start transaction
    const transaction = this.startTransaction(operations);
    const results: OperationResult[] = [];

    try {
      // Validate permissions for all operations
      const permissionResult = await this.validatePermissions(operations);
      if (!permissionResult.allPermitted) {
        throw new Error(`Permission denied: ${permissionResult.deniedReasons.join(', ')}`);
      }

      // Create backups for all affected files
      await this.createBackups(transaction, operations);

      // Apply operations in order
      for (const operation of operations) {
        const result = await this.applyOperation(operation, transaction);
        results.push(result);

        if (!result.success) {
          throw new Error(`Operation failed: ${result.error}`);
        }
      }

      // Commit transaction
      await this.commitTransaction(transaction);
      this.logger.info('All operations completed successfully');

      return results;
    } catch (error) {
      // Rollback on any failure
      this.logger.error('Operation batch failed, initiating rollback', error);
      await this.rollbackTransaction(transaction);
      
      // Mark all uncompleted operations as failed
      for (const operation of operations) {
        if (!transaction.completed.has(operation.id)) {
          results.push({
            operationId: operation.id,
            success: false,
            filePath: operation.targetPath,
            operation: operation.type,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      throw error;
    } finally {
      this.activeTransaction = null;
    }
  }

  /**
   * Create a new file
   */
  async createFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);

    // Check if file already exists
    try {
      await vscode.workspace.fs.stat(uri);
      throw new Error(`File already exists: ${path}`);
    } catch (error) {
      // File doesn't exist, which is what we want
      if ((error as any).code !== 'FileNotFound' && !(error as any).message?.includes('ENOENT')) {
        throw error;
      }
    }

    // Ensure directory exists
    const dirPath = this.getDirectoryPath(path);
    await this.workspaceManager.ensureDirectoryExists(dirPath);

    // Create file
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

    // Open in editor
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    this.logger.info(`Created file: ${path}`);
  }

  /**
   * Update an existing file
   */
  async updateFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);

    // Check if file exists
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      throw new Error(`File not found: ${path}`);
    }

    // Try to use workspace edit for better integration
    const edit = new vscode.WorkspaceEdit();
    
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        document.lineAt(0).range.start,
        document.lineAt(document.lineCount - 1).range.end
      );
      edit.replace(uri, fullRange, content);
      
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        throw new Error('Failed to apply workspace edit');
      }

      // Save the document
      if (document.isDirty) {
        await document.save();
      }
    } catch (error) {
      // Fallback to direct file write
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    }

    this.logger.info(`Updated file: ${path}`);
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    const uri = vscode.Uri.file(path);

    // Check if file exists
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      throw new Error(`File not found: ${path}`);
    }

    // Delete file
    await vscode.workspace.fs.delete(uri);

    this.logger.info(`Deleted file: ${path}`);
  }

  /**
   * Validate permissions for operations
   */
  async validatePermissions(operations: FileOperation[]): Promise<PermissionResult> {
    return await this.permissionChecker.validateOperations(operations);
  }

  /**
   * Start a new transaction
   */
  private startTransaction(operations: FileOperation[]): Transaction {
    const transaction: Transaction = {
      id: this.generateTransactionId(),
      operations,
      backups: new Map(),
      completed: new Set(),
      failed: new Set(),
      startTime: new Date()
    };

    this.activeTransaction = transaction;
    return transaction;
  }

  /**
   * Apply a single operation
   */
  private async applyOperation(operation: FileOperation, transaction: Transaction): Promise<OperationResult> {
    try {
      this.logger.debug(`Applying ${operation.type} operation to ${operation.targetPath}`);

      switch (operation.type) {
        case OperationType.CREATE:
          await this.createFile(operation.targetPath, operation.content || '');
          break;

        case OperationType.UPDATE:
          await this.updateFile(operation.targetPath, operation.content || '');
          break;

        case OperationType.DELETE:
          await this.deleteFile(operation.targetPath);
          break;

        case OperationType.MOVE:
          await this.moveFile(operation.sourcePath || operation.targetPath, operation.targetPath);
          break;

        case OperationType.APPEND:
          await this.appendToFile(operation.targetPath, operation.content || '');
          break;

        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }

      transaction.completed.add(operation.id);

      return {
        operationId: operation.id,
        success: true,
        filePath: operation.targetPath,
        operation: operation.type,
        backup: transaction.backups.get(operation.targetPath)
      };
    } catch (error) {
      transaction.failed.add(operation.id);
      
      return {
        operationId: operation.id,
        success: false,
        filePath: operation.targetPath,
        operation: operation.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create backups for all affected files
   */
  private async createBackups(transaction: Transaction, operations: FileOperation[]): Promise<void> {
    const filesToBackup = new Set<string>();

    for (const operation of operations) {
      if (operation.type === OperationType.UPDATE || 
          operation.type === OperationType.DELETE ||
          operation.type === OperationType.APPEND) {
        filesToBackup.add(operation.targetPath);
      }
      if (operation.type === OperationType.MOVE && operation.sourcePath) {
        filesToBackup.add(operation.sourcePath);
      }
    }

    for (const filePath of filesToBackup) {
      try {
        const backupId = await this.backupManager.createBackup(filePath);
        transaction.backups.set(filePath, backupId);
        this.logger.debug(`Created backup for ${filePath}: ${backupId}`);
      } catch (error) {
        this.logger.warning(`Failed to create backup for ${filePath}: ${error}`);
        // Don't fail if backup creation fails for non-existent files
      }
    }
  }

  /**
   * Commit transaction (cleanup backups after success)
   */
  private async commitTransaction(transaction: Transaction): Promise<void> {
    // Optionally clean up old backups
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep backups for 7 days
    await this.backupManager.cleanupBackups(cutoffDate);

    this.logger.info(`Transaction ${transaction.id} committed successfully`);
  }

  /**
   * Rollback transaction
   */
  private async rollbackTransaction(transaction: Transaction): Promise<void> {
    this.logger.info(`Rolling back transaction ${transaction.id}`);

    // Restore backups in reverse order
    const backupEntries = Array.from(transaction.backups.entries()).reverse();
    
    for (const [filePath, backupId] of backupEntries) {
      try {
        await this.backupManager.restoreBackup(backupId);
        this.logger.info(`Restored backup for ${filePath}`);
      } catch (error) {
        this.logger.error(`Failed to restore backup for ${filePath}`, error);
      }
    }

    // Clean up any created files
    for (const operation of transaction.operations) {
      if (operation.type === OperationType.CREATE && transaction.completed.has(operation.id)) {
        try {
          await this.deleteFile(operation.targetPath);
          this.logger.info(`Cleaned up created file: ${operation.targetPath}`);
        } catch (error) {
          this.logger.error(`Failed to clean up file: ${operation.targetPath}`, error);
        }
      }
    }
  }

  /**
   * Move/rename a file
   */
  private async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    const sourceUri = vscode.Uri.file(sourcePath);
    const targetUri = vscode.Uri.file(targetPath);

    // Ensure target directory exists
    const targetDir = this.getDirectoryPath(targetPath);
    await this.workspaceManager.ensureDirectoryExists(targetDir);

    // Use workspace edit for better integration
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(sourceUri, targetUri);

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      throw new Error('Failed to move file');
    }

    this.logger.info(`Moved file from ${sourcePath} to ${targetPath}`);
  }

  /**
   * Append content to a file
   */
  private async appendToFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);

    try {
      // Read existing content
      const existingContent = await vscode.workspace.fs.readFile(uri);
      const decoder = new TextDecoder();
      const currentContent = decoder.decode(existingContent);

      // Append new content
      const newContent = currentContent + (currentContent.endsWith('\n') ? '' : '\n') + content;
      
      // Write back
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));

      this.logger.info(`Appended content to file: ${path}`);
    } catch (error) {
      throw new Error(`Failed to append to file ${path}: ${error}`);
    }
  }

  /**
   * Get directory path from file path
   */
  private getDirectoryPath(filePath: string): string {
    return path.dirname(filePath);
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Show progress notification
   */
  async withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true
    }, task);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
    this.backupManager.dispose();
    this.permissionChecker.dispose();
    this.workspaceManager.dispose();
  }
}