import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { FileOperation, OperationType } from './code-extractor';

/**
 * Result of permission validation
 */
export interface PermissionResult {
  allPermitted: boolean;
  deniedOperations: string[];
  deniedReasons: string[];
  warnings: string[];
}

/**
 * Result of file path validation
 */
export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * Security check result
 */
export interface SecurityResult {
  isSecure: boolean;
  risks: SecurityRisk[];
  recommendations: string[];
}

/**
 * Security risk information
 */
export interface SecurityRisk {
  type: 'path-traversal' | 'system-file' | 'sensitive-data' | 'executable' | 'large-file';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  filePath?: string;
}

/**
 * Permission policy configuration
 */
export interface PermissionPolicy {
  allowedExtensions?: string[];
  blockedExtensions?: string[];
  blockedPaths?: string[];
  maxFileSize?: number;
  requireUserApproval?: boolean;
  allowSystemFiles?: boolean;
}

/**
 * Validates permissions for file operations
 */
export class PermissionChecker {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private policy: PermissionPolicy;
  private workspaceRoot: string | null = null;

  // Default blocked paths
  private readonly SYSTEM_PATHS = [
    '.git',
    '.vscode',
    'node_modules',
    '.env',
    '.env.local',
    '.env.production',
    'secrets',
    'credentials',
    '.ssh',
    '.aws',
    '.azure'
  ];

  // Sensitive file patterns
  private readonly SENSITIVE_PATTERNS = [
    /password/i,
    /secret/i,
    /private[_-]?key/i,
    /api[_-]?key/i,
    /access[_-]?token/i,
    /auth/i,
    /credential/i
  ];

  // Dangerous extensions
  private readonly DANGEROUS_EXTENSIONS = [
    '.exe', '.dll', '.so', '.dylib',
    '.bat', '.cmd', '.ps1', '.sh',
    '.app', '.dmg', '.pkg', '.deb', '.rpm'
  ];

  constructor(policy?: PermissionPolicy) {
    this.outputChannel = vscode.window.createOutputChannel('Claude Permission Checker');
    this.logger = new Logger(this.outputChannel);
    
    // Load default policy with overrides
    this.policy = {
      allowedExtensions: undefined, // Allow all by default
      blockedExtensions: [...this.DANGEROUS_EXTENSIONS],
      blockedPaths: [...this.SYSTEM_PATHS],
      maxFileSize: 10 * 1024 * 1024, // 10MB default
      requireUserApproval: false,
      allowSystemFiles: false,
      ...policy
    };

    this.initializeWorkspace();
  }

