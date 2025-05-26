import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { CodeBlock } from './streaming-parser';
import { FileOperation, OperationType, OperationMetadata } from './code-extractor';

/**
 * Represents a file creation operation
 */
export interface CreateOperation extends FileOperation {
  type: OperationType.CREATE;
  directoryStructure?: string[];
  filePermissions?: string;
  encoding?: string;
}

/**
 * Represents a file update operation
 */
export interface UpdateOperation extends FileOperation {
  type: OperationType.UPDATE;
  updateType: 'replace' | 'insert' | 'patch';
  searchPattern?: string;
  replacePattern?: string;
  insertPosition?: 'before' | 'after' | 'start' | 'end';
  insertAnchor?: string;
}

/**
 * Represents a file deletion operation
 */
export interface DeleteOperation extends FileOperation {
  type: OperationType.DELETE;
  recursive?: boolean;
  force?: boolean;
}

/**
 * Inline instruction found in code
 */
export interface InlineInstruction {
  type: 'replace' | 'insert' | 'delete' | 'todo';
  line: number;
  content: string;
  target?: string;
  position?: 'before' | 'after';
}

/**
 * Parses specific file operation instructions from code blocks
 */
export class FileOperationParser {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private workspaceRoot: string;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude File Operation Parser');
    this.logger = new Logger(this.outputChannel);
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  /**
   * Parse create operation from code block
   */
  parseCreateOperation(block: CodeBlock): CreateOperation {
    const basePath = this.resolveFilePath(block.filePath || '');
    const directoryStructure = this.extractDirectoryRequirements(block);

    const operation: CreateOperation = {
      id: this.generateId(),
      type: OperationType.CREATE,
      targetPath: basePath,
      content: this.extractCompleteContent(block),
      directoryStructure,
      metadata: this.buildMetadata(block),
      encoding: 'utf8'
    };

    // Check for file attributes in comments
    const permissionMatch = block.code.match(/\/\/\s*permissions?:\s*(\d{3})/i);
    if (permissionMatch) {
      operation.filePermissions = permissionMatch[1];
    }

    this.logger.debug(`Parsed CREATE operation for ${basePath}`);
    return operation;
  }

  /**
   * Parse update operation from code block
   */
  parseUpdateOperation(block: CodeBlock): UpdateOperation {
    const basePath = this.resolveFilePath(block.filePath || '');
    const updateType = this.determineUpdateType(block);

    const operation: UpdateOperation = {
      id: this.generateId(),
      type: OperationType.UPDATE,
      targetPath: basePath,
      content: block.code,
      updateType,
      metadata: this.buildMetadata(block)
    };

    // Parse specific update instructions
    if (updateType === 'replace') {
      const replaceInfo = this.parseReplaceInstructions(block);
      operation.searchPattern = replaceInfo.search;
      operation.replacePattern = replaceInfo.replace;
    } else if (updateType === 'insert') {
      const insertInfo = this.parseInsertInstructions(block);
      operation.insertPosition = insertInfo.position;
      operation.insertAnchor = insertInfo.anchor;
    }

    // Add line range if specified
    if (block.metadata?.lineNumbers) {
      operation.lineRange = block.metadata.lineNumbers;
    }

    this.logger.debug(`Parsed ${updateType} UPDATE operation for ${basePath}`);
    return operation;
  }

  /**
   * Parse delete operation from code block
   */
  parseDeleteOperation(block: CodeBlock): DeleteOperation {
    const basePath = this.resolveFilePath(block.filePath || '');

    const operation: DeleteOperation = {
      id: this.generateId(),
      type: OperationType.DELETE,
      targetPath: basePath,
      metadata: this.buildMetadata(block),
      recursive: false,
      force: false
    };

    // Check for recursive deletion
    if (block.code.match(/recursive|recursively|-r\b/i)) {
      operation.recursive = true;
    }

    // Check for force deletion
    if (block.code.match(/force|forced|-f\b/i)) {
      operation.force = true;
    }

    this.logger.debug(`Parsed DELETE operation for ${basePath}`);
    return operation;
  }

