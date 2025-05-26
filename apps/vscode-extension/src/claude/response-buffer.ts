import { Logger } from './logger';
import * as vscode from 'vscode';

/**
 * Configuration for response buffer
 */
export interface BufferConfig {
  maxSize: number; // Maximum buffer size in bytes
  flushThreshold: number; // Auto-flush when this percentage full
  enableCompression: boolean; // Compress whitespace in non-code sections
}

/**
 * Manages streaming response buffering with smart boundary detection
 */
export class ResponseBuffer {
  private buffer = '';
  private processedLength = 0;
  private config: BufferConfig;
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  private metrics = {
    totalBytesProcessed: 0,
    chunksReceived: 0,
    blocksExtracted: 0,
  };

  constructor(config?: Partial<BufferConfig>) {
    this.config = {
      maxSize: 10 * 1024 * 1024, // 10MB default
      flushThreshold: 0.8, // Flush at 80% capacity
      enableCompression: true,
      ...config,
    };

    this.outputChannel = vscode.window.createOutputChannel(
      'Claude Response Buffer',
    );
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Append new chunk to buffer
   */
  append(chunk: string): void {
    // Handle Unicode boundaries
    const safeChunk = this.ensureUnicodeBoundary(chunk);

    this.buffer += safeChunk;
    this.metrics.chunksReceived++;
    this.metrics.totalBytesProcessed += safeChunk.length;

    // Check buffer size
    if (this.buffer.length > this.config.maxSize * this.config.flushThreshold) {
      this.logger.warning(
        'Buffer approaching maximum size, triggering auto-flush',
      );
      this.autoFlush();
    }

    this.logger.debug(
      `Appended ${safeChunk.length} bytes, buffer size: ${this.buffer.length}`,
    );
  }

  /**
   * Extract complete lines from buffer
   */
  extractCompleteLines(): string[] {
    const lines: string[] = [];
    const lastNewlineIndex = this.buffer.lastIndexOf('\n');

    if (lastNewlineIndex === -1) {
      return lines;
    }

    // Extract all complete lines
    const completeContent = this.buffer.substring(0, lastNewlineIndex + 1);
    const remainingContent = this.buffer.substring(lastNewlineIndex + 1);

    // Split into lines
    lines.push(...completeContent.split('\n').filter((line) => line !== ''));

    // Update buffer with remaining content
    this.buffer = remainingContent;
    this.processedLength += completeContent.length;

    return lines;
  }

  /**
   * Extract complete markdown code blocks
   */
  extractCompleteBlocks(): string[] {
    const blocks: string[] = [];
    const codeBlockRegex = /```[\s\S]*?```/g;

    let match;
    let lastIndex = 0;
    const newBuffer: string[] = [];

    while ((match = codeBlockRegex.exec(this.buffer)) !== null) {
      // Add content before the match to new buffer
      if (match.index > lastIndex) {
        newBuffer.push(this.buffer.substring(lastIndex, match.index));
      }

      // Extract the complete block
      blocks.push(match[0]);
      this.metrics.blocksExtracted++;

      lastIndex = match.index + match[0].length;
    }

    // Add remaining content to new buffer
    if (lastIndex < this.buffer.length) {
      newBuffer.push(this.buffer.substring(lastIndex));
    }

    // Update buffer with non-block content
    this.buffer = newBuffer.join('');

    // Compress whitespace if enabled
    if (this.config.enableCompression && this.buffer.length > 1000) {
      this.buffer = this.compressWhitespace(this.buffer);
    }

    return blocks;
  }

  /**
   * Peek at buffer content without modifying it
   */
  peek(length: number): string {
    return this.buffer.substring(0, Math.min(length, this.buffer.length));
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    const previousSize = this.buffer.length;
    this.buffer = '';
    this.processedLength = 0;
    this.logger.info(`Buffer cleared, released ${previousSize} bytes`);
  }

  /**
   * Get current buffer state
   */
  getState() {
    return {
      size: this.buffer.length,
      processedLength: this.processedLength,
      metrics: { ...this.metrics },
      isFull: this.buffer.length >= this.config.maxSize,
      fillPercentage: (this.buffer.length / this.config.maxSize) * 100,
    };
  }

  /**
   * Ensure chunk ends at valid Unicode boundary
   */
  private ensureUnicodeBoundary(chunk: string): string {
    // Check if chunk ends with incomplete UTF-8 sequence
    const bytes = Buffer.from(chunk);
    let truncateBytes = 0;

    // Check last 4 bytes for incomplete UTF-8 sequences
    for (let i = Math.max(0, bytes.length - 4); i < bytes.length; i++) {
      const byte = bytes[i];

      // UTF-8 continuation byte
      if ((byte & 0xc0) === 0x80) {
        continue;
      }

      // Start of multi-byte sequence
      if ((byte & 0xe0) === 0xc0) {
        // 2-byte sequence
        if (i + 1 >= bytes.length) {
          truncateBytes = bytes.length - i;
          break;
        }
      } else if ((byte & 0xf0) === 0xe0) {
        // 3-byte sequence
        if (i + 2 >= bytes.length) {
          truncateBytes = bytes.length - i;
          break;
        }
      } else if ((byte & 0xf8) === 0xf0) {
        // 4-byte sequence
        if (i + 3 >= bytes.length) {
          truncateBytes = bytes.length - i;
          break;
        }
      }
    }

    if (truncateBytes > 0) {
      return chunk.substring(0, chunk.length - truncateBytes);
    }

    return chunk;
  }

  /**
   * Compress whitespace in non-code content
   */
  private compressWhitespace(content: string): string {
    // Replace multiple spaces with single space
    let compressed = content.replace(/[ \t]+/g, ' ');

    // Replace multiple newlines with double newline
    compressed = compressed.replace(/\n{3,}/g, '\n\n');

    return compressed;
  }

  /**
   * Auto-flush old processed content
   */
  private autoFlush(): void {
    // Find a safe point to flush (after a complete line or block)
    const flushPoint = Math.min(
      this.buffer.lastIndexOf('\n\n'),
      this.buffer.lastIndexOf('```'),
    );

    if (flushPoint > 0) {
      const flushedContent = this.buffer.substring(0, flushPoint);
      this.buffer = this.buffer.substring(flushPoint);
      this.processedLength += flushedContent.length;

      this.logger.info(`Auto-flushed ${flushedContent.length} bytes`);
    }
  }

  /**
   * Check if buffer contains complete code block
   */
  hasCompleteBlock(): boolean {
    const openCount = (this.buffer.match(/```/g) || []).length;
    return openCount >= 2 && openCount % 2 === 0;
  }

  /**
   * Get memory usage information
   */
  getMemoryUsage() {
    return {
      bufferSize: this.buffer.length,
      bufferSizeMB: (this.buffer.length / (1024 * 1024)).toFixed(2),
      maxSizeMB: (this.config.maxSize / (1024 * 1024)).toFixed(2),
      utilizationPercent: (
        (this.buffer.length / this.config.maxSize) *
        100
      ).toFixed(1),
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clear();
    this.outputChannel.dispose();
  }
}
