import * as vscode from 'vscode';
import { type FileOperation, OperationType } from './code-extractor';
import type { BackupManager } from './backup-manager';
import { Logger } from './logger';

/**
 * Result of a file operation
 */
export interface OperationResult {
  operationId: string;
  success: boolean;
  message?: string;
  error?: Error;
}

/**
 * Represents a transaction for atomic file operations
 */
export interface Transaction {
  id: string;
  operations: FileOperation[];
  backups: Map<string, string>;
  appliedOperations: Set<string>;
  startTime: Date;
  status: 'pending' | 'in-progress' | 'committed' | 'rolled-back';
}

/**
 * Options for atomic operations
 */
export interface AtomicOperationOptions {
  validateBeforeApply?: boolean;
  createBackups?: boolean;
  dryRun?: boolean;
  timeout?: number;
}

/**
 * Result of an atomic operation
 */
export interface AtomicOperationResult {
  success: boolean;
  transaction: Transaction;
  results: OperationResult[];
  error?: Error;
  rollbackSuccessful?: boolean;
}

/**
 * Manages atomic file operations with transaction support
 */
export class AtomicOperationsManager {
  private logger: Logger;
  private backupManager: BackupManager;
  private activeTransactions: Map<string, Transaction> = new Map();
  private transactionTimeout = 60000; // 1 minute default

  constructor(backupManager: BackupManager) {
    const outputChannel = vscode.window.createOutputChannel(
      'Claude Atomic Operations',
    );
    this.logger = new Logger(outputChannel);
    this.backupManager = backupManager;
  }

  /**
   * Execute operations atomically with automatic rollback on failure
   */
  async executeAtomic(
    operations: FileOperation[],
    options: AtomicOperationOptions = {},
  ): Promise<AtomicOperationResult> {
    const transaction = this.createTransaction(operations);
    this.activeTransactions.set(transaction.id, transaction);

    try {
      // Start transaction
      transaction.status = 'in-progress';
      this.logger.info(
        `Starting atomic transaction ${transaction.id} with ${operations.length} operations`,
      );

      // Validate operations if requested
      if (options.validateBeforeApply) {
        await this.validateOperations(operations);
      }

      // Create backups if requested
      if (options.createBackups !== false) {
        await this.createTransactionBackups(transaction);
      }

      // Apply operations
      const results = await this.applyOperations(
        transaction,
        options.dryRun || false,
      );

      // Check if all operations succeeded
      const allSuccessful = results.every((r) => r.success);

      if (allSuccessful) {
        // Commit transaction
        await this.commitTransaction(transaction);

        return {
          success: true,
          transaction,
          results,
        };
      } else {
        // Rollback on partial failure
        throw new Error('One or more operations failed');
      }
    } catch (error) {
      // Rollback transaction
      this.logger.error(`Transaction ${transaction.id} failed`, error);

      const rollbackSuccessful = await this.rollbackTransaction(transaction);

      return {
        success: false,
        transaction,
        results: [],
        error: error instanceof Error ? error : new Error(String(error)),
        rollbackSuccessful,
      };
    } finally {
      // Clean up
      this.activeTransactions.delete(transaction.id);

      // Set timeout to clean up old backups
      if (options.createBackups !== false) {
        setTimeout(() => {
          this.cleanupTransactionBackups(transaction);
        }, this.transactionTimeout);
      }
    }
  }

  /**
   * Create a new transaction
   */
  private createTransaction(operations: FileOperation[]): Transaction {
    return {
      id: this.generateTransactionId(),
      operations,
      backups: new Map(),
      appliedOperations: new Set(),
      startTime: new Date(),
      status: 'pending',
    };
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Validate operations before applying
   */
  private async validateOperations(operations: FileOperation[]): Promise<void> {
    for (const operation of operations) {
      // Check if file exists for update/delete operations
      if (
        operation.type === OperationType.UPDATE ||
        operation.type === OperationType.DELETE ||
        operation.type === OperationType.APPEND
      ) {
        const uri = vscode.Uri.file(operation.targetPath);
        try {
          await vscode.workspace.fs.stat(uri);
        } catch (error) {
          throw new Error(
            `File not found for ${operation.type} operation: ${operation.targetPath}`,
          );
        }
      }

      // Check if file already exists for create operations
      if (operation.type === OperationType.CREATE) {
        const uri = vscode.Uri.file(operation.targetPath);
        try {
          await vscode.workspace.fs.stat(uri);
          throw new Error(
            `File already exists for CREATE operation: ${operation.targetPath}`,
          );
        } catch (error) {
          // File doesn't exist, which is expected
        }
      }

      // Validate content is provided for operations that need it
      if (
        (operation.type === OperationType.CREATE ||
          operation.type === OperationType.UPDATE ||
          operation.type === OperationType.APPEND) &&
        !operation.content
      ) {
        throw new Error(
          `No content provided for ${operation.type} operation: ${operation.targetPath}`,
        );
      }
    }
  }

  /**
   * Create backups for all files that will be modified
   */
  private async createTransactionBackups(
    transaction: Transaction,
  ): Promise<void> {
    for (const operation of transaction.operations) {
      if (
        operation.type === OperationType.UPDATE ||
        operation.type === OperationType.DELETE ||
        operation.type === OperationType.APPEND
      ) {
        try {
          const backupPath = await this.backupManager.createBackup(
            operation.targetPath,
          );
          transaction.backups.set(operation.targetPath, backupPath);
          this.logger.debug(
            `Created backup for ${operation.targetPath} at ${backupPath}`,
          );
        } catch (error) {
          // File doesn't exist, no backup needed
          this.logger.debug(
            `No backup needed for ${operation.targetPath} (file not found)`,
          );
        }
      }
    }
  }

  /**
   * Apply operations in transaction
   */
  private async applyOperations(
    transaction: Transaction,
    dryRun: boolean,
  ): Promise<OperationResult[]> {
    const results: OperationResult[] = [];

    for (const operation of transaction.operations) {
      try {
        if (dryRun) {
          // Simulate operation
          results.push({
            operationId: operation.id,
            success: true,
            message: `[DRY RUN] Would ${operation.type} ${operation.targetPath}`,
          });
          continue;
        }

        // Apply operation
        await this.applyOperation(operation);

        transaction.appliedOperations.add(operation.id);

        results.push({
          operationId: operation.id,
          success: true,
          message: `Successfully applied ${operation.type} to ${operation.targetPath}`,
        });
      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          message: `Failed to apply ${operation.type} to ${operation.targetPath}`,
        });

        // Stop on first failure
        throw error;
      }
    }

