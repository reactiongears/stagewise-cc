import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';
import { FileOperation, OperationType, RiskLevel } from './code-extractor';

/**
 * Analysis result for a file operation
 */
export interface AnalysisResult {
  operation: FileOperation;
  risk: RiskLevel;
  impacts: Impact[];
  conflicts: Conflict[];
  suggestions: string[];
  requiresReview: boolean;
}

/**
 * Impact of a modification
 */
export interface Impact {
  type: 'dependency' | 'api' | 'test' | 'style' | 'structure';
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedFiles: string[];
}

/**
 * Conflict between operations
 */
export interface Conflict {
  type: 'file' | 'content' | 'dependency' | 'naming';
  operations: string[]; // Operation IDs
  description: string;
  resolution?: string;
}

/**
 * Alternative approach suggestion
 */
export interface Alternative {
  description: string;
  benefits: string[];
  drawbacks: string[];
  implementation?: string;
}

/**
 * Analyzes the impact and safety of file modifications
 */
export class ModificationAnalyzer {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private workspaceRoot: string;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Modification Analyzer');
    this.logger = new Logger(this.outputChannel);
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  /**
   * Analyze a file operation
   */
  async analyzeOperation(operation: FileOperation): Promise<AnalysisResult> {
    const impacts: Impact[] = [];
    const suggestions: string[] = [];

    // Analyze based on operation type
    switch (operation.type) {
      case OperationType.CREATE:
        impacts.push(...await this.analyzeCreateOperation(operation));
        break;
      case OperationType.UPDATE:
        impacts.push(...await this.analyzeUpdateOperation(operation));
        break;
      case OperationType.DELETE:
        impacts.push(...await this.analyzeDeleteOperation(operation));
        break;
      case OperationType.MOVE:
        impacts.push(...await this.analyzeMoveOperation(operation));
        break;
    }

    // Analyze code quality
    if (operation.content) {
      impacts.push(...this.analyzeCodeQuality(operation));
    }

    // Estimate risk level
    const risk = this.estimateRisk(operation, impacts);

    // Generate suggestions
    suggestions.push(...this.generateSuggestions(operation, impacts));

    const result: AnalysisResult = {
      operation,
      risk,
      impacts,
      conflicts: [], // Will be filled by detectConflicts
      suggestions,
      requiresReview: risk !== RiskLevel.LOW || impacts.some(i => i.severity === 'high')
    };

    this.logger.debug(`Analyzed operation ${operation.id}: Risk=${risk}, Impacts=${impacts.length}`);
    return result;
  }

