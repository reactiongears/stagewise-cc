import { Logger } from './logger';
import * as vscode from 'vscode';
import { CodeBlock } from './streaming-parser';
import { MarkdownBlock } from './markdown-parser';

/**
 * Validation result for code blocks
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Extracted code analysis
 */
export interface CodeAnalysis {
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  dependencies: string[];
  framework?: string;
  hasTypeScript: boolean;
  hasJSX: boolean;
}

/**
 * Extracts and validates code from parsed markdown blocks
 */
export class CodeBlockExtractor {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  // Language validation patterns
  private readonly syntaxPatterns = {
    javascript: {
      basic: /^[\s\S]*$/,
      imports: /^import\s+.+from\s+['"].+['"];?$/m,
      exports: /^export\s+(?:default\s+)?(?:class|function|const|let|var)/m,
      strict: /^(?:\/\/.*|\/\*[\s\S]*?\*\/|import|export|const|let|var|function|class|if|for|while|return|throw|try|catch)[\s\S]*$/
    },
    typescript: {
      basic: /^[\s\S]*$/,
      typeAnnotations: /:\s*(?:string|number|boolean|void|any|unknown|never|\w+|{[^}]+}|\[[^\]]+\])/,
      interfaces: /^interface\s+\w+\s*{/m,
      types: /^type\s+\w+\s*=/m
    },
    python: {
      basic: /^[\s\S]*$/,
      imports: /^(?:import|from)\s+\w+/m,
      functions: /^def\s+\w+\s*\(/m,
      classes: /^class\s+\w+/m
    },
    css: {
      basic: /^[\s\S]*$/,
      selectors: /^[.#\w\[\]:,\s>~+*]+\s*{/m,
      properties: /[\w-]+\s*:\s*[^;]+;/
    }
  };

  // Dangerous patterns to check
  private readonly dangerousPatterns = {
    fileSystem: /(?:fs|path|child_process|exec|spawn|shell|cmd)/i,
    network: /(?:http|socket|net|request|fetch|axios)/i,
    eval: /(?:eval|Function|setTimeout|setInterval)\s*\(/,
    process: /process\.\w+/,
    globals: /(?:global|window|document)\.\w+/
  };

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Code Extractor');
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Extract code from a markdown block
   */
  extract(block: MarkdownBlock): CodeBlock {
    const cleanCode = this.cleanCodeContent(block.content);
    const language = this.detectLanguage(cleanCode, block.metadata?.language);
    const analysis = this.analyzeCode(cleanCode, language);

    const codeBlock: CodeBlock = {
      language,
      code: cleanCode,
      filePath: block.metadata?.filePath,
      operation: block.metadata?.operation || 'unknown',
      metadata: {
        lineNumbers: block.metadata?.lineNumbers,
        description: block.metadata?.title
      }
    };

    // Add analysis results to metadata
    if (analysis.framework) {
      codeBlock.metadata = {
        ...codeBlock.metadata,
        description: `${codeBlock.metadata?.description || ''} (${analysis.framework})`.trim()
      };
    }

    this.logger.debug(`Extracted ${language} code block: ${codeBlock.filePath || 'unnamed'}`);
    return codeBlock;
  }

  /**
   * Validate code content
   */
  validateCode(code: string, language: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Check for empty code
    if (!code || code.trim().length === 0) {
      result.isValid = false;
      result.errors.push('Code block is empty');
      return result;
    }

    // Check for incomplete code indicators
    if (this.hasIncompleteCode(code)) {
      result.warnings.push('Code appears to be incomplete or truncated');
    }

    // Language-specific validation
    const validator = this.getLanguageValidator(language);
    if (validator) {
      const langResult = validator(code);
      result.errors.push(...langResult.errors);
      result.warnings.push(...langResult.warnings);
      result.suggestions.push(...langResult.suggestions);
      if (langResult.errors.length > 0) {
        result.isValid = false;
      }
    }

    // Security checks
    const securityIssues = this.checkSecurityIssues(code);
    if (securityIssues.length > 0) {
      result.warnings.push(...securityIssues);
    }

    return result;
  }

  /**
   * Infer file type from content
   */
  inferFileType(content: string): string {
    // Check shebang
    const shebangMatch = content.match(/^#!.*\/(node|python|bash|sh)/);
    if (shebangMatch) {
      const interpreter = shebangMatch[1];
      return interpreter === 'node' ? 'javascript' : interpreter;
    }

    // Check for TypeScript
    if (this.syntaxPatterns.typescript.typeAnnotations.test(content) ||
        this.syntaxPatterns.typescript.interfaces.test(content) ||
        this.syntaxPatterns.typescript.types.test(content)) {
      return 'typescript';
    }

    // Check for JSX/TSX
    if (/<[A-Z]\w*/.test(content) || /<\/\w+>/.test(content)) {
      return this.syntaxPatterns.typescript.typeAnnotations.test(content) ? 'tsx' : 'jsx';
    }

    // Check for specific language patterns
    if (this.syntaxPatterns.python.imports.test(content) ||
        this.syntaxPatterns.python.functions.test(content)) {
      return 'python';
    }

    if (this.syntaxPatterns.css.selectors.test(content) ||
        this.syntaxPatterns.css.properties.test(content)) {
      return 'css';
    }

    // Default to JavaScript for ambiguous content
    return 'javascript';
  }

  /**
   * Extract imports from code
   */
  extractImports(code: string): string[] {
    const imports: Set<string> = new Set();

    // JavaScript/TypeScript imports
    const esImports = code.matchAll(/import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of esImports) {
      imports.add(match[1]);
    }

    // CommonJS requires
    const cjsRequires = code.matchAll(/(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of cjsRequires) {
      imports.add(match[1]);
    }

    // Python imports
    const pyImports = code.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
    for (const match of pyImports) {
      imports.add(match[1] || match[2]);
    }

    return Array.from(imports);
  }

  /**
   * Clean code content
   */
  private cleanCodeContent(content: string): string {
    let cleaned = content;

    // Remove markdown artifacts
    cleaned = cleaned.replace(/^```\w*\n?/gm, '');
    cleaned = cleaned.replace(/\n?```$/gm, '');

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n');

    // Remove trailing whitespace from each line
    cleaned = cleaned.split('\n')
      .map(line => line.trimEnd())
      .join('\n');

    // Remove excessive blank lines (more than 2)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim start and end
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Detect language from content
   */
  private detectLanguage(content: string, hint?: string): string {
    // Use hint if provided and valid
    if (hint && this.isValidLanguage(hint)) {
      return hint.toLowerCase();
    }

    // Try to infer from content
    return this.inferFileType(content);
  }

  /**
   * Analyze code for patterns and frameworks
   */
  private analyzeCode(code: string, language: string): CodeAnalysis {
    const analysis: CodeAnalysis = {
      imports: this.extractImports(code),
      exports: [],
      functions: [],
      classes: [],
      dependencies: [],
      hasTypeScript: false,
      hasJSX: false
    };

    // JavaScript/TypeScript specific analysis
    if (['javascript', 'typescript', 'jsx', 'tsx'].includes(language)) {
      // Extract exports
      const exportMatches = code.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g);
      for (const match of exportMatches) {
        analysis.exports.push(match[1]);
      }

      // Extract functions
      const functionMatches = code.matchAll(/(?:function|const|let|var)\s+(\w+)\s*(?:=\s*)?(?:\([^)]*\)|<[^>]*>)*\s*(?:=>|{)/g);
      for (const match of functionMatches) {
        analysis.functions.push(match[1]);
      }

      // Extract classes
      const classMatches = code.matchAll(/class\s+(\w+)/g);
      for (const match of classMatches) {
        analysis.classes.push(match[1]);
      }

      // Detect TypeScript
      analysis.hasTypeScript = this.syntaxPatterns.typescript.typeAnnotations.test(code);

      // Detect JSX
      analysis.hasJSX = /<[A-Z]\w*/.test(code) || /<\/\w+>/.test(code);

      // Detect framework
      if (analysis.imports.some(imp => imp.includes('react'))) {
        analysis.framework = 'React';
      } else if (analysis.imports.some(imp => imp.includes('vue'))) {
        analysis.framework = 'Vue';
      } else if (analysis.imports.some(imp => imp.includes('@angular'))) {
        analysis.framework = 'Angular';
      } else if (analysis.imports.some(imp => imp.includes('svelte'))) {
        analysis.framework = 'Svelte';
      }

      // Extract dependencies
      analysis.dependencies = analysis.imports.filter(imp => 
        !imp.startsWith('.') && !imp.startsWith('/')
      );
    }

    return analysis;
  }

  /**
   * Check for incomplete code
   */
  private hasIncompleteCode(code: string): boolean {
    // Check for unmatched brackets
    const brackets = { '{': 0, '[': 0, '(': 0 };
    const bracketPairs = { '{': '}', '[': ']', '(': ')' };

    for (const char of code) {
      if (char in brackets) {
        brackets[char as keyof typeof brackets]++;
      } else if (Object.values(bracketPairs).includes(char)) {
        const opening = Object.entries(bracketPairs).find(([_, closing]) => closing === char)?.[0];
        if (opening && opening in brackets) {
          brackets[opening as keyof typeof brackets]--;
        }
      }
    }

    // Check if any brackets are unmatched
    if (Object.values(brackets).some(count => count !== 0)) {
      return true;
    }

    // Check for common incomplete patterns
    const incompletePatterns = [
      /\.\.\./,  // Ellipsis indicating omitted code
      /\/\/ TODO/i,  // TODO comments
      /\/\/ FIXME/i,  // FIXME comments
      /\/\/ \.\.\./,  // Comment with ellipsis
      /^\s*\/\/ More code here/im  // Placeholder comments
    ];

    return incompletePatterns.some(pattern => pattern.test(code));
  }

  /**
   * Get language-specific validator
   */
  private getLanguageValidator(language: string): ((code: string) => ValidationResult) | null {
    const validators: Record<string, (code: string) => ValidationResult> = {
      javascript: (code) => this.validateJavaScript(code),
      typescript: (code) => this.validateTypeScript(code),
      python: (code) => this.validatePython(code),
      css: (code) => this.validateCSS(code)
    };

    return validators[language] || null;
  }

  /**
   * Validate JavaScript code
   */
  private validateJavaScript(code: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Check for common syntax errors
    if (code.includes('function(') && !code.includes('function (')) {
      result.suggestions.push('Consider adding space after "function" keyword');
    }

    // Check for missing semicolons (optional)
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') && 
          !line.startsWith('//') && !line.startsWith('*')) {
        // This is just a suggestion, not an error
        if (line.match(/^(const|let|var|return|import|export)\s+/)) {
          result.suggestions.push(`Line ${i + 1}: Consider adding semicolon`);
        }
      }
    }

    return result;
  }

  /**
   * Validate TypeScript code
   */
  private validateTypeScript(code: string): ValidationResult {
    const result = this.validateJavaScript(code);

    // Additional TypeScript checks
    if (code.includes('any') && !code.includes('// eslint-disable')) {
      result.warnings.push('Consider using more specific types instead of "any"');
    }

    return result;
  }

  /**
   * Validate Python code
   */
  private validatePython(code: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Check indentation consistency
    const lines = code.split('\n');
    let indentSize: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;

      const leadingSpaces = line.match(/^[ ]*/)?.[0].length || 0;
      if (leadingSpaces > 0) {
        if (indentSize === null) {
          indentSize = leadingSpaces;
        } else if (leadingSpaces % indentSize !== 0) {
          result.warnings.push(`Line ${i + 1}: Inconsistent indentation`);
        }
      }
    }

    return result;
  }

  /**
   * Validate CSS code
   */
  private validateCSS(code: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Check for missing closing braces
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
      result.errors.push('Mismatched braces in CSS');
      result.isValid = false;
    }

    return result;
  }

  /**
   * Check for security issues
   */
  private checkSecurityIssues(code: string): string[] {
    const issues: string[] = [];

    // Check for dangerous patterns
    for (const [category, pattern] of Object.entries(this.dangerousPatterns)) {
      if (pattern.test(code)) {
        issues.push(`Code contains potentially dangerous ${category} operations`);
      }
    }

    return issues;
  }

  /**
   * Check if language is valid
   */
  private isValidLanguage(language: string): boolean {
    const validLanguages = [
      'javascript', 'typescript', 'jsx', 'tsx', 'python', 'css', 'scss', 'sass',
      'html', 'xml', 'json', 'yaml', 'yml', 'markdown', 'md', 'plaintext',
      'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift',
      'kotlin', 'vue', 'svelte'
    ];

    return validLanguages.includes(language.toLowerCase());
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}