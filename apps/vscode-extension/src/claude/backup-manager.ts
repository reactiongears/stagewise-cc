import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from './logger';

/**
 * Information about a backup
 */
export interface BackupInfo {
  id: string;
  originalPath: string;
  backupPath: string;
  timestamp: Date;
  size: number;
  operation: string;
  checksum?: string;
}

/**
 * Backup storage metadata
 */
interface BackupMetadata {
  backups: BackupInfo[];
  version: string;
}

/**
 * Manages file backups for safe rollback
 */
export class BackupManager {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private backupRoot: string | null = null;
  private metadata: BackupMetadata;
  private readonly BACKUP_DIR = '.stagewise-cc/backups';
  private readonly METADATA_FILE = 'backup-metadata.json';

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Backup Manager');
    this.logger = new Logger(this.outputChannel);
    this.metadata = { backups: [], version: '1.0.0' };
    this.initialize();
  }

  /**
   * Initialize backup directory and load metadata
   */
  private async initialize(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.logger.warning('No workspace folder found for backups');
      return;
    }

    this.backupRoot = path.join(workspaceFolders[0].uri.fsPath, this.BACKUP_DIR);
    
    // Ensure backup directory exists
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.backupRoot));
    } catch (error) {
      // Directory might already exist
    }

    // Load existing metadata
    await this.loadMetadata();
  }

  /**
   * Create a backup of a file
   */
  async createBackup(filePath: string): Promise<string> {
    if (!this.backupRoot) {
      throw new Error('Backup system not initialized');
    }

    const uri = vscode.Uri.file(filePath);
    
    // Check if file exists
    let fileContent: Uint8Array;
    let fileStats: vscode.FileStat;
    
    try {
      fileContent = await vscode.workspace.fs.readFile(uri);
      fileStats = await vscode.workspace.fs.stat(uri);
    } catch (error) {
      throw new Error(`Cannot backup non-existent file: ${filePath}`);
    }

    // Generate backup ID and path
    const backupId = this.generateBackupId();
    const timestamp = new Date();
    const backupFileName = `${backupId}_${path.basename(filePath)}`;
    const backupPath = path.join(this.backupRoot, backupFileName);

    // Calculate checksum
    const checksum = this.calculateChecksum(fileContent);

    // Write backup file
    await vscode.workspace.fs.writeFile(vscode.Uri.file(backupPath), fileContent);

    // Create backup info
    const backupInfo: BackupInfo = {
      id: backupId,
      originalPath: filePath,
      backupPath: backupPath,
      timestamp,
      size: fileStats.size,
      operation: 'backup',
      checksum
    };

    // Update metadata
    this.metadata.backups.push(backupInfo);
    await this.saveMetadata();

    this.logger.info(`Created backup ${backupId} for ${filePath}`);
    return backupId;
  }

  /**
   * Restore a file from backup
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backupInfo = this.metadata.backups.find(b => b.id === backupId);
    
    if (!backupInfo) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    // Read backup file
    const backupUri = vscode.Uri.file(backupInfo.backupPath);
    let backupContent: Uint8Array;
    
    try {
      backupContent = await vscode.workspace.fs.readFile(backupUri);
    } catch (error) {
      throw new Error(`Backup file not found: ${backupInfo.backupPath}`);
    }

    // Verify checksum if available
    if (backupInfo.checksum) {
      const currentChecksum = this.calculateChecksum(backupContent);
      if (currentChecksum !== backupInfo.checksum) {
        throw new Error('Backup file corrupted: checksum mismatch');
      }
    }

    // Restore to original location
    const originalUri = vscode.Uri.file(backupInfo.originalPath);
    await vscode.workspace.fs.writeFile(originalUri, backupContent);

    this.logger.info(`Restored backup ${backupId} to ${backupInfo.originalPath}`);
  }

  /**
   * Clean up old backups
   */
  async cleanupBackups(olderThan: Date): Promise<void> {
    if (!this.backupRoot) {
      return;
    }

    const backupsToRemove: BackupInfo[] = [];
    const backupsToKeep: BackupInfo[] = [];

    for (const backup of this.metadata.backups) {
      if (backup.timestamp < olderThan) {
        backupsToRemove.push(backup);
      } else {
        backupsToKeep.push(backup);
      }
    }

    // Delete old backup files
    for (const backup of backupsToRemove) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(backup.backupPath));
        this.logger.debug(`Deleted old backup: ${backup.id}`);
      } catch (error) {
        this.logger.warning(`Failed to delete backup file: ${backup.backupPath}`);
      }
    }

    // Update metadata
    if (backupsToRemove.length > 0) {
      this.metadata.backups = backupsToKeep;
      await this.saveMetadata();
      this.logger.info(`Cleaned up ${backupsToRemove.length} old backups`);
    }
  }

  /**
   * List all backups or backups for a specific file
   */
  async listBackups(filePath?: string): Promise<BackupInfo[]> {
    if (filePath) {
      return this.metadata.backups.filter(b => b.originalPath === filePath);
    }
    return [...this.metadata.backups];
  }

  /**
   * Get backup information
   */
  getBackupInfo(backupId: string): BackupInfo | undefined {
    return this.metadata.backups.find(b => b.id === backupId);
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId: string): Promise<boolean> {
    const backupInfo = this.metadata.backups.find(b => b.id === backupId);
    
    if (!backupInfo) {
      return false;
    }

    try {
      const backupUri = vscode.Uri.file(backupInfo.backupPath);
      const content = await vscode.workspace.fs.readFile(backupUri);
      
      if (backupInfo.checksum) {
        const currentChecksum = this.calculateChecksum(content);
        return currentChecksum === backupInfo.checksum;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Export backups for a file
   */
  async exportBackups(filePath: string, exportPath: string): Promise<void> {
    const backups = await this.listBackups(filePath);
    
    if (backups.length === 0) {
      throw new Error(`No backups found for ${filePath}`);
    }

    const exportData = {
      originalFile: filePath,
      exportDate: new Date(),
      backups: backups.map(b => ({
        ...b,
        content: undefined // Will be added below
      }))
    };

    // Include backup contents
    for (let i = 0; i < backups.length; i++) {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(backups[i].backupPath));
      (exportData.backups[i] as any).content = Buffer.from(content).toString('base64');
    }

    // Write export file
    const exportContent = JSON.stringify(exportData, null, 2);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(exportPath),
      new TextEncoder().encode(exportContent)
    );

    this.logger.info(`Exported ${backups.length} backups to ${exportPath}`);
  }

  /**
   * Import backups from export file
   */
  async importBackups(importPath: string): Promise<number> {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(importPath));
    const importData = JSON.parse(new TextDecoder().decode(content));

    let imported = 0;

    for (const backupData of importData.backups) {
      if (!backupData.content) continue;

      // Generate new backup ID
      const backupId = this.generateBackupId();
      const backupFileName = `${backupId}_${path.basename(backupData.originalPath)}`;
      const backupPath = path.join(this.backupRoot!, backupFileName);

      // Write backup file
      const content = Buffer.from(backupData.content, 'base64');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(backupPath), content);

      // Create backup info
      const backupInfo: BackupInfo = {
        id: backupId,
        originalPath: backupData.originalPath,
        backupPath: backupPath,
        timestamp: new Date(backupData.timestamp),
        size: backupData.size,
        operation: `imported from ${path.basename(importPath)}`,
        checksum: backupData.checksum
      };

      this.metadata.backups.push(backupInfo);
      imported++;
    }

    await this.saveMetadata();
    this.logger.info(`Imported ${imported} backups from ${importPath}`);
    
    return imported;
  }

  /**
   * Generate unique backup ID
   */
  private generateBackupId(): string {
    return `bk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate checksum for content
   */
  private calculateChecksum(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Load metadata from disk
   */
  private async loadMetadata(): Promise<void> {
    if (!this.backupRoot) return;

    const metadataPath = path.join(this.backupRoot, this.METADATA_FILE);
    
    try {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
      const data = JSON.parse(new TextDecoder().decode(content));
      
      // Convert date strings back to Date objects
      data.backups = data.backups.map((b: any) => ({
        ...b,
        timestamp: new Date(b.timestamp)
      }));
      
      this.metadata = data;
      this.logger.debug(`Loaded ${this.metadata.backups.length} backups from metadata`);
    } catch (error) {
      // No metadata file exists yet
      this.logger.debug('No existing backup metadata found');
    }
  }

  /**
   * Save metadata to disk
   */
  private async saveMetadata(): Promise<void> {
    if (!this.backupRoot) return;

    const metadataPath = path.join(this.backupRoot, this.METADATA_FILE);
    const content = JSON.stringify(this.metadata, null, 2);
    
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(metadataPath),
      new TextEncoder().encode(content)
    );
  }

  /**
   * Get backup statistics
   */
  getStatistics(): {
    totalBackups: number;
    totalSize: number;
    oldestBackup?: Date;
    newestBackup?: Date;
  } {
    const stats = {
      totalBackups: this.metadata.backups.length,
      totalSize: 0,
      oldestBackup: undefined as Date | undefined,
      newestBackup: undefined as Date | undefined
    };

    if (this.metadata.backups.length > 0) {
      stats.totalSize = this.metadata.backups.reduce((sum, b) => sum + b.size, 0);
      
      const sorted = [...this.metadata.backups].sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      );
      
      stats.oldestBackup = sorted[0].timestamp;
      stats.newestBackup = sorted[sorted.length - 1].timestamp;
    }

    return stats;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}