  /**
   * Detect conflicts between operations
   */
  detectConflicts(operations: FileOperation[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < operations.length; i++) {
      for (let j = i + 1; j < operations.length; j++) {
        const conflict = this.checkOperationConflict(operations[i], operations[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    // Check for circular dependencies
    const circularConflicts = this.detectCircularDependencies(operations);
    conflicts.push(...circularConflicts);

    return conflicts;
  }

  /**
   * Estimate risk level for an operation
   */
  estimateRisk(operation: FileOperation, impacts?: Impact[]): RiskLevel {
    // Delete operations are always high risk
    if (operation.type === OperationType.DELETE) {
      return RiskLevel.HIGH;
    }

    // Check impacts if provided
    if (impacts) {
      const highImpacts = impacts.filter(i => i.severity === 'high').length;
      if (highImpacts > 0) {
        return RiskLevel.HIGH;
      }

      const mediumImpacts = impacts.filter(i => i.severity === 'medium').length;
      if (mediumImpacts > 1) {
        return RiskLevel.MEDIUM;
      }
    }

    // Check file criticality
    const criticalPaths = [
      'package.json',
      'tsconfig.json',
      '.env',
      'config',
      'security',
      'auth'
    ];

    const targetPath = operation.targetPath.toLowerCase();
    if (criticalPaths.some(critical => targetPath.includes(critical))) {
      return RiskLevel.HIGH;
    }

    // Check for breaking changes in content
    if (operation.content && this.hasBreakingChanges(operation.content)) {
      return RiskLevel.MEDIUM;
    }

    return RiskLevel.LOW;
  }

  /**
   * Suggest alternatives for an operation
   */
  suggestAlternatives(operation: FileOperation): Alternative[] {
    const alternatives: Alternative[] = [];

    // Suggest alternatives based on operation type and risk
    if (operation.type === OperationType.DELETE && this.estimateRisk(operation) === RiskLevel.HIGH) {
      alternatives.push({
        description: 'Archive the file instead of deleting',
        benefits: ['Preserves history', 'Allows recovery', 'Safer approach'],
        drawbacks: ['Requires cleanup later', 'May cause confusion'],
        implementation: `mv ${operation.targetPath} ${operation.targetPath}.archived`
      });
    }

    if (operation.type === OperationType.UPDATE && operation.content) {
      const lines = operation.content.split('\n').length;
      if (lines > 100) {
        alternatives.push({
          description: 'Split into smaller, focused updates',
          benefits: ['Easier to review', 'Lower risk', 'Better git history'],
          drawbacks: ['More operations to manage', 'Might miss context']
        });
      }
    }

    return alternatives;
  }

  /**
   * Analyze create operation
   */
  private async analyzeCreateOperation(operation: FileOperation): Promise<Impact[]> {
    const impacts: Impact[] = [];
    const targetPath = operation.targetPath;

    // Check if file already exists
    if (await this.fileExists(targetPath)) {
      impacts.push({
        type: 'structure',
        severity: 'high',
        description: 'File already exists and will be overwritten',
        affectedFiles: [targetPath]
      });
    }

    // Check naming conflicts
    const fileName = path.basename(targetPath);
    const similarFiles = await this.findSimilarFiles(fileName);
    if (similarFiles.length > 0) {
      impacts.push({
        type: 'structure',
        severity: 'medium',
        description: `Similar files exist: ${similarFiles.join(', ')}`,
        affectedFiles: similarFiles
      });
    }

    return impacts;
  }

  /**
   * Analyze update operation
   */
  private async analyzeUpdateOperation(operation: FileOperation): Promise<Impact[]> {
    const impacts: Impact[] = [];

    // Check if file exists
    if (!await this.fileExists(operation.targetPath)) {
      impacts.push({
        type: 'structure',
        severity: 'high',
        description: 'Target file does not exist',
        affectedFiles: [operation.targetPath]
      });
      return impacts;
    }

    // Analyze API changes
    if (operation.content && this.hasApiChanges(operation.content)) {
      impacts.push({
        type: 'api',
        severity: 'high',
        description: 'API changes detected that may break dependent code',
        affectedFiles: await this.findDependentFiles(operation.targetPath)
      });
    }

    // Check test impact
    const testFiles = await this.findRelatedTestFiles(operation.targetPath);
    if (testFiles.length > 0) {
      impacts.push({
        type: 'test',
        severity: 'medium',
        description: 'Related test files may need updates',
        affectedFiles: testFiles
      });
    }

    return impacts;
  }

  /**
   * Analyze delete operation
   */
  private async analyzeDeleteOperation(operation: FileOperation): Promise<Impact[]> {
    const impacts: Impact[] = [];

    // Find all files that import/depend on this file
    const dependentFiles = await this.findDependentFiles(operation.targetPath);
    if (dependentFiles.length > 0) {
      impacts.push({
        type: 'dependency',
        severity: 'high',
        description: `${dependentFiles.length} files depend on this file`,
        affectedFiles: dependentFiles
      });
    }

    // Check if it's a critical file
    if (this.isCriticalFile(operation.targetPath)) {
      impacts.push({
        type: 'structure',
        severity: 'high',
        description: 'This is a critical system file',
        affectedFiles: [operation.targetPath]
      });
    }

    return impacts;
  }

  /**
   * Analyze move operation
   */
  private async analyzeMoveOperation(operation: FileOperation): Promise<Impact[]> {
    const impacts: Impact[] = [];

    // All dependent files will need import updates
    const dependentFiles = await this.findDependentFiles(operation.sourcePath || operation.targetPath);
    if (dependentFiles.length > 0) {
      impacts.push({
        type: 'dependency',
        severity: 'medium',
        description: `${dependentFiles.length} imports need to be updated`,
        affectedFiles: dependentFiles
      });
    }

    return impacts;
  }

  /**
   * Analyze code quality
   */
  private analyzeCodeQuality(operation: FileOperation): Impact[] {
    const impacts: Impact[] = [];
    const content = operation.content || '';

    // Check for code smells
    if (content.includes('any') && operation.metadata?.language === 'typescript') {
      impacts.push({
        type: 'style',
        severity: 'low',
        description: 'Usage of "any" type detected in TypeScript',
        affectedFiles: [operation.targetPath]
      });
    }

    // Check for TODO comments
    const todoCount = (content.match(/TODO:/gi) || []).length;
    if (todoCount > 3) {
      impacts.push({
        type: 'style',
        severity: 'low',
        description: `${todoCount} TODO comments found`,
        affectedFiles: [operation.targetPath]
      });
    }

    return impacts;
  }

  /**
   * Check for conflicts between two operations
   */
  private checkOperationConflict(op1: FileOperation, op2: FileOperation): Conflict | null {
    // Same file conflict
    if (op1.targetPath === op2.targetPath) {
      return {
        type: 'file',
        operations: [op1.id, op2.id],
        description: 'Both operations target the same file',
        resolution: 'Merge operations or apply sequentially'
      };
    }

    // Move/delete conflict
    if (op1.type === OperationType.MOVE && op2.type === OperationType.DELETE) {
      if (op1.sourcePath === op2.targetPath) {
        return {
          type: 'file',
          operations: [op1.id, op2.id],
          description: 'Cannot move a file that is being deleted',
          resolution: 'Remove the move operation'
        };
      }
    }

    return null;
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(operations: FileOperation[]): Conflict[] {
    // This would require more complex analysis of import statements
    // For now, return empty array
    return [];
  }

  /**
   * Check if file has breaking changes
   */
  private hasBreakingChanges(content: string): boolean {
    // Look for patterns that indicate breaking changes
    const breakingPatterns = [
      /export\s+(?:class|interface|type)\s+\w+/,  // Changed exports
      /function\s+\w+\s*\([^)]*\)/,               // Changed function signatures
      /@deprecated/i,                              // Deprecation notices
      /BREAKING\s*CHANGE/i                        // Explicit breaking change comments
    ];

    return breakingPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check if file has API changes
   */
  private hasApiChanges(content: string): boolean {
    return content.includes('export') && (
      content.includes('function') ||
      content.includes('class') ||
      content.includes('interface')
    );
  }

  /**
   * Generate suggestions based on analysis
   */
  private generateSuggestions(operation: FileOperation, impacts: Impact[]): string[] {
    const suggestions: string[] = [];

    // High risk suggestions
    if (impacts.some(i => i.severity === 'high')) {
      suggestions.push('Review this change carefully before applying');
      suggestions.push('Consider creating a backup before proceeding');
    }

    // Test-related suggestions
    if (impacts.some(i => i.type === 'test')) {
      suggestions.push('Run related tests after applying this change');
      suggestions.push('Update test files to match the changes');
    }

    // API change suggestions
    if (impacts.some(i => i.type === 'api')) {
      suggestions.push('Update all dependent files to match API changes');
      suggestions.push('Consider adding deprecation notices for gradual migration');
    }

    return suggestions;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find similar files in workspace
   */
  private async findSimilarFiles(fileName: string): Promise<string[]> {
    const baseName = path.basename(fileName, path.extname(fileName));
    const pattern = `**/*${baseName}*`;
    
    try {
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 10);
      return files.map(uri => vscode.workspace.asRelativePath(uri));
    } catch {
      return [];
    }
  }

  /**
   * Find files that depend on the given file
   */
  private async findDependentFiles(filePath: string): Promise<string[]> {
    const fileName = path.basename(filePath, path.extname(filePath));
    const relativePath = vscode.workspace.asRelativePath(filePath);
    
    // Search for import statements
    const patterns = [
      `from ['"].*${fileName}['"]`,
      `require\\(['"].*${fileName}['"]\\)`,
      `import.*${fileName}`
    ];

    const dependents: Set<string> = new Set();

    for (const pattern of patterns) {
      try {
        const files = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx}', '**/node_modules/**');
        for (const file of files) {
          const content = await this.readFile(file.fsPath);
          if (new RegExp(pattern).test(content)) {
            dependents.add(vscode.workspace.asRelativePath(file));
          }
        }
      } catch (error) {
        this.logger.error('Error finding dependent files', error);
      }
    }

    return Array.from(dependents);
  }

  /**
   * Find related test files
   */
  private async findRelatedTestFiles(filePath: string): Promise<string[]> {
    const baseName = path.basename(filePath, path.extname(filePath));
    const testPatterns = [
      `**/${baseName}.test.*`,
      `**/${baseName}.spec.*`,
      `**/__tests__/${baseName}.*`,
      `**/test/${baseName}.*`
    ];

    const testFiles: Set<string> = new Set();

    for (const pattern of testPatterns) {
      try {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        files.forEach(file => testFiles.add(vscode.workspace.asRelativePath(file)));
      } catch {
        // Ignore errors
      }
    }

    return Array.from(testFiles);
  }

  /**
   * Check if file is critical
   */
  private isCriticalFile(filePath: string): boolean {
    const criticalFiles = [
      'package.json',
      'tsconfig.json',
      '.env',
      '.gitignore',
      'webpack.config',
      'vite.config',
      'index.html',
      'main.ts',
      'main.js',
      'app.ts',
      'app.js'
    ];

    const fileName = path.basename(filePath);
    return criticalFiles.some(critical => fileName.includes(critical));
  }

  /**
   * Read file content
   */
  private async readFile(filePath: string): Promise<string> {
    try {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(content).toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}