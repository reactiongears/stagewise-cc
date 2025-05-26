import * as vscode from 'vscode';
import { StreamingResponseParser } from './streaming-parser';
import { CodeExtractor, FileOperation } from './code-extractor';
import { CodeBlock } from './streaming-parser';
import { FileModificationService } from './file-modification-service';
import { DiffPreviewService } from './diff-preview';
import { UserConfirmationService, UserDecision } from './user-confirmation';
import { Logger } from './logger';

/**
 * Configuration for Claude integration
 */
export interface ClaudeIntegrationConfig {
  autoApplyLowRisk?: boolean;
  alwaysShowDiff?: boolean;
  confirmDestructive?: boolean;
  enableBackups?: boolean;
  streamingEnabled?: boolean;
}

/**
 * Event data for Claude responses
 */
export interface ClaudeResponseEvent {
  type: 'chunk' | 'complete' | 'error';
  data?: string;
  error?: Error;
}

/**
 * Main integration class for Claude Code features
 */
export class ClaudeIntegration {
  private logger: Logger;
  private streamingParser: StreamingResponseParser;
  private codeExtractor: CodeExtractor;
  private fileModificationService: FileModificationService;
  private diffPreviewService: DiffPreviewService;
  private userConfirmationService: UserConfirmationService;
  private config: ClaudeIntegrationConfig;
  private isProcessing: boolean = false;

  constructor(config: ClaudeIntegrationConfig = {}) {
    const outputChannel = vscode.window.createOutputChannel('Claude Integration');
    this.logger = new Logger(outputChannel);
    
    // Initialize services
    this.streamingParser = new StreamingResponseParser();
    this.codeExtractor = new CodeExtractor();
    this.fileModificationService = new FileModificationService();
    this.diffPreviewService = new DiffPreviewService();
    this.userConfirmationService = new UserConfirmationService({
      autoAcceptLowRisk: config.autoApplyLowRisk,
      alwaysShowDiff: config.alwaysShowDiff,
      confirmDestructive: config.confirmDestructive
    });
    
    this.config = {
      autoApplyLowRisk: config.autoApplyLowRisk ?? false,
      alwaysShowDiff: config.alwaysShowDiff ?? false,
      confirmDestructive: config.confirmDestructive ?? true,
      enableBackups: config.enableBackups ?? true,
      streamingEnabled: config.streamingEnabled ?? true
    };

    this.setupEventListeners();
  }

  /**
   * Process a Claude response (streaming or complete)
   */
  async processClaudeResponse(response: ClaudeResponseEvent): Promise<void> {
    if (this.isProcessing) {
      this.logger.warning('Already processing a response, ignoring new request');
      return;
    }

    this.isProcessing = true;

    try {
      if (response.type === 'error') {
        throw response.error || new Error('Unknown error');
      }

      let fullContent: string;

      if (response.type === 'chunk' && this.config.streamingEnabled) {
        // Process streaming chunk
        this.streamingParser.process(response.data || '');
        return; // Will be handled by event listeners
      } else if (response.type === 'complete') {
        fullContent = response.data || '';
      } else {
        throw new Error('Invalid response type');
      }

      // Process complete response
      await this.processCompleteResponse(fullContent);

    } catch (error) {
      this.logger.error('Failed to process Claude response', error);
      vscode.window.showErrorMessage(
        `Failed to process Claude response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a complete response
   */
  private async processCompleteResponse(content: string): Promise<void> {
    this.logger.info('Processing complete Claude response');

    // Extract file operations
    // Parse content into code blocks first
    const codeBlocks = this.parseCodeBlocks(content);
    const operations = this.codeExtractor.extractFileOperations(codeBlocks);

    if (operations.length === 0) {
      this.logger.info('No file operations found in response');
      return;
    }

    this.logger.info(`Found ${operations.length} file operations`);

    // Apply operations with user confirmation
    await this.applyOperations(operations);
  }

  /**
   * Apply file operations with user confirmation
   */
  private async applyOperations(operations: FileOperation[]): Promise<void> {
    try {
      // Generate diff preview
      const preview = await this.diffPreviewService.generatePreview(operations);

      // Request user confirmation
      const confirmation = await this.userConfirmationService.requestConfirmation(
        operations,
        preview
      );

      // Handle user decision
      switch (confirmation.decision) {
        case UserDecision.ACCEPT_ALL:
          await this.applyAllOperations(operations);
          break;

        case UserDecision.ACCEPT_SELECTED:
          if (confirmation.selectedOperations) {
            const selected = operations.filter(op => 
              confirmation.selectedOperations!.includes(op.id)
            );
            await this.applyAllOperations(selected);
          }
          break;

        case UserDecision.REJECT:
          this.logger.info('User rejected all operations');
          vscode.window.showInformationMessage('Operations cancelled');
          break;

        case UserDecision.CANCEL:
          this.logger.info('User cancelled operation');
          break;
      }

    } catch (error) {
      this.logger.error('Failed to apply operations', error);
      vscode.window.showErrorMessage(
        `Failed to apply operations: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Apply all operations
   */
  private async applyAllOperations(operations: FileOperation[]): Promise<void> {
    const startTime = Date.now();
    
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Applying Claude Code changes',
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: 'Starting...' });

      try {
        const results = await this.fileModificationService.applyOperations(operations);
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        await this.userConfirmationService.showOperationResult(
          failed === 0,
          successful,
          `Completed in ${duration}s${failed > 0 ? ` (${failed} failed)` : ''}`
        );

      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * Setup event listeners for streaming parser
   */
  private setupEventListeners(): void {
    // Listen for code blocks from streaming parser
    this.streamingParser.on('codeBlock', async (codeBlock) => {
      this.logger.debug('Received code block from streaming parser');
      
      // Extract operations from the code block
      // Extract operations from the single code block
      const operations = this.codeExtractor.extractFileOperations([codeBlock]);
      
      if (operations.length > 0) {
        // Queue operations for processing when streaming completes
        this.queueOperations(operations);
      }
    });

    // Listen for streaming completion
    this.streamingParser.on('complete', async () => {
      this.logger.info('Streaming complete, processing queued operations');
      await this.processQueuedOperations();
    });

    // Listen for errors
    this.streamingParser.on('error', (error) => {
      this.logger.error('Streaming parser error', error);
      this.isProcessing = false;
    });
  }

  /**
   * Queue operations for batch processing
   */
  private queuedOperations: FileOperation[] = [];

  private queueOperations(operations: FileOperation[]): void {
    this.queuedOperations.push(...operations);
  }

  /**
   * Process all queued operations
   */
  private async processQueuedOperations(): Promise<void> {
    if (this.queuedOperations.length === 0) {
      return;
    }

    const operations = [...this.queuedOperations];
    this.queuedOperations = [];

    await this.applyOperations(operations);
  }

  /**
   * Parse code blocks from content
   */
  private parseCodeBlocks(content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const codeBlockRegex = /```(\w+)?\s*(?:(?:\/\/|#)\s*(.+?)\n)?([\s\S]*?)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'plaintext',
        filePath: match[2],
        code: match[3].trim(),
        operation: 'unknown'
      });
    }
    
    return blocks;
  }

  /**
   * Handle SSE events from the HTTP server
   */
  async handleSSEEvent(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'claude-response') {
        await this.processClaudeResponse({
          type: 'chunk',
          data: data.content
        });
      } else if (data.type === 'claude-complete') {
        await this.processClaudeResponse({
          type: 'complete',
          data: data.fullContent
        });
      } else if (data.type === 'error') {
        await this.processClaudeResponse({
          type: 'error',
          error: new Error(data.message)
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle SSE event', error);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ClaudeIntegrationConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update service configurations
    this.userConfirmationService.updateConfig({
      autoAcceptLowRisk: config.autoApplyLowRisk,
      alwaysShowDiff: config.alwaysShowDiff,
      confirmDestructive: config.confirmDestructive
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): ClaudeIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Clear all caches and reset state
   */
  reset(): void {
    this.queuedOperations = [];
    this.isProcessing = false;
    this.userConfirmationService.clearRememberedChoices();
    this.streamingParser.reset();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.streamingParser.dispose();
    this.userConfirmationService.dispose();
    this.diffPreviewService.dispose();
  }
}