import { Logger } from './logger';
import * as vscode from 'vscode';
import { CodeBlock } from './streaming-parser';

/**
 * Represents a file modification instruction
 */
export interface FileInstruction {
  type: 'create' | 'update' | 'delete' | 'rename' | 'move';
  sourcePath?: string;
  targetPath: string;
  description?: string;
  lineRange?: { start: number; end: number };
}

/**
 * Metadata extracted from code block headers
 */
export interface BlockMetadata {
  language: string;
  filePath?: string;
  operation: 'create' | 'update' | 'delete' | 'unknown';
  lineNumbers?: { start: number; end: number };
  title?: string;
}

/**
 * Parsed markdown block
 */
export interface MarkdownBlock {
  type: 'code' | 'text' | 'heading';
  content: string;
  metadata?: BlockMetadata;
}

/**
 * Parses Claude's markdown response format
 */
export class MarkdownParser {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  // Common patterns in Claude responses
  private readonly patterns = {
    codeBlock: /^```(\w+)?(?:\s+(.+))?\n([\s\S]*?)```$/gm,
    fileInstruction: /(?:create|update|modify|delete|rename|move)\s+(?:file\s+)?[`']?([^\s`']+)[`']?/gi,
    filePath: /(?:^|\s)([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)(?:\s|$)/g,
    lineNumbers: /(?:lines?\s+)?(\d+)(?:\s*[-–]\s*(\d+))?/i,
    importStatement: /^(?:import|from|require)\s+.+$/gm,
    functionDeclaration: /(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g
  };

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Markdown Parser');
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Parse code blocks from markdown content
   */
  parseCodeBlocks(markdown: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const regex = new RegExp(this.patterns.codeBlock);
    let match;

    while ((match = regex.exec(markdown)) !== null) {
      const [fullMatch, language, header, code] = match;
      const metadata = this.parseMetadata(header || '');

      blocks.push({
        language: language || metadata.language || 'plaintext',
        code: code.trim(),
        filePath: metadata.filePath,
        operation: metadata.operation,
        metadata: {
          lineNumbers: metadata.lineNumbers,
          description: metadata.title
        }
      });
    }

    this.logger.debug(`Parsed ${blocks.length} code blocks from markdown`);
    return blocks;
  }

  /**
   * Extract file modification instructions from text
   */
  extractFileInstructions(text: string): FileInstruction[] {
    const instructions: FileInstruction[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const instruction = this.parseInstructionLine(line);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    // Deduplicate instructions
    const uniqueInstructions = this.deduplicateInstructions(instructions);
    
    this.logger.debug(`Extracted ${uniqueInstructions.length} file instructions`);
    return uniqueInstructions;
  }

  /**
   * Parse metadata from code block header
   */
  parseMetadata(blockHeader: string): BlockMetadata {
    const metadata: BlockMetadata = {
      language: 'plaintext',
      operation: 'unknown'
    };

    if (!blockHeader) {
      return metadata;
    }

    // Extract file path
    const filePathMatch = blockHeader.match(/([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/);
    if (filePathMatch) {
      metadata.filePath = filePathMatch[1];
    }

    // Extract language (first word if not a file path)
    const words = blockHeader.split(/\s+/);
    if (words.length > 0 && !words[0].includes('.')) {
      metadata.language = words[0];
    }

    // Extract line numbers
    const lineMatch = blockHeader.match(this.patterns.lineNumbers);
    if (lineMatch) {
      metadata.lineNumbers = {
        start: parseInt(lineMatch[1], 10),
        end: lineMatch[2] ? parseInt(lineMatch[2], 10) : parseInt(lineMatch[1], 10)
      };
    }

    // Detect operation from header
    if (blockHeader.match(/\b(create|new)\b/i)) {
      metadata.operation = 'create';
    } else if (blockHeader.match(/\b(update|modify|change|edit)\b/i)) {
      metadata.operation = 'update';
    } else if (blockHeader.match(/\b(delete|remove)\b/i)) {
      metadata.operation = 'delete';
    }

    // Extract title/description
    const titleMatch = blockHeader.match(/[–-]\s*(.+)$/);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Extract file paths from text
   */
  extractFilePaths(text: string): string[] {
    const paths: Set<string> = new Set();
    let match;

    // Look for explicit file paths
    const filePathRegex = new RegExp(this.patterns.filePath, 'g');
    while ((match = filePathRegex.exec(text)) !== null) {
      const path = match[1];
      if (this.isValidFilePath(path)) {
        paths.add(path);
      }
    }

    // Look for paths in backticks
    const backtickRegex = /`([^`]+)`/g;
    while ((match = backtickRegex.exec(text)) !== null) {
      const content = match[1];
      if (this.isValidFilePath(content)) {
        paths.add(content);
      }
    }

    return Array.from(paths);
  }

  /**
   * Parse a single instruction line
   */
  private parseInstructionLine(line: string): FileInstruction | null {
    const trimmedLine = line.trim().toLowerCase();

    // Skip non-instruction lines
    if (!trimmedLine || trimmedLine.length < 5) {
      return null;
    }

    let type: FileInstruction['type'] = 'update';
    let targetPath: string | undefined;
    let sourcePath: string | undefined;

    // Detect operation type
    if (trimmedLine.includes('create') || trimmedLine.includes('new file')) {
      type = 'create';
    } else if (trimmedLine.includes('delete') || trimmedLine.includes('remove')) {
      type = 'delete';
    } else if (trimmedLine.includes('rename')) {
      type = 'rename';
    } else if (trimmedLine.includes('move')) {
      type = 'move';
    }

    // Extract file paths
    const paths = this.extractFilePaths(line);
    if (paths.length === 0) {
      return null;
    }

    if (type === 'rename' || type === 'move') {
      if (paths.length >= 2) {
        sourcePath = paths[0];
        targetPath = paths[1];
      } else {
        return null;
      }
    } else {
      targetPath = paths[0];
    }

    // Extract line range
    const lineMatch = line.match(this.patterns.lineNumbers);
    const lineRange = lineMatch ? {
      start: parseInt(lineMatch[1], 10),
      end: lineMatch[2] ? parseInt(lineMatch[2], 10) : parseInt(lineMatch[1], 10)
    } : undefined;

    return {
      type,
      targetPath,
      sourcePath,
      description: line,
      lineRange
    };
  }

  /**
   * Check if a string is a valid file path
   */
  private isValidFilePath(path: string): boolean {
    // Basic validation
    if (!path || path.length < 3 || path.length > 255) {
      return false;
    }

    // Must have an extension
    if (!path.includes('.')) {
      return false;
    }

    // Check for invalid characters
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(path)) {
      return false;
    }

    // Check for common file extensions
    const validExtensions = [
      'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'scss', 'sass',
      'html', 'xml', 'yaml', 'yml', 'txt', 'py', 'java', 'c', 'cpp',
      'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'vue',
      'svelte', 'astro'
    ];

    const extension = path.split('.').pop()?.toLowerCase();
    return extension ? validExtensions.includes(extension) : false;
  }

  /**
   * Deduplicate file instructions
   */
  private deduplicateInstructions(instructions: FileInstruction[]): FileInstruction[] {
    const seen = new Map<string, FileInstruction>();

    for (const instruction of instructions) {
      const key = `${instruction.type}:${instruction.targetPath}`;
      if (!seen.has(key)) {
        seen.set(key, instruction);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Analyze code content for patterns
   */
  analyzeCode(code: string, language: string): {
    imports: string[];
    exports: string[];
    functions: string[];
    classes: string[];
  } {
    const analysis = {
      imports: [] as string[],
      exports: [] as string[],
      functions: [] as string[],
      classes: [] as string[]
    };

    // Language-specific parsing
    if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
      // Extract imports
      const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        analysis.imports.push(match[1]);
      }

      // Extract exports
      const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
      while ((match = exportRegex.exec(code)) !== null) {
        analysis.exports.push(match[1]);
      }

      // Extract functions
      const functionRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*)?(?:\([^)]*\)|<[^>]*>)*\s*(?:=>|{)/g;
      while ((match = functionRegex.exec(code)) !== null) {
        analysis.functions.push(match[1]);
      }

      // Extract classes
      const classRegex = /class\s+(\w+)/g;
      while ((match = classRegex.exec(code)) !== null) {
        analysis.classes.push(match[1]);
      }
    }

    return analysis;
  }

  /**
   * Parse step-by-step instructions from Claude response
   */
  parseSteps(text: string): string[] {
    const steps: string[] = [];
    const lines = text.split('\n');

    // Look for numbered steps
    const numberedStepRegex = /^\s*\d+[\.)]\s+(.+)$/;
    // Look for bulleted steps
    const bulletedStepRegex = /^\s*[-*]\s+(.+)$/;

    for (const line of lines) {
      let match = line.match(numberedStepRegex);
      if (match) {
        steps.push(match[1].trim());
        continue;
      }

      match = line.match(bulletedStepRegex);
      if (match) {
        steps.push(match[1].trim());
      }
    }

    return steps;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}