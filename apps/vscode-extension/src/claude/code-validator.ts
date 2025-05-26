import * as vscode from 'vscode';
import * as ts from 'typescript';
import { Logger } from './logger';
import { FileOperation, ValidationResult } from './code-extractor';

/**
 * Syntax validation result
 */
export interface SyntaxValidationResult extends ValidationResult {
  syntaxErrors: SyntaxError[];
  hasTypeErrors?: boolean;
}

/**
 * Structure validation result
 */
export interface StructureResult extends ValidationResult {
  missingImports: string[];
  unusedImports: string[];
  exportIssues: string[];
}

/**
 * Security validation result
 */
export interface SecurityResult extends ValidationResult {
  securityIssues: SecurityIssue[];
  riskScore: number; // 0-100
}

/**
 * Style validation result
 */
export interface StyleResult extends ValidationResult {
  styleViolations: StyleViolation[];
  formattingIssues: string[];
}

/**
 * Syntax error details
 */
export interface SyntaxError {
  line: number;
  column: number;
  message: string;
  code?: string;
}

/**
 * Security issue details
 */
export interface SecurityIssue {
  type: 'xss' | 'injection' | 'hardcoded-secret' | 'unsafe-eval' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  description: string;
  recommendation: string;
}

/**
 * Style violation details
 */
export interface StyleViolation {
  rule: string;
  line: number;
  message: string;
  fixable: boolean;
}

/**
 * Validates code syntax, structure, security, and style
 */
export class CodeValidator {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  // Security patterns to check
  private readonly securityPatterns = {
    eval: /\beval\s*\(/g,
    innerHTML: /\.innerHTML\s*=/g,
    dangerouslySetInnerHTML: /dangerouslySetInnerHTML/g,
    hardcodedSecrets: /(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][^"']+["']/gi,
    sqlInjection: /(?:SELECT|INSERT|UPDATE|DELETE).*\+.*(?:req\.|params\.|query\.)/gi,
    commandInjection: /(?:exec|spawn|system)\s*\([^)]*\+/g
  };

  // Common style patterns
  private readonly stylePatterns = {
    camelCase: /^[a-z][a-zA-Z0-9]*$/,
    pascalCase: /^[A-Z][a-zA-Z0-9]*$/,
    kebabCase: /^[a-z]+(?:-[a-z]+)*$/,
    snakeCase: /^[a-z]+(?:_[a-z]+)*$/
  };

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Code Validator');
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Validate code syntax
   */
  validateSyntax(code: string, language: string): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: []
    };

    switch (language.toLowerCase()) {
      case 'typescript':
      case 'tsx':
        return this.validateTypeScript(code, true);
      case 'javascript':
      case 'jsx':
        return this.validateJavaScript(code);
      case 'css':
      case 'scss':
      case 'sass':
        return this.validateCSS(code);
      case 'json':
        return this.validateJSON(code);
      case 'html':
        return this.validateHTML(code);
      default:
        result.warnings.push(`No syntax validation available for ${language}`);
        return result;
    }
  }

  /**
   * Validate file structure
   */
  validateFileStructure(operation: FileOperation): StructureResult {
    const result: StructureResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      missingImports: [],
      unusedImports: [],
      exportIssues: []
    };

    if (!operation.content) {
      return result;
    }

    const language = operation.metadata?.language || 'javascript';
    
    if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
      // Analyze imports and exports
      const importAnalysis = this.analyzeImports(operation.content);
      result.missingImports = importAnalysis.missing;
      result.unusedImports = importAnalysis.unused;

      // Check export structure
      const exportIssues = this.checkExports(operation.content);
      result.exportIssues = exportIssues;

      if (result.missingImports.length > 0) {
        result.errors.push(`Missing imports: ${result.missingImports.join(', ')}`);
        result.isValid = false;
      }