  /**
   * Parse inline instructions from code
   */
  parseInlineInstructions(code: string): InlineInstruction[] {
    const instructions: InlineInstruction[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const instruction = this.parseInstructionComment(line, i + 1);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    return instructions;
  }

  /**
   * Extract complete file content
   */
  private extractCompleteContent(block: CodeBlock): string {
    let content = block.code;

    // Remove file creation instructions
    content = content.replace(/^\/\/\s*Create new file.*$/gm, '');
    content = content.replace(/^\/\/\s*New file:.*$/gm, '');

    // Clean up the content
    content = content.trim();

    return content;
  }

  /**
   * Extract directory structure requirements
   */
  private extractDirectoryRequirements(block: CodeBlock): string[] {
    const directories: string[] = [];
    
    if (block.filePath) {
      const dir = path.dirname(block.filePath);
      if (dir && dir !== '.') {
        directories.push(dir);
      }
    }

    // Look for directory creation comments
    const dirMatches = block.code.matchAll(/\/\/\s*(?:create|mkdir)\s+directory:\s*(.+)$/gmi);
    for (const match of dirMatches) {
      directories.push(match[1].trim());
    }

    return [...new Set(directories)]; // Remove duplicates
  }

  /**
   * Determine update type from block
   */
  private determineUpdateType(block: CodeBlock): 'replace' | 'insert' | 'patch' {
    const code = block.code.toLowerCase();
    const description = (block.metadata?.description || '').toLowerCase();

    // Check for explicit replace instructions
    if (code.includes('// replace:') || description.includes('replace')) {
      return 'replace';
    }

    // Check for insert instructions
    if (code.includes('// insert') || description.includes('insert') || description.includes('add')) {
      return 'insert';
    }

    // Default to patch for partial updates
    if (block.metadata?.lineNumbers) {
      return 'patch';
    }

    return 'replace';
  }

  /**
   * Parse replace instructions
   */
  private parseReplaceInstructions(block: CodeBlock): { search: string; replace: string } {
    // Look for REPLACE: comments
    const replaceMatch = block.code.match(/\/\/\s*REPLACE:\s*(.+?)(?:\n|$)/i);
    const withMatch = block.code.match(/\/\/\s*WITH:\s*(.+?)(?:\n|$)/i);

    if (replaceMatch && withMatch) {
      return {
        search: replaceMatch[1].trim(),
        replace: withMatch[1].trim()
      };
    }

    // Look for inline replace patterns
    const inlineMatch = block.code.match(/\/\/\s*Replace\s+['"`](.+?)['"`]\s+with\s+['"`](.+?)['"`]/i);
    if (inlineMatch) {
      return {
        search: inlineMatch[1],
        replace: inlineMatch[2]
      };
    }

    // If no explicit instructions, use the whole content
    return {
      search: '',
      replace: block.code
    };
  }

  /**
   * Parse insert instructions
   */
  private parseInsertInstructions(block: CodeBlock): { position: 'before' | 'after' | 'start' | 'end'; anchor?: string } {
    // Look for INSERT AFTER: comments
    const afterMatch = block.code.match(/\/\/\s*INSERT\s+AFTER:\s*(.+?)(?:\n|$)/i);
    if (afterMatch) {
      return {
        position: 'after',
        anchor: afterMatch[1].trim()
      };
    }

    // Look for INSERT BEFORE: comments
    const beforeMatch = block.code.match(/\/\/\s*INSERT\s+BEFORE:\s*(.+?)(?:\n|$)/i);
    if (beforeMatch) {
      return {
        position: 'before',
        anchor: beforeMatch[1].trim()
      };
    }

    // Check for start/end positions
    if (block.code.match(/\/\/\s*INSERT\s+AT\s+START/i)) {
      return { position: 'start' };
    }

    if (block.code.match(/\/\/\s*INSERT\s+AT\s+END/i) || block.code.match(/\/\/\s*APPEND/i)) {
      return { position: 'end' };
    }

    // Default to end
    return { position: 'end' };
  }

  /**
   * Parse instruction comment
   */
  private parseInstructionComment(line: string, lineNumber: number): InlineInstruction | null {
    // TODO: instruction
    const todoMatch = line.match(/\/\/\s*TODO:\s*(.+)$/i);
    if (todoMatch) {
      return {
        type: 'todo',
        line: lineNumber,
        content: todoMatch[1].trim()
      };
    }

    // REPLACE: instruction
    const replaceMatch = line.match(/\/\/\s*REPLACE:\s*(.+)$/i);
    if (replaceMatch) {
      return {
        type: 'replace',
        line: lineNumber,
        content: replaceMatch[1].trim()
      };
    }

    // INSERT instruction
    const insertMatch = line.match(/\/\/\s*INSERT\s+(BEFORE|AFTER):\s*(.+)$/i);
    if (insertMatch) {
      return {
        type: 'insert',
        line: lineNumber,
        content: insertMatch[2].trim(),
        position: insertMatch[1].toLowerCase() as 'before' | 'after'
      };
    }

    // DELETE: instruction
    const deleteMatch = line.match(/\/\/\s*DELETE:\s*(.+)$/i);
    if (deleteMatch) {
      return {
        type: 'delete',
        line: lineNumber,
        content: deleteMatch[1].trim()
      };
    }

    return null;
  }

  /**
   * Build operation metadata
   */
  private buildMetadata(block: CodeBlock): OperationMetadata {
    const metadata: OperationMetadata = {
      description: block.metadata?.description,
      language: block.language,
      timestamp: new Date()
    };

    // Extract dependencies from imports
    if (block.language === 'typescript' || block.language === 'javascript') {
      metadata.dependencies = this.extractDependencies(block.code);
    }

    return metadata;
  }

  /**
   * Extract dependencies from code
   */
  private extractDependencies(code: string): string[] {
    const deps: Set<string> = new Set();

    // ES6 imports
    const importMatches = code.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      if (!match[1].startsWith('.')) {
        deps.add(match[1]);
      }
    }

    // CommonJS requires
    const requireMatches = code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of requireMatches) {
      if (!match[1].startsWith('.')) {
        deps.add(match[1]);
      }
    }

    return Array.from(deps);
  }

  /**
   * Resolve file path
   */
  private resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    if (this.workspaceRoot) {
      return path.join(this.workspaceRoot, filePath);
    }

    return filePath;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `fop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}