  /**
   * Initialize workspace settings
   */
  private initializeWorkspace(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * Validate permissions for multiple operations
   */
  async validateOperations(operations: FileOperation[]): Promise<PermissionResult> {
    const result: PermissionResult = {
      allPermitted: true,
      deniedOperations: [],
      deniedReasons: [],
      warnings: []
    };

    for (const operation of operations) {
      const permissionCheck = await this.checkOperationPermissions(operation);
      
      if (!permissionCheck.isValid) {
        result.allPermitted = false;
        result.deniedOperations.push(operation.id);
        result.deniedReasons.push(permissionCheck.reason || 'Permission denied');
      }

      // Check security
      const securityCheck = this.checkSecurityConstraints(operation);
      if (!securityCheck.isSecure) {
        for (const risk of securityCheck.risks) {
          if (risk.severity === 'critical' || risk.severity === 'high') {
            result.allPermitted = false;
            result.deniedOperations.push(operation.id);
            result.deniedReasons.push(risk.description);
          } else {
            result.warnings.push(risk.description);
          }
        }
      }
    }

    // Request user approval if required
    if (this.policy.requireUserApproval && result.allPermitted) {
      const approved = await this.requestUserApproval(operations);
      if (!approved) {
        result.allPermitted = false;
        result.deniedReasons.push('User rejected the operations');
      }
    }

    return result;
  }

  /**
   * Check permissions for a single operation
   */
  async checkOperationPermissions(operation: FileOperation): Promise<ValidationResult> {
    // Validate file path
    const pathValidation = this.validateFilePath(operation.targetPath);
    if (!pathValidation.isValid) {
      return pathValidation;
    }

    // Check operation-specific permissions
    switch (operation.type) {
      case OperationType.DELETE:
        return this.checkDeletePermission(operation.targetPath);
      
      case OperationType.CREATE:
      case OperationType.UPDATE:
      case OperationType.APPEND:
        return this.checkWritePermission(operation.targetPath);
      
      case OperationType.MOVE:
        const sourceCheck = await this.checkDeletePermission(operation.sourcePath || operation.targetPath);
        if (!sourceCheck.isValid) return sourceCheck;
        return this.checkWritePermission(operation.targetPath);
      
      default:
        return { isValid: true };
    }
  }

  /**
   * Validate file path
   */
  validateFilePath(filePath: string): ValidationResult {
    if (!filePath || filePath.trim() === '') {
      return { 
        isValid: false, 
        reason: 'File path is empty' 
      };
    }

    // Check for path traversal attempts
    if (filePath.includes('..') || filePath.includes('~')) {
      return { 
        isValid: false, 
        reason: 'Path traversal detected', 
        suggestion: 'Use absolute paths within the workspace' 
      };
    }

    // Check if path is absolute and outside workspace
    if (path.isAbsolute(filePath) && this.workspaceRoot) {
      const normalizedPath = path.normalize(filePath);
      const normalizedRoot = path.normalize(this.workspaceRoot);
      
      if (!normalizedPath.startsWith(normalizedRoot)) {
        return { 
          isValid: false, 
          reason: 'Path is outside workspace boundaries', 
          suggestion: 'Only files within the workspace can be modified' 
        };
      }
    }

    // Check blocked paths
    for (const blockedPath of this.policy.blockedPaths || []) {
      if (filePath.includes(blockedPath)) {
        return { 
          isValid: false, 
          reason: `Access to ${blockedPath} is blocked by security policy`, 
          suggestion: 'This path is protected and cannot be modified' 
        };
      }
    }

    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    
    if (this.policy.allowedExtensions && this.policy.allowedExtensions.length > 0) {
      if (!this.policy.allowedExtensions.includes(ext)) {
        return { 
          isValid: false, 
          reason: `File extension ${ext} is not allowed`, 
          suggestion: `Allowed extensions: ${this.policy.allowedExtensions.join(', ')}` 
        };
      }
    }

    if (this.policy.blockedExtensions?.includes(ext)) {
      return { 
        isValid: false, 
        reason: `File extension ${ext} is blocked for security reasons`, 
        suggestion: 'Executable and system files cannot be modified' 
      };
    }

    return { isValid: true };
  }

  /**
   * Check write access to a path
   */
  async checkWriteAccess(filePath: string): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      const dir = path.dirname(filePath);
      
      // Check if parent directory exists and is writable
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(dir));
        return true;
      } catch {
        // Directory doesn't exist, check if we can create it
        const parentDir = path.dirname(dir);
        return this.checkWriteAccess(parentDir);
      }
    } catch (error) {
      this.logger.warning(`No write access to ${filePath}: ${error}`);
      return false;
    }
  }

  /**
   * Check security constraints
   */
  checkSecurityConstraints(operation: FileOperation): SecurityResult {
    const risks: SecurityRisk[] = [];
    const recommendations: string[] = [];

    // Check for sensitive file names
    const fileName = path.basename(operation.targetPath);
    for (const pattern of this.SENSITIVE_PATTERNS) {
      if (pattern.test(fileName)) {
        risks.push({
          type: 'sensitive-data',
          severity: 'high',
          description: `File name suggests sensitive data: ${fileName}`,
          filePath: operation.targetPath
        });
        recommendations.push('Review file contents for sensitive information');
        break;
      }
    }

    // Check file size for create/update operations
    if (operation.content && operation.content.length > (this.policy.maxFileSize || Infinity)) {
      risks.push({
        type: 'large-file',
        severity: 'medium',
        description: `File size (${operation.content.length} bytes) exceeds limit`,
        filePath: operation.targetPath
      });
      recommendations.push('Consider splitting large files or using external storage');
    }

    // Check for system files
    if (!this.policy.allowSystemFiles && this.isSystemFile(operation.targetPath)) {
      risks.push({
        type: 'system-file',
        severity: 'critical',
        description: 'Attempting to modify system file',
        filePath: operation.targetPath
      });
    }

    // Check for executable files
    const ext = path.extname(operation.targetPath).toLowerCase();
    if (this.DANGEROUS_EXTENSIONS.includes(ext)) {
      risks.push({
        type: 'executable',
        severity: 'critical',
        description: 'Attempting to create/modify executable file',
        filePath: operation.targetPath
      });
    }

    return {
      isSecure: risks.filter(r => r.severity === 'critical' || r.severity === 'high').length === 0,
      risks,
      recommendations
    };
  }

  /**
   * Check delete permission
   */
  private async checkDeletePermission(filePath: string): Promise<ValidationResult> {
    // Don't allow deleting directories
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      if (stat.type === vscode.FileType.Directory) {
        return {
          isValid: false,
          reason: 'Cannot delete directories',
          suggestion: 'Only individual files can be deleted'
        };
      }
    } catch {
      // File doesn't exist, which is okay for delete
    }

    // Check if it's a critical file
    if (this.isCriticalFile(filePath)) {
      return {
        isValid: false,
        reason: 'Cannot delete critical project files',
        suggestion: 'This file is essential for the project'
      };
    }

    return { isValid: true };
  }

  /**
   * Check write permission
   */
  private async checkWritePermission(filePath: string): Promise<ValidationResult> {
    const hasAccess = await this.checkWriteAccess(filePath);
    if (!hasAccess) {
      return {
        isValid: false,
        reason: 'No write permission for file path',
        suggestion: 'Check file permissions and workspace access'
      };
    }

    return { isValid: true };
  }

  /**
   * Check if file is a system file
   */
  private isSystemFile(filePath: string): boolean {
    const systemPatterns = [
      /^\/etc\//,
      /^\/usr\//,
      /^\/bin\//,
      /^\/sbin\//,
      /^C:\\Windows\\/i,
      /^C:\\Program Files\\/i
    ];

    return systemPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if file is critical for project
   */
  private isCriticalFile(filePath: string): boolean {
    const criticalFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'webpack.config.js',
      'vite.config.js',
      '.gitignore',
      'README.md'
    ];

    const fileName = path.basename(filePath);
    return criticalFiles.includes(fileName);
  }

  /**
   * Request user approval for operations
   */
  private async requestUserApproval(operations: FileOperation[]): Promise<boolean> {
    const items = operations.map(op => 
      `${op.type.toUpperCase()} ${vscode.workspace.asRelativePath(op.targetPath)}`
    );

    const detail = items.join('\n');
    const result = await vscode.window.showWarningMessage(
      `Claude Code wants to modify ${operations.length} files`,
      { modal: true, detail },
      'Allow',
      'Deny'
    );

    return result === 'Allow';
  }

  /**
   * Update permission policy
   */
  updatePolicy(policy: Partial<PermissionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    this.logger.info('Permission policy updated');
  }

  /**
   * Get current policy
   */
  getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }

  /**
   * Audit log for operations
   */
  async logOperation(operation: FileOperation, result: 'permitted' | 'denied', reason?: string): Promise<void> {
    const logEntry = {
      timestamp: new Date(),
      operation: operation.type,
      filePath: operation.targetPath,
      result,
      reason
    };

    this.logger.info(`Security audit: ${JSON.stringify(logEntry)}`);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}