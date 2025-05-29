import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from './logger';
import type { CodeBlock } from './streaming-parser';

/**
 * Types of file operations
 */
export enum OperationType {
  CREATE = 'create', // New file creation
  UPDATE = 'update', // Modify existing file
  DELETE = 'delete', // Remove file
  MOVE = 'move', // Rename/move file
  APPEND = 'append', // Add to end of file
}

/**
 * Represents a file operation to be performed
 */
export interface FileOperation {
  id: string;
  type: OperationType;
  targetPath: string;
  sourcePath?: string; // For MOVE operations
  content?: string;
  lineRange?: { start: number; end: number };
  metadata: OperationMetadata;
  validation?: ValidationResult;
  risk?: RiskLevel;
}

/**
 * Operation metadata
 */
export interface OperationMetadata {
  description?: string;
  language?: string;
  framework?: string;
  dependencies?: string[];
  affectedFiles?: string[];
  timestamp: Date;
}

/**
 * Validation result for operations
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Risk level assessment
 */
export enum RiskLevel {
  LOW = 'low', // Safe operation
  MEDIUM = 'medium', // Requires review
  HIGH = 'high', // Potentially dangerous
}

/**
 * Extracts actionable code and file operations from parsed blocks
 */
export class CodeExtractor {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private workspaceRoot: string;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      'Claude Code Extractor',
    );
    this.logger = new Logger(this.outputChannel);
    this.workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  /**
   * Extract file operations from code blocks
   */
  extractFileOperations(blocks: CodeBlock[]): FileOperation[] {
    const operations: FileOperation[] = [];
    const operationGroups = this.groupBlocksByFile(blocks);

    for (const [filePath, fileBlocks] of operationGroups) {
      // Handle explicit file path
      if (filePath) {
        const operation = this.createFileOperation(filePath, fileBlocks);
        if (operation) {
          operations.push(operation);
        }
      } else {
        // Handle blocks without explicit file paths
        for (const block of fileBlocks) {
          const inferredPath = this.inferTargetFile(block);
          if (inferredPath) {
            const operation = this.createFileOperation(inferredPath, [block]);
            if (operation) {
              operations.push(operation);
            }
          }
        }
      }
    }

    // Sort operations by dependency order
    return this.sortOperationsByDependency(operations);
  }

  /**
   * Identify target file for a code block
   */
  identifyTargetFile(block: CodeBlock): string | undefined {
    // First check explicit file path
    if (block.filePath) {
      return this.resolveFilePath(block.filePath);
    }

    // Try to infer from code content
    return this.inferTargetFile(block);
  }

  /**
   * Determine operation type from code block
   */
  determineOperationType(block: CodeBlock): OperationType {
    // Check explicit operation
    if (block.operation !== 'unknown') {
      return this.mapBlockOperationToType(block.operation);
    }

    // Infer from content and context
    const content = block.code.toLowerCase();
    const description = block.metadata?.description?.toLowerCase() || '';

    if (content.includes('create new file') || description.includes('create')) {
      return OperationType.CREATE;
    } else if (
      content.includes('delete file') ||
      description.includes('delete')
    ) {
      return OperationType.DELETE;
    } else if (content.includes('rename') || description.includes('move')) {
      return OperationType.MOVE;
    } else if (
      content.includes('append') ||
      description.includes('add to end')
    ) {
      return OperationType.APPEND;
    }

    // Default to update for existing files
    return OperationType.UPDATE;
  }

  /**
   * Extract clean code content from block
   */
  extractCodeContent(block: CodeBlock): string {
    let content = block.code;

    // Remove any instruction comments
    content = this.removeInstructionComments(content);

    // Preserve proper indentation
    content = this.preserveIndentation(content);

    // Handle partial code snippets
    content = this.handlePartialCode(content, block);

    return content;
  }

  /**
   * Group code blocks by target file
   */
  private groupBlocksByFile(
    blocks: CodeBlock[],
  ): Map<string | undefined, CodeBlock[]> {
    const groups = new Map<string | undefined, CodeBlock[]>();

    for (const block of blocks) {
      const filePath = block.filePath;
      const existing = groups.get(filePath) || [];
      existing.push(block);
      groups.set(filePath, existing);
    }

    return groups;
  }

  /**
   * Create a file operation from blocks
   */
  private createFileOperation(
    filePath: string,
    blocks: CodeBlock[],
  ): FileOperation | null {
    if (blocks.length === 0) return null;

    const primaryBlock = blocks[0];
    const operationType = this.determineOperationType(primaryBlock);

    // Combine content from multiple blocks if needed
    let content = '';
    if (operationType !== OperationType.DELETE) {
      content = blocks
        .map((block) => this.extractCodeContent(block))
        .join('\n\n');
    }

    const operation: FileOperation = {
      id: this.generateOperationId(),
      type: operationType,
      targetPath: filePath,
      content,
      metadata: {
        description: primaryBlock.metadata?.description,
        language: primaryBlock.language,
        timestamp: new Date(),
        affectedFiles: [filePath],
      },
    };

    // Add line range if specified
    if (primaryBlock.metadata?.lineNumbers) {
      operation.lineRange = primaryBlock.metadata.lineNumbers;
    }

    this.logger.debug(`Created ${operationType} operation for ${filePath}`);
    return operation;
  }

  /**
   * Resolve file path relative to workspace
   */
  private resolveFilePath(filePath: string): string {
    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // Resolve relative to workspace root
    if (this.workspaceRoot) {
      return path.join(this.workspaceRoot, filePath);
    }

    return filePath;
  }

  /**
   * Infer target file from code content
   */
  private inferTargetFile(block: CodeBlock): string | undefined {
    const code = block.code;
    const language = block.language;

    // Look for file path comments
    const filePathComment = code.match(
      /(?:\/\/|#|\/\*)\s*(?:file|File|FILE):\s*([^\s\n]+)/,
    );
    if (filePathComment) {
      return this.resolveFilePath(filePathComment[1]);
    }

    // Look for module/class declarations
    if (language === 'typescript' || language === 'javascript') {
      // Look for export statements that might indicate file name
      const exportMatch = code.match(
        /export\s+(?:default\s+)?(?:class|function|const)\s+(\w+)/,
      );
      if (exportMatch) {
        const name = exportMatch[1];
        const extension = language === 'typescript' ? '.ts' : '.js';
        return this.findFileByName(name, extension);
      }
    }

    return undefined;
  }

  /**
   * Find file by name in workspace
   */
  private findFileByName(name: string, extension: string): string | undefined {
    // This would need to search the workspace for matching files
    // For now, return undefined to indicate manual path needed
    this.logger.debug(
      `Could not automatically locate file for ${name}${extension}`,
    );
    return undefined;
  }

  /**
   * Map block operation to operation type
   */
  private mapBlockOperationToType(operation: string): OperationType {
    switch (operation) {
      case 'create':
        return OperationType.CREATE;
      case 'update':
        return OperationType.UPDATE;
      case 'delete':
        return OperationType.DELETE;
      default:
        return OperationType.UPDATE;
    }
  }

  /**
   * Remove instruction comments from code
   */
  private removeInstructionComments(code: string): string {
    // Remove common instruction patterns
    const patterns = [
      /\/\/\s*TODO:.*$/gm,
      /\/\/\s*FIXME:.*$/gm,
      /\/\/\s*REPLACE:.*$/gm,
      /\/\/\s*INSERT.*:.*$/gm,
      /\/\/\s*DELETE.*:.*$/gm,
      /\/\/\s*Update.*$/gm,
      /\/\/\s*Create.*$/gm,
      /\/\/\s*Add.*$/gm,
    ];

    let cleaned = code;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove empty lines left by comment removal
    cleaned = cleaned.replace(/^\s*\n/gm, '');

    return cleaned;
  }

  /**
   * Preserve proper indentation in code
   */
  private preserveIndentation(code: string): string {
    const lines = code.split('\n');
    if (lines.length === 0) return code;

    // Find the minimum indentation (excluding empty lines)
    let minIndent = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      if (line.trim()) {
        const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
        minIndent = Math.min(minIndent, leadingSpaces);
      }
    }

    // Remove the minimum indentation from all lines
    if (minIndent > 0 && minIndent < Number.POSITIVE_INFINITY) {
      return lines
        .map((line) => {
          if (line.trim()) {
            return line.substring(minIndent);
          }
          return line;
        })
        .join('\n');
    }

    return code;
  }

  /**
   * Handle partial code snippets
   */
  private handlePartialCode(content: string, block: CodeBlock): string {
    // Check if this is a function/method update
    if (block.metadata?.lineNumbers && block.operation === 'update') {
      // This might be a partial update - add comment to indicate
      return `// Partial update for lines ${block.metadata.lineNumbers.start}-${block.metadata.lineNumbers.end}\n${content}`;
    }

    // Check if code appears to be incomplete
    if (this.isIncompleteCode(content)) {
      this.logger.warning(
        `Code block appears incomplete for ${block.filePath || 'unknown file'}`,
      );
    }

    return content;
  }

  /**
   * Check if code appears incomplete
   */
  private isIncompleteCode(code: string): boolean {
    // Count brackets
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;

    return (
      openBraces !== closeBraces ||
      openParens !== closeParens ||
      openBrackets !== closeBrackets
    );
  }

  /**
   * Sort operations by dependency order
   */
  private sortOperationsByDependency(
    operations: FileOperation[],
  ): FileOperation[] {
    // Simple sort: CREATE before UPDATE before DELETE
    const priority: Record<OperationType, number> = {
      [OperationType.CREATE]: 1,
      [OperationType.MOVE]: 2,
      [OperationType.UPDATE]: 3,
      [OperationType.APPEND]: 4,
      [OperationType.DELETE]: 5,
    };

    return operations.sort((a, b) => {
      return priority[a.type] - priority[b.type];
    });
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}
