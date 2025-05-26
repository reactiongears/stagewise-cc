import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';

/**
 * Workspace validation result
 */
export interface WorkspaceValidation {
  isValid: boolean;
  hasWorkspace: boolean;
  hasWritePermission: boolean;
  availableSpace?: number;
  errors: string[];
  warnings: string[];
}

/**
 * Manages workspace state and file operations
 */
export class WorkspaceManager {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private workspaceRoot: string | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Workspace Manager');
    this.logger = new Logger(this.outputChannel);
    this.initializeWorkspace();
    this.setupFileWatcher();
  }

  /**
   * Initialize workspace settings
   */
  private initializeWorkspace(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      this.logger.info(`Workspace root: ${this.workspaceRoot}`);
    } else {
      this.logger.warning('No workspace folder found');
    }
  }

  /**
   * Setup file watcher for external changes
   */
  private setupFileWatcher(): void {
    if (!this.workspaceRoot) return;

    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.fileWatcher.onDidCreate(uri => {
      this.logger.debug(`File created externally: ${uri.fsPath}`);
    });

    this.fileWatcher.onDidDelete(uri => {
      this.logger.debug(`File deleted externally: ${uri.fsPath}`);
    });

    this.fileWatcher.onDidChange(uri => {
      this.logger.debug(`File changed externally: ${uri.fsPath}`);
    });
  }

  /**
   * Validate workspace is ready for operations
   */
  async validateWorkspace(): Promise<WorkspaceValidation> {
    const validation: WorkspaceValidation = {
      isValid: true,
      hasWorkspace: false,
      hasWritePermission: false,
      errors: [],
      warnings: []
    };

    // Check if workspace is open
    if (!this.workspaceRoot) {
      validation.isValid = false;
      validation.errors.push('No workspace folder is open');
      return validation;
    }

    validation.hasWorkspace = true;

    // Check write permissions
    try {
      const testFile = path.join(this.workspaceRoot, '.stagewise-test-' + Date.now());
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(testFile),
        new TextEncoder().encode('test')
      );
      await vscode.workspace.fs.delete(vscode.Uri.file(testFile));
      validation.hasWritePermission = true;
    } catch (error) {
      validation.isValid = false;
      validation.errors.push('No write permission in workspace');
    }

    // Check available disk space (platform-specific)
    try {
      const stats = await this.getWorkspaceStats();
      validation.availableSpace = stats.availableSpace;
      
      if (stats.availableSpace < 100 * 1024 * 1024) { // Less than 100MB
        validation.warnings.push('Low disk space available');
      }
    } catch (error) {
      validation.warnings.push('Could not determine available disk space');
    }

    // Check for .git directory
    try {
      const gitPath = path.join(this.workspaceRoot, '.git');
      await vscode.workspace.fs.stat(vscode.Uri.file(gitPath));
      this.logger.debug('Git repository detected');
    } catch {
      validation.warnings.push('Not a git repository - version control recommended');
    }

    return validation;
  }

  /**
   * Resolve relative path to absolute path within workspace
   */
  resolveFilePath(relativePath: string): string {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is open');
    }

    // If already absolute, validate it's within workspace
    if (path.isAbsolute(relativePath)) {
      const normalizedPath = path.normalize(relativePath);
      const normalizedRoot = path.normalize(this.workspaceRoot);
      
      if (!normalizedPath.startsWith(normalizedRoot)) {
        throw new Error(`Path is outside workspace: ${relativePath}`);
      }
      
      return normalizedPath;
    }

    // Resolve relative to workspace root
    const resolvedPath = path.join(this.workspaceRoot, relativePath);
    const normalizedPath = path.normalize(resolvedPath);
    const normalizedRoot = path.normalize(this.workspaceRoot);

    // Ensure resolved path is within workspace
    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }

    return normalizedPath;
  }

  /**
   * Ensure directory exists, creating if necessary
   */
  async ensureDirectoryExists(dirPath: string): Promise<void> {
    const uri = vscode.Uri.file(dirPath);

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.Directory) {
        throw new Error(`Path exists but is not a directory: ${dirPath}`);
      }
    } catch (error) {
      // Directory doesn't exist, create it
      if ((error as any).code === 'FileNotFound' || (error as any).message?.includes('ENOENT')) {
        await vscode.workspace.fs.createDirectory(uri);
        this.logger.debug(`Created directory: ${dirPath}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get list of all files in workspace
   */
  async getWorkspaceFiles(pattern: string = '**/*'): Promise<string[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
    return files.map(uri => vscode.workspace.asRelativePath(uri));
  }

  /**
   * Check if path is within workspace boundaries
   */
  isPathInWorkspace(filePath: string): boolean {
    if (!this.workspaceRoot) {
      return false;
    }

    const normalizedPath = path.normalize(path.resolve(filePath));
    const normalizedRoot = path.normalize(this.workspaceRoot);

    return normalizedPath.startsWith(normalizedRoot);
  }

  /**
   * Get relative path from workspace root
   */
  getRelativePath(absolutePath: string): string {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is open');
    }

    if (!this.isPathInWorkspace(absolutePath)) {
      throw new Error(`Path is outside workspace: ${absolutePath}`);
    }

    return path.relative(this.workspaceRoot, absolutePath);
  }

  /**
   * Handle multi-root workspaces
   */
  getWorkspaceFolderForPath(filePath: string): vscode.WorkspaceFolder | undefined {
    const uri = vscode.Uri.file(filePath);
    return vscode.workspace.getWorkspaceFolder(uri);
  }

  /**
   * Get workspace statistics
   */
  private async getWorkspaceStats(): Promise<{ totalSpace: number; availableSpace: number }> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is open');
    }

    // This is platform-specific and simplified
    // In a real implementation, you'd use platform-specific APIs
    return new Promise((resolve) => {
      // Simulated values for now
      resolve({
        totalSpace: 500 * 1024 * 1024 * 1024, // 500GB
        availableSpace: 100 * 1024 * 1024 * 1024 // 100GB
      });
    });
  }

  /**
   * Watch for specific file patterns
   */
  createPatternWatcher(pattern: string): vscode.FileSystemWatcher {
    return vscode.workspace.createFileSystemWatcher(pattern);
  }

  /**
   * Get workspace configuration
   */
  getConfiguration<T>(section: string): T | undefined {
    return vscode.workspace.getConfiguration().get<T>(section);
  }

  /**
   * Update workspace configuration
   */
  async updateConfiguration(section: string, value: any, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
    await vscode.workspace.getConfiguration().update(section, value, target);
  }

  /**
   * Find files matching pattern
   */
  async findFiles(include: vscode.GlobPattern, exclude?: vscode.GlobPattern | null, maxResults?: number): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles(include, exclude, maxResults);
  }

  /**
   * Open file in editor
   */
  async openFileInEditor(filePath: string, options?: vscode.TextDocumentShowOptions): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(document, options);
  }

  /**
   * Get workspace name
   */
  getWorkspaceName(): string | undefined {
    return vscode.workspace.name;
  }

  /**
   * Get workspace root path
   */
  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  /**
   * Clean up empty directories
   */
  async cleanupEmptyDirectories(dirPath: string): Promise<void> {
    const uri = vscode.Uri.file(dirPath);

    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      
      if (entries.length === 0) {
        await vscode.workspace.fs.delete(uri);
        this.logger.debug(`Removed empty directory: ${dirPath}`);
        
        // Recursively check parent directory
        const parentDir = path.dirname(dirPath);
        if (this.isPathInWorkspace(parentDir) && parentDir !== this.workspaceRoot) {
          await this.cleanupEmptyDirectories(parentDir);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
      this.logger.debug(`Could not clean up directory: ${dirPath}`);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    this.outputChannel.dispose();
  }
}