    return results;
  }

  /**
   * Apply a single operation
   */
  private async applyOperation(operation: FileOperation): Promise<void> {
    const uri = vscode.Uri.file(operation.targetPath);

    switch (operation.type) {
      case OperationType.CREATE:
      case OperationType.UPDATE:
        if (!operation.content) {
          throw new Error('No content provided for operation');
        }
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(operation.content, 'utf8'),
        );
        break;

      case OperationType.APPEND:
        if (!operation.content) {
          throw new Error('No content provided for append operation');
        }
        try {
          const existing = await vscode.workspace.fs.readFile(uri);
          const newContent = `${existing.toString()}\n${operation.content}`;
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(newContent, 'utf8'),
          );
        } catch (error) {
          // File doesn't exist, create it
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(operation.content, 'utf8'),
          );
        }
        break;

      case OperationType.DELETE:
        await vscode.workspace.fs.delete(uri);
        break;

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Commit transaction (cleanup backups, finalize)
   */
  private async commitTransaction(transaction: Transaction): Promise<void> {
    transaction.status = 'committed';
    this.logger.info(`Transaction ${transaction.id} committed successfully`);

    // Optionally keep backups for a while before cleanup
    // They will be cleaned up after timeout
  }

  /**
   * Rollback transaction
   */
  private async rollbackTransaction(
    transaction: Transaction,
  ): Promise<boolean> {
    this.logger.info(`Rolling back transaction ${transaction.id}`);

    let rollbackSuccessful = true;

    // Rollback applied operations in reverse order
    const appliedOps = Array.from(transaction.appliedOperations).reverse();

    for (const operationId of appliedOps) {
      const operation = transaction.operations.find(
        (op) => op.id === operationId,
      );
      if (!operation) continue;

      try {
        await this.rollbackOperation(operation, transaction);
        this.logger.debug(`Rolled back operation ${operationId}`);
      } catch (error) {
        this.logger.error(`Failed to rollback operation ${operationId}`, error);
        rollbackSuccessful = false;
      }
    }

    transaction.status = 'rolled-back';
    return rollbackSuccessful;
  }

  /**
   * Rollback a single operation
   */
  private async rollbackOperation(
    operation: FileOperation,
    transaction: Transaction,
  ): Promise<void> {
    const uri = vscode.Uri.file(operation.targetPath);

    switch (operation.type) {
      case OperationType.CREATE:
        // Delete the created file
        try {
          await vscode.workspace.fs.delete(uri);
        } catch (error) {
          // File might not exist if creation failed
        }
        break;

      case OperationType.UPDATE:
      case OperationType.APPEND:
      case OperationType.DELETE: {
        // Restore from backup
        const backupPath = transaction.backups.get(operation.targetPath);
        if (backupPath) {
          await this.backupManager.restoreBackup(backupPath);
        } else if (operation.type === OperationType.DELETE) {
          // If we deleted a file but have no backup, we can't restore it
          throw new Error(
            `Cannot restore deleted file ${operation.targetPath} - no backup found`,
          );
        }
        break;
      }
    }
  }

  /**
   * Clean up transaction backups
   */
  private async cleanupTransactionBackups(
    transaction: Transaction,
  ): Promise<void> {
    for (const [originalPath, backupPath] of transaction.backups) {
      try {
        // Backup will be cleaned up automatically by cleanup process
        this.logger.debug(`Cleaned up backup for ${originalPath}`);
      } catch (error) {
        this.logger.error(`Failed to clean up backup ${backupPath}`, error);
      }
    }
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions(): Transaction[] {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * Cancel an active transaction
   */
  async cancelTransaction(transactionId: string): Promise<boolean> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction || transaction.status !== 'in-progress') {
      return false;
    }

    return await this.rollbackTransaction(transaction);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Rollback any active transactions
    for (const transaction of this.activeTransactions.values()) {
      if (transaction.status === 'in-progress') {
        this.rollbackTransaction(transaction).catch((error) => {
          this.logger.error(
            `Failed to rollback transaction ${transaction.id} during disposal`,
            error,
          );
        });
      }
    }

    this.activeTransactions.clear();
  }
}
