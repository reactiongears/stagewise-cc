import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import z from 'zod';
import * as vscode from 'vscode';
import {
  ErrorCode,
  StagewiseError,
  retryWithBackoff,
} from '../utils/error-handling';
import {
  responseCache,
  mcpRateLimiter,
  measurePerformance,
  performanceMetrics,
} from '../utils/performance';
import {
  captureVSCodeScreenshot,
  optimizeImageForClaude,
  imageCache,
} from '../utils/image-processing';
// TODO: This is mocked, will be replaced with dynamic tool registration via sRPC from the toolbar
// Types and functions will be defined in @stagewise/extension-toolbar-srpc-contract/src/contract.ts

export async function registerConsoleLogsTool(server: McpServer) {
  return server.tool(
    'get-console-logs',
    'Get the console logs',
    {
      request: z.object({
        amount: z.number().optional(),
      }),
    },
    async () => {
      const logs: string[] = [];
      return {
        content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }],
      };
    },
  );
}

// Register screenshot capture tool with caching and error handling
export async function registerScreenshotTool(server: McpServer) {
  return server.tool(
    'capture-screenshot',
    'Capture a screenshot of the active editor or webview',
    {
      request: z.object({
        target: z
          .enum(['editor', 'webview', 'full'])
          .optional()
          .default('full'),
        format: z.enum(['base64', 'datauri']).optional().default('base64'),
      }),
    },
    async ({ request }) => {
      try {
        // Check rate limit
        const canProceed = await mcpRateLimiter.checkLimit('screenshot');
        if (!canProceed) {
          throw new StagewiseError(
            ErrorCode.NETWORK_ERROR,
            'Rate limit exceeded for screenshot capture',
            { remaining: mcpRateLimiter.getRemainingRequests('screenshot') },
            true,
          );
        }

        // Check cache
        const cacheKey = `screenshot_${request.target}_${request.format}`;
        const cached = imageCache.get(cacheKey);
        if (cached) {
          const text =
            request.format === 'datauri'
              ? `data:${cached.mimeType};base64,${cached.base64}`
              : cached.base64;
          return {
            content: [{ type: 'text', text }],
          };
        }

        // Capture with performance measurement
        const imageData = await measurePerformance(
          'screenshot_capture',
          async () => {
            const result = await captureVSCodeScreenshot(request.target);
            if (!result) {
              throw new StagewiseError(
                ErrorCode.IMAGE_PROCESSING_FAILED,
                'Failed to capture screenshot',
                { target: request.target },
                true,
              );
            }
            return result;
          },
          performanceMetrics,
        );

        // Optimize for Claude if needed
        const optimized = await optimizeImageForClaude(imageData);

        // Cache the result
        imageCache.set(cacheKey, optimized);

        const text =
          request.format === 'datauri'
            ? `data:${optimized.mimeType};base64,${optimized.base64}`
            : optimized.base64;

        return {
          content: [{ type: 'text', text }],
        };
      } catch (error) {
        const err = error as Error;
        console.error('[capture-screenshot] Error:', err);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  err instanceof StagewiseError
                    ? err.message
                    : 'Screenshot capture failed',
                code:
                  err instanceof StagewiseError
                    ? err.code
                    : ErrorCode.UNKNOWN_ERROR,
              }),
            },
          ],
        };
      }
    },
  );
}

// Register DOM element metadata tool with caching
export async function registerDOMMetadataTool(server: McpServer) {
  return server.tool(
    'get-dom-metadata',
    'Get metadata about DOM elements from the toolbar selection',
    {
      request: z.object({
        elementId: z.string().optional(),
        selector: z.string().optional(),
        includeStyles: z.boolean().optional().default(true),
        includeAttributes: z.boolean().optional().default(true),
      }),
    },
    async ({ request }) => {
      try {
        // Check cache
        const cacheKey = `dom_${request.elementId || request.selector}_${request.includeStyles}_${request.includeAttributes}`;
        const cached = responseCache.get(cacheKey);
        if (cached) {
          return {
            content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }],
          };
        }

        // TODO: Implement communication with toolbar to get DOM metadata
        // This will be populated via SRPC from the toolbar
        const metadata = await retryWithBackoff(
          async () => {
            // Placeholder for actual implementation
            return {
              element: request.elementId || request.selector || 'unknown',
              attributes: request.includeAttributes ? {} : undefined,
              styles: request.includeStyles ? {} : undefined,
              text: '',
              parentContext: {},
            };
          },
          { maxAttempts: 3, initialDelay: 500 },
        );

        // Cache the result
        responseCache.set(cacheKey, metadata, 60000); // 1 minute TTL

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metadata, null, 2),
            },
          ],
        };
      } catch (error) {
        const err = error as Error;
        console.error('[get-dom-metadata] Error:', err);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  err instanceof StagewiseError
                    ? err.message
                    : 'Failed to get DOM metadata',
                code:
                  err instanceof StagewiseError
                    ? err.code
                    : ErrorCode.UNKNOWN_ERROR,
              }),
            },
          ],
        };
      }
    },
  );
}

// Register workspace file tool with caching and error handling
export async function registerWorkspaceFileTool(server: McpServer) {
  return server.tool(
    'read-workspace-file',
    'Read a file from the current workspace',
    {
      request: z.object({
        path: z.string(),
        encoding: z.enum(['utf8', 'base64']).optional().default('utf8'),
      }),
    },
    async ({ request }) => {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new StagewiseError(
            ErrorCode.FILE_SYSTEM_ERROR,
            'No workspace folder open',
            {},
            false,
          );
        }

        // Check cache for text files
        const cacheKey = `file_${request.path}_${request.encoding}`;
        if (request.encoding === 'utf8') {
          const cached = responseCache.get(cacheKey);
          if (cached) {
            return {
              content: [{ type: 'text', text: cached }],
            };
          }
        }

        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, request.path);

        try {
          const content = await vscode.workspace.fs.readFile(uri);

          let text: string;
          if (request.encoding === 'base64') {
            text = Buffer.from(content).toString('base64');
          } else {
            text = Buffer.from(content).toString('utf8');
            // Cache text files for 2 minutes
            responseCache.set(cacheKey, text, 2 * 60 * 1000);
          }

          return {
            content: [{ type: 'text', text }],
          };
        } catch (error) {
          if (error instanceof vscode.FileSystemError) {
            throw new StagewiseError(
              ErrorCode.FILE_SYSTEM_ERROR,
              `Failed to read file: ${request.path}`,
              { path: request.path, vsError: error.name },
              false,
            );
          }
          throw error;
        }
      } catch (error) {
        const err = error as Error;
        console.error('[read-workspace-file] Error:', err);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  err instanceof StagewiseError
                    ? err.message
                    : 'Failed to read file',
                code:
                  err instanceof StagewiseError
                    ? err.code
                    : ErrorCode.FILE_SYSTEM_ERROR,
                path: request.path,
              }),
            },
          ],
        };
      }
    },
  );
}

// TOOD: Use them for dynamic tool registration later
// Types for tool registration
export type ToolRequestSchema<T extends z.ZodType> = {
  request: T;
};

export type ToolResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

export type ToolHandler<T extends z.ZodType> = (
  params: z.infer<T>,
) => Promise<ToolResponse>;

export type ToolRegistration<T extends z.ZodType> = {
  name: string;
  description: string;
  schema: ToolRequestSchema<T>;
  handler: ToolHandler<T>;
};

// This type can be used by other components to declare new tools
export type ToolDeclaration<T extends z.ZodType> = {
  name: string;
  description: string;
  schema: T;
  handler: ToolHandler<T>;
};

// Tool registry for dynamic registration
const toolRegistry = new Map<string, ToolDeclaration<any>>();

export function registerTool<T extends z.ZodType>(tool: ToolDeclaration<T>) {
  toolRegistry.set(tool.name, tool);
}

export function getRegisteredTools() {
  return Array.from(toolRegistry.values());
}

// Register all tools with the MCP server
export async function registerAllTools(server: McpServer) {
  // Register built-in tools
  registerConsoleLogsTool(server);
  registerScreenshotTool(server);
  registerDOMMetadataTool(server);
  registerWorkspaceFileTool(server);

  // Register dynamically added tools
  for (const tool of toolRegistry.values()) {
    server.tool(
      tool.name,
      tool.description,
      { request: tool.schema },
      async ({ request }) => tool.handler(request),
    );
  }
}