      if (result.unusedImports.length > 0) {
        result.warnings.push(`Unused imports: ${result.unusedImports.join(', ')}`);
      }
    }

    // Validate component structure for frameworks
    if (operation.metadata?.framework) {
      this.validateFrameworkStructure(operation, result);
    }

    return result;
  }

  /**
   * Check code for security issues
   */
  checkSecurity(code: string): SecurityResult {
    const result: SecurityResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      securityIssues: [],
      riskScore: 0
    };

    // Check for eval usage
    const evalMatches = code.matchAll(this.securityPatterns.eval);
    for (const match of evalMatches) {
      result.securityIssues.push({
        type: 'unsafe-eval',
        severity: 'high',
        line: this.getLineNumber(code, match.index!),
        description: 'Usage of eval() is dangerous and should be avoided',
        recommendation: 'Use JSON.parse() for JSON data or Function constructor for dynamic code'
      });
    }

    // Check for innerHTML usage
    const innerHTMLMatches = code.matchAll(this.securityPatterns.innerHTML);
    for (const match of innerHTMLMatches) {
      result.securityIssues.push({
        type: 'xss',
        severity: 'high',
        line: this.getLineNumber(code, match.index!),
        description: 'Direct innerHTML assignment can lead to XSS vulnerabilities',
        recommendation: 'Use textContent for text or sanitize HTML content'
      });
    }

    // Check for hardcoded secrets
    const secretMatches = code.matchAll(this.securityPatterns.hardcodedSecrets);
    for (const match of secretMatches) {
      result.securityIssues.push({
        type: 'hardcoded-secret',
        severity: 'critical',
        line: this.getLineNumber(code, match.index!),
        description: 'Hardcoded secrets detected in code',
        recommendation: 'Use environment variables or secure key management'
      });
    }

    // Calculate risk score
    result.riskScore = this.calculateRiskScore(result.securityIssues);
    
    if (result.securityIssues.length > 0) {
      result.warnings.push(`Found ${result.securityIssues.length} security issues`);
      if (result.riskScore > 70) {
        result.isValid = false;
        result.errors.push('Critical security issues detected');
      }
    }

    return result;
  }

  /**
   * Validate code style
   */
  validateStyle(code: string, language?: string): StyleResult {
    const result: StyleResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      styleViolations: [],
      formattingIssues: []
    };

    // Check indentation consistency
    const indentationIssues = this.checkIndentation(code);
    if (indentationIssues.length > 0) {
      result.formattingIssues.push(...indentationIssues);
    }

    // Check line length
    const longLines = this.checkLineLength(code, 120);
    if (longLines.length > 0) {
      result.styleViolations.push(...longLines.map(line => ({
        rule: 'max-line-length',
        line: line.number,
        message: `Line exceeds 120 characters (${line.length})`,
        fixable: false
      })));
    }

    // Check naming conventions for JavaScript/TypeScript
    if (!language || ['javascript', 'typescript', 'jsx', 'tsx'].includes(language)) {
      const namingIssues = this.checkNamingConventions(code);
      result.styleViolations.push(...namingIssues);
    }

    // Check for code smells
    const codeSmells = this.detectCodeSmells(code);
    if (codeSmells.length > 0) {
      result.warnings.push(...codeSmells);
    }

    if (result.styleViolations.length > 10) {
      result.suggestions.push('Consider using a code formatter like Prettier');
    }

    return result;
  }

  /**
   * Validate TypeScript code
   */
  private validateTypeScript(code: string, checkTypes: boolean): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: [],
      hasTypeErrors: false
    };

    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Check for syntax errors
      const syntaxErrors = this.findSyntaxErrors(sourceFile);
      result.syntaxErrors = syntaxErrors;

      if (syntaxErrors.length > 0) {
        result.isValid = false;
        result.errors = syntaxErrors.map(e => e.message);
      }

      // Basic type checking
      if (checkTypes) {
        const typeIssues = this.checkTypeScriptTypes(sourceFile);
        if (typeIssues.length > 0) {
          result.warnings.push(...typeIssues);
          result.hasTypeErrors = true;
        }
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`TypeScript parsing error: ${error}`);
    }

    return result;
  }

  /**
   * Validate JavaScript code
   */
  private validateJavaScript(code: string): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: []
    };

    try {
      // Use TypeScript parser for JavaScript too
      const sourceFile = ts.createSourceFile(
        'temp.js',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );

      const syntaxErrors = this.findSyntaxErrors(sourceFile);
      result.syntaxErrors = syntaxErrors;

      if (syntaxErrors.length > 0) {
        result.isValid = false;
        result.errors = syntaxErrors.map(e => e.message);
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`JavaScript parsing error: ${error}`);
    }

    return result;
  }

  /**
   * Validate CSS code
   */
  private validateCSS(code: string): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: []
    };

    // Basic CSS validation
    const braceCount = (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
    if (braceCount !== 0) {
      result.isValid = false;
      result.errors.push('Mismatched braces in CSS');
    }

    // Check for common CSS errors
    if (code.includes(';;')) {
      result.warnings.push('Double semicolon detected');
    }

    if (code.match(/:\s*;/)) {
      result.errors.push('Empty CSS property value');
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate JSON code
   */
  private validateJSON(code: string): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: []
    };

    try {
      JSON.parse(code);
    } catch (error: any) {
      result.isValid = false;
      result.errors.push(`JSON parsing error: ${error.message}`);
      
      // Try to extract line number from error
      const lineMatch = error.message.match(/position (\d+)/);
      if (lineMatch) {
        const position = parseInt(lineMatch[1], 10);
        const line = this.getLineNumber(code, position);
        result.syntaxErrors.push({
          line,
          column: 0,
          message: error.message
        });
      }
    }

    return result;
  }

  /**
   * Validate HTML code
   */
  private validateHTML(code: string): SyntaxValidationResult {
    const result: SyntaxValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
      syntaxErrors: []
    };

    // Check for unclosed tags
    const tagMatches = code.matchAll(/<(\w+)(?:\s[^>]*)?>|<\/(\w+)>/g);
    const tagStack: string[] = [];

    for (const match of tagMatches) {
      const openTag = match[1];
      const closeTag = match[2];

      if (openTag && !this.isSelfClosingTag(openTag)) {
        tagStack.push(openTag);
      } else if (closeTag) {
        const expectedTag = tagStack.pop();
        if (expectedTag !== closeTag) {
          result.errors.push(`Mismatched closing tag: expected </${expectedTag}>, found </${closeTag}>`);
          result.isValid = false;
        }
      }
    }

    if (tagStack.length > 0) {
      result.errors.push(`Unclosed tags: ${tagStack.join(', ')}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Find syntax errors in TypeScript AST
   */
  private findSyntaxErrors(sourceFile: ts.SourceFile): SyntaxError[] {
    const errors: SyntaxError[] = [];

    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.Unknown) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        errors.push({
          line: line + 1,
          column: character + 1,
          message: 'Unknown syntax'
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return errors;
  }

  /**
   * Check TypeScript types
   */
  private checkTypeScriptTypes(sourceFile: ts.SourceFile): string[] {
    const issues: string[] = [];

    const visit = (node: ts.Node) => {
      // Check for 'any' usage
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        issues.push('Usage of "any" type detected - consider using more specific types');
      }

      // Check for missing return types
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        if (!node.type) {
          issues.push(`Function "${node.name?.getText()}" is missing return type annotation`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return issues;
  }

  /**
   * Analyze imports
   */
  private analyzeImports(code: string): { missing: string[]; unused: string[] } {
    const imports = new Set<string>();
    const used = new Set<string>();

    // Extract imports
    const importMatches = code.matchAll(/import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from/g);
    for (const match of importMatches) {
      const namedImports = match[1]?.split(',').map(s => s.trim()) || [];
      const namespaceImport = match[2];
      const defaultImport = match[3];

      if (namespaceImport) imports.add(namespaceImport);
      if (defaultImport) imports.add(defaultImport);
      namedImports.forEach(name => imports.add(name.split(' as ')[0].trim()));
    }

    // Check usage (simplified)
    for (const imp of imports) {
      const usageRegex = new RegExp(`\\b${imp}\\b`, 'g');
      if ((code.match(usageRegex) || []).length > 1) { // More than just the import
        used.add(imp);
      }
    }

    const unused = Array.from(imports).filter(imp => !used.has(imp));
    const missing: string[] = []; // Would need more complex analysis

    return { missing, unused };
  }

  /**
   * Check exports
   */
  private checkExports(code: string): string[] {
    const issues: string[] = [];

    // Check for multiple default exports
    const defaultExports = (code.match(/export\s+default/g) || []).length;
    if (defaultExports > 1) {
      issues.push('Multiple default exports detected');
    }

    return issues;
  }

  /**
   * Validate framework-specific structure
   */
  private validateFrameworkStructure(operation: FileOperation, result: StructureResult): void {
    const framework = operation.metadata?.framework?.toLowerCase();
    const content = operation.content || '';

    switch (framework) {
      case 'react':
        if (!content.includes('import React') && !content.includes('import { ')) {
          result.warnings.push('React component missing React import');
        }
        break;
      case 'vue':
        if (!content.includes('<template>') && !content.includes('render(')) {
          result.warnings.push('Vue component missing template or render function');
        }
        break;
    }
  }

  /**
   * Calculate security risk score
   */
  private calculateRiskScore(issues: SecurityIssue[]): number {
    const weights = {
      critical: 40,
      high: 25,
      medium: 10,
      low: 5
    };

    let score = 0;
    for (const issue of issues) {
      score += weights[issue.severity];
    }

    return Math.min(score, 100);
  }

  /**
   * Check indentation consistency
   */
  private checkIndentation(code: string): string[] {
    const issues: string[] = [];
    const lines = code.split('\n');
    let indentSize: number | null = null;
    let indentChar: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;

      const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
      if (leadingWhitespace.length > 0) {
        // Detect indent character
        if (indentChar === null) {
          indentChar = leadingWhitespace[0];
        } else if (leadingWhitespace[0] !== indentChar) {
          issues.push(`Line ${i + 1}: Mixed indentation (spaces and tabs)`);
        }

        // Check indent size
        if (indentChar === ' ' && indentSize === null) {
          indentSize = leadingWhitespace.length;
        }
      }
    }

    return issues;
  }

  /**
   * Check line length
   */
  private checkLineLength(code: string, maxLength: number): { number: number; length: number }[] {
    const lines = code.split('\n');
    const longLines: { number: number; length: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > maxLength) {
        longLines.push({ number: i + 1, length: lines[i].length });
      }
    }

    return longLines;
  }

  /**
   * Check naming conventions
   */
  private checkNamingConventions(code: string): StyleViolation[] {
    const violations: StyleViolation[] = [];

    // Check variable names
    const varMatches = code.matchAll(/(?:const|let|var)\s+(\w+)/g);
    for (const match of varMatches) {
      const name = match[1];
      if (!this.stylePatterns.camelCase.test(name) && name !== name.toUpperCase()) {
        violations.push({
          rule: 'variable-naming',
          line: this.getLineNumber(code, match.index!),
          message: `Variable "${name}" should use camelCase`,
          fixable: true
        });
      }
    }

    // Check class names
    const classMatches = code.matchAll(/class\s+(\w+)/g);
    for (const match of classMatches) {
      const name = match[1];
      if (!this.stylePatterns.pascalCase.test(name)) {
        violations.push({
          rule: 'class-naming',
          line: this.getLineNumber(code, match.index!),
          message: `Class "${name}" should use PascalCase`,
          fixable: true
        });
      }
    }

    return violations;
  }

  /**
   * Detect code smells
   */
  private detectCodeSmells(code: string): string[] {
    const smells: string[] = [];

    // Long functions
    const functionMatches = code.matchAll(/function\s+\w+\s*\([^)]*\)\s*{|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>\s*{/g);
    for (const match of functionMatches) {
      const startIndex = match.index!;
      const functionBody = this.extractBlock(code, startIndex);
      const lineCount = functionBody.split('\n').length;
      
      if (lineCount > 50) {
        smells.push(`Long function detected (${lineCount} lines) - consider breaking it down`);
      }
    }

    // Deeply nested code
    const maxNesting = this.getMaxNestingLevel(code);
    if (maxNesting > 4) {
      smells.push(`Deep nesting detected (level ${maxNesting}) - consider refactoring`);
    }

    // Large files
    const lineCount = code.split('\n').length;
    if (lineCount > 500) {
      smells.push(`Large file (${lineCount} lines) - consider splitting into smaller modules`);
    }

    return smells;
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(code: string, index: number): number {
    return code.substring(0, index).split('\n').length;
  }

  /**
   * Extract block starting from index
   */
  private extractBlock(code: string, startIndex: number): string {
    let braceCount = 0;
    let inBlock = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < code.length; i++) {
      if (code[i] === '{') {
        braceCount++;
        inBlock = true;
      } else if (code[i] === '}') {
        braceCount--;
        if (braceCount === 0 && inBlock) {
          endIndex = i + 1;
          break;
        }
      }
    }

    return code.substring(startIndex, endIndex);
  }

  /**
   * Get maximum nesting level
   */
  private getMaxNestingLevel(code: string): number {
    let maxLevel = 0;
    let currentLevel = 0;

    for (const char of code) {
      if (char === '{') {
        currentLevel++;
        maxLevel = Math.max(maxLevel, currentLevel);
      } else if (char === '}') {
        currentLevel--;
      }
    }

    return maxLevel;
  }

  /**
   * Check if HTML tag is self-closing
   */
  private isSelfClosingTag(tag: string): boolean {
    const selfClosing = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
    return selfClosing.includes(tag.toLowerCase());
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}