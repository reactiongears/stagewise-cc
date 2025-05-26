import type * as vscode from 'vscode';
import { z } from 'zod';
import { ErrorCode, StagewiseError } from './error-handling';
import { responseCache } from './performance';

// Schema for toolbar communication
const ToolbarMessageSchema = z.object({
  type: z.enum(['screenshot', 'dom-metadata', 'console-logs', 'selection']),
  data: z.any(),
});

const ScreenshotRequestSchema = z.object({
  target: z.enum(['viewport', 'fullpage', 'selection']),
  format: z.enum(['base64', 'datauri']).optional().default('base64'),
  selector: z.string().optional(),
});

const DOMMetadataRequestSchema = z.object({
  elements: z.array(
    z.object({
      selector: z.string(),
      elementId: z.string().optional(),
      tagName: z.string(),
      attributes: z.record(z.string()),
      styles: z.record(z.string()).optional(),
      text: z.string().optional(),
      parentContext: z.any().optional(),
    }),
  ),
  url: z.string(),
  timestamp: z.number(),
});

export interface ToolbarBridge {
  onScreenshotRequest(
    handler: (
      request: z.infer<typeof ScreenshotRequestSchema>,
    ) => Promise<string>,
  ): void;
  onDOMMetadataUpdate(
    handler: (metadata: z.infer<typeof DOMMetadataRequestSchema>) => void,
  ): void;
  sendMessage(message: any): Promise<void>;
}

/**
 * Manages communication between the extension and the toolbar
 */
export class ToolbarCommunicationManager {
  private screenshotHandlers: Array<
    (request: z.infer<typeof ScreenshotRequestSchema>) => Promise<string>
  > = [];
  private domMetadataHandlers: Array<
    (metadata: z.infer<typeof DOMMetadataRequestSchema>) => void
  > = [];
  private latestDOMMetadata: z.infer<typeof DOMMetadataRequestSchema> | null =
    null;

  /**
   * Process incoming message from toolbar
   */
  async processToolbarMessage(message: unknown): Promise<any> {
    try {
      const parsed = ToolbarMessageSchema.parse(message);

      switch (parsed.type) {
        case 'screenshot':
          return await this.handleScreenshotRequest(parsed.data);

        case 'dom-metadata':
          return this.handleDOMMetadataUpdate(parsed.data);

        case 'console-logs':
          // TODO: Implement console logs retrieval
          return { logs: [] };

        case 'selection':
          // TODO: Implement selection handling
          return { success: true };

        default:
          throw new StagewiseError(
            ErrorCode.UNKNOWN_ERROR,
            `Unknown message type: ${parsed.type}`,
            { message: parsed },
            false,
          );
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new StagewiseError(
          ErrorCode.UNKNOWN_ERROR,
          'Invalid toolbar message format',
          { errors: error.errors },
          false,
        );
      }
      throw error;
    }
  }

  /**
   * Handle screenshot request from toolbar
   */
  private async handleScreenshotRequest(data: unknown): Promise<string> {
    const request = ScreenshotRequestSchema.parse(data);

    // Check cache
    const cacheKey = `toolbar_screenshot_${request.target}_${request.selector || 'none'}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return cached as string;
    }

    // Process through registered handlers
    for (const handler of this.screenshotHandlers) {
      try {
        const result = await handler(request);
        responseCache.set(cacheKey, result, 30000); // Cache for 30 seconds
        return result;
      } catch (error) {
        console.error('Screenshot handler error:', error);
      }
    }

    throw new StagewiseError(
      ErrorCode.IMAGE_PROCESSING_FAILED,
      'No screenshot handler available',
      { request },
      false,
    );
  }

  /**
   * Handle DOM metadata update from toolbar
   */
  private handleDOMMetadataUpdate(data: unknown): void {
    const metadata = DOMMetadataRequestSchema.parse(data);
    this.latestDOMMetadata = metadata;

    // Store in cache for MCP tools to access
    const cacheKey = `dom_metadata_${metadata.url}_${metadata.timestamp}`;
    responseCache.set(cacheKey, metadata, 60000); // Cache for 1 minute

    // Notify all handlers
    for (const handler of this.domMetadataHandlers) {
      try {
        handler(metadata);
      } catch (error) {
        console.error('DOM metadata handler error:', error);
      }
    }
  }

  /**
   * Register a screenshot request handler
   */
  onScreenshotRequest(
    handler: (
      request: z.infer<typeof ScreenshotRequestSchema>,
    ) => Promise<string>,
  ): void {
    this.screenshotHandlers.push(handler);
  }

  /**
   * Register a DOM metadata update handler
   */
  onDOMMetadataUpdate(
    handler: (metadata: z.infer<typeof DOMMetadataRequestSchema>) => void,
  ): void {
    this.domMetadataHandlers.push(handler);
  }

  /**
   * Get the latest DOM metadata
   */
  getLatestDOMMetadata(): z.infer<typeof DOMMetadataRequestSchema> | null {
    return this.latestDOMMetadata;
  }

  /**
   * Clear all handlers and cached data
   */
  clear(): void {
    this.screenshotHandlers = [];
    this.domMetadataHandlers = [];
    this.latestDOMMetadata = null;
  }
}

// Global instance
export const toolbarBridge = new ToolbarCommunicationManager();

/**
 * Initialize toolbar bridge with VSCode webview
 */
export function initializeToolbarBridge(webview: vscode.Webview): void {
  // Handle messages from webview
  webview.onDidReceiveMessage(async (message) => {
    try {
      const response = await toolbarBridge.processToolbarMessage(message);
      webview.postMessage({
        id: message.id,
        type: 'response',
        data: response,
      });
    } catch (error) {
      webview.postMessage({
        id: message.id,
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
