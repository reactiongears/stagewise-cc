import { EventEmitter } from 'node:events';
import { Logger } from './logger';
import * as vscode from 'vscode';

/**
 * Represents a parsed code block from Claude's response
 */
export interface CodeBlock {
  language: string;
  code: string;
  filePath?: string;
  operation: 'create' | 'update' | 'delete' | 'unknown';
  metadata?: {
    lineNumbers?: { start: number; end: number };
    description?: string;
  };
}

/**
 * Parser state for tracking streaming progress
 */
export interface ParserState {
  isInCodeBlock: boolean;
  currentBlockLanguage?: string;
  currentBlockFilePath?: string;
  currentBlockContent: string[];
  processedChars: number;
  completeBlocks: CodeBlock[];
}

/**
 * Handles real-time streaming responses from Claude Code CLI
 */
export class StreamingResponseParser extends EventEmitter {
  private buffer = '';
  private state: ParserState;
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    super();
    this.outputChannel = vscode.window.createOutputChannel(
      'Claude Streaming Parser',
    );
    this.logger = new Logger(this.outputChannel);
    this.state = this.initializeState();
  }

  /**
   * Process a new chunk of streaming data
   */
  process(chunk: string): void {
    this.buffer += chunk;
    this.logger.debug(`Processing chunk of ${chunk.length} characters`);

    // Process complete lines
    const lines = this.extractCompleteLines();
    for (const line of lines) {
      this.processLine(line);
    }

    // Check for complete code blocks
    this.checkForCompleteBlocks();
  }

  /**
   * Get current parser state
   */
  getCurrentState(): ParserState {
    return { ...this.state };
  }

  /**
   * Reset parser to initial state
   */
  reset(): void {
    this.buffer = '';
    this.state = this.initializeState();
    this.logger.info('Parser state reset');
  }

  /**
   * Get all complete code blocks parsed so far
   */
  getCompleteBlocks(): CodeBlock[] {
    return [...this.state.completeBlocks];
  }

  /**
   * Initialize parser state
   */
  private initializeState(): ParserState {
    return {
      isInCodeBlock: false,
      currentBlockContent: [],
      processedChars: 0,
      completeBlocks: [],
    };
  }

  /**
   * Extract complete lines from buffer
   */
  private extractCompleteLines(): string[] {
    const lines: string[] = [];
    let newlineIndex: number = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      lines.push(line);
      this.buffer = this.buffer.substring(newlineIndex + 1);
      this.state.processedChars += line.length + 1;
      newlineIndex = this.buffer.indexOf('\n');
    }

    return lines;
  }

  /**
   * Process a single line
   */
  private processLine(line: string): void {
    const trimmedLine = line.trim();

    // Check for code block boundaries
    if (trimmedLine.startsWith('```')) {
      if (this.state.isInCodeBlock) {
        // End of code block
        this.finalizeCodeBlock();
      } else {
        // Start of code block
        this.startCodeBlock(trimmedLine);
      }
    } else if (this.state.isInCodeBlock) {
      // Add line to current code block
      this.state.currentBlockContent.push(line);
    } else {
      // Regular text line
      this.emit('textChunk', line);
    }
  }

  /**
   * Start a new code block
   */
  private startCodeBlock(line: string): void {
    this.state.isInCodeBlock = true;
    this.state.currentBlockContent = [];

    // Parse code block header
    const headerMatch = line.match(/^```(\w+)?\s*(.*)$/);
    if (headerMatch) {
      this.state.currentBlockLanguage = headerMatch[1] || 'plaintext';
      const metadata = headerMatch[2];

      // Extract file path if present
      if (metadata) {
        // Check for file path pattern
        const filePathMatch = metadata.match(/^([\w\-./]+\.\w+)/);
        if (filePathMatch) {
          this.state.currentBlockFilePath = filePathMatch[1];
        }
      }
    }

    this.logger.debug(
      `Started code block: language=${this.state.currentBlockLanguage}, file=${this.state.currentBlockFilePath}`,
    );
  }

  /**
   * Finalize current code block
   */
  private finalizeCodeBlock(): void {
    if (!this.state.isInCodeBlock) return;

    const codeBlock: CodeBlock = {
      language: this.state.currentBlockLanguage || 'plaintext',
      code: this.state.currentBlockContent.join('\n'),
      filePath: this.state.currentBlockFilePath,
      operation: this.inferOperation(),
    };

    // Add metadata if available
    if (this.state.currentBlockContent.length > 0) {
      const firstLine = this.state.currentBlockContent[0];
      if (firstLine.includes('Update') || firstLine.includes('update')) {
        codeBlock.operation = 'update';
      } else if (firstLine.includes('Create') || firstLine.includes('create')) {
        codeBlock.operation = 'create';
      } else if (firstLine.includes('Delete') || firstLine.includes('delete')) {
        codeBlock.operation = 'delete';
      }
    }

    this.state.completeBlocks.push(codeBlock);
    this.emit('codeBlock', codeBlock);

    // Reset state
    this.state.isInCodeBlock = false;
    this.state.currentBlockLanguage = undefined;
    this.state.currentBlockFilePath = undefined;
    this.state.currentBlockContent = [];

    this.logger.info(
      `Completed code block: ${codeBlock.filePath || 'unnamed'} (${codeBlock.operation})`,
    );
  }

  /**
   * Infer operation type from context
   */
  private inferOperation(): 'create' | 'update' | 'delete' | 'unknown' {
    // Look for operation hints in the content
    const content = this.state.currentBlockContent.join('\n').toLowerCase();

    if (content.includes('create new file') || content.includes('new file')) {
      return 'create';
    } else if (
      content.includes('update') ||
      content.includes('modify') ||
      content.includes('change')
    ) {
      return 'update';
    } else if (content.includes('delete') || content.includes('remove')) {
      return 'delete';
    }

    // Default based on file existence (would need to check this externally)
    return 'unknown';
  }

  /**
   * Check for complete blocks in buffer
   */
  private checkForCompleteBlocks(): void {
    // Check if buffer contains a complete code block
    const bufferContent = this.buffer;
    const codeBlockRegex = /```[\s\S]*?```/g;
    const matches = bufferContent.match(codeBlockRegex);

    if (matches) {
      for (const match of matches) {
        // Process complete blocks found in buffer
        const lines = match.split('\n');
        for (const line of lines) {
          this.processLine(line);
        }

        // Remove processed block from buffer
        this.buffer = this.buffer.replace(match, '');
      }
    }
  }

  /**
   * Handle stream completion
   */
  complete(): void {
    // Process any remaining buffer content
    if (this.buffer.length > 0) {
      const remainingLines = this.buffer.split('\n');
      for (const line of remainingLines) {
        this.processLine(line);
      }
      this.buffer = '';
    }

    // Finalize any open code block
    if (this.state.isInCodeBlock) {
      this.finalizeCodeBlock();
    }

    this.emit('complete', this.state.completeBlocks);
    this.logger.info(
      `Parsing complete. Total blocks: ${this.state.completeBlocks.length}`,
    );
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.removeAllListeners();
    this.outputChannel.dispose();
  }
}
