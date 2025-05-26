import { toolbarBridge } from '../utils/toolbar-bridge';
import {
  imageCache,
  optimizeImageForClaude,
  type ImageData,
} from '../utils/image-processing';
import {
  ErrorCode,
  StagewiseError,
  errorLogger,
} from '../utils/error-handling';
import { performanceMetrics, measurePerformance } from '../utils/performance';
import * as vscode from 'vscode';

/**
 * Integrates MCP tools with toolbar functionality
 */
export class MCPToolbarIntegration {
  private initialized = false;

  /**
   * Initialize the integration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Set up screenshot handler
      toolbarBridge.onScreenshotRequest(async (request) => {
        return measurePerformance(
          'toolbar_screenshot_processing',
          async () => {
            // For now, we'll return a placeholder
            // In a real implementation, this would process the screenshot from the browser
            const placeholderImage: ImageData = {
              base64:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
              mimeType: 'image/png',
              width: 1,
              height: 1,
            };

            // Optimize for Claude
            const optimized = await optimizeImageForClaude(placeholderImage);

            // Cache it
            const cacheKey = `toolbar_screenshot_${request.target}`;
            imageCache.set(cacheKey, optimized);

            // Return based on requested format
            if (request.format === 'datauri') {
              return `data:${optimized.mimeType};base64,${optimized.base64}`;
            }
            return optimized.base64;
          },
          performanceMetrics,
        );
      });

      // Set up DOM metadata handler
      toolbarBridge.onDOMMetadataUpdate((metadata) => {
        console.log('Received DOM metadata update:', {
          url: metadata.url,
          elementCount: metadata.elements.length,
          timestamp: new Date(metadata.timestamp).toISOString(),
        });

        // Store metadata for MCP tools to access
        // This is already handled by the toolbar bridge with caching
      });

      this.initialized = true;
      console.log('MCP-Toolbar integration initialized successfully');
    } catch (error) {
      errorLogger.log(error as Error, {
        operation: 'mcp_toolbar_integration_init',
        timestamp: new Date(),
      });
      throw new StagewiseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to initialize MCP-Toolbar integration',
        { error },
        false,
      );
    }
  }

  /**
   * Get DOM metadata for a specific element
   */
  async getDOMMetadata(elementId?: string, selector?: string): Promise<any> {
    const latestMetadata = toolbarBridge.getLatestDOMMetadata();
    if (!latestMetadata) {
      throw new StagewiseError(
        ErrorCode.UNKNOWN_ERROR,
        'No DOM metadata available. Please select an element in the browser first.',
        {},
        false,
      );
    }

    // Find matching element
    if (elementId || selector) {
      const element = latestMetadata.elements.find(
        (el) =>
          (elementId && el.elementId === elementId) ||
          (selector && el.selector === selector),
      );

      if (!element) {
        throw new StagewiseError(
          ErrorCode.UNKNOWN_ERROR,
          'Element not found in DOM metadata',
          { elementId, selector },
          false,
        );
      }

      return element;
    }

    // Return all elements
    return latestMetadata;
  }

  /**
   * Request a screenshot from the toolbar
   */
  async requestScreenshot(
    target: 'viewport' | 'fullpage' | 'selection',
    selector?: string,
  ): Promise<string> {
    // Send message to toolbar requesting screenshot
    // For now, this is a placeholder
    vscode.window.showInformationMessage(
      `Screenshot request sent to toolbar: ${target}${selector ? ` (selector: ${selector})` : ''}`,
    );

    // In a real implementation, this would communicate with the toolbar
    // and wait for the screenshot data
    return 'placeholder_screenshot_base64';
  }

  /**
   * Get console logs from the browser
   */
  async getConsoleLogs(amount?: number): Promise<string[]> {
    // TODO: Implement console log retrieval from toolbar
    return [];
  }
}

// Global instance
export const mcpToolbarIntegration = new MCPToolbarIntegration();

/**
 * Update MCP tools to use the integration
 */
export function connectMCPToolsToToolbar(): void {
  // This function would be called during extension activation
  // to set up the connection between MCP tools and toolbar functionality

  console.log('Connecting MCP tools to toolbar...');

  // The tools can now access toolbar data through:
  // - toolbarBridge.getLatestDOMMetadata()
  // - mcpToolbarIntegration.getDOMMetadata()
  // - mcpToolbarIntegration.requestScreenshot()
  // etc.
}
