# MCP Server Integration Guide

This document describes the Model Context Protocol (MCP) server integration in the Stagewise VSCode extension.

## Overview

The MCP server integration enables AI agents to interact with the browser environment through a set of tools that can:
- Capture screenshots from the browser
- Access DOM element metadata
- Read workspace files
- Retrieve console logs

## Architecture

### Components

1. **MCP Server** (`src/mcp/server.ts`)
   - Handles MCP protocol communication
   - Registers available tools
   - Manages tool execution

2. **MCP Tools** (`src/mcp/tools.ts`)
   - `capture-screenshot`: Captures browser screenshots
   - `get-dom-metadata`: Retrieves DOM element information
   - `read-workspace-file`: Reads files from the workspace
   - `get-console-logs`: Retrieves browser console logs

3. **Toolbar Bridge** (`src/utils/toolbar-bridge.ts`)
   - Manages communication between extension and browser toolbar
   - Handles screenshot requests
   - Processes DOM metadata updates

4. **Error Handling** (`src/utils/error-handling.ts`)
   - Centralized error management
   - User-friendly error messages
   - Retry mechanisms with exponential backoff
   - Circuit breaker pattern for external services

5. **Performance Optimization** (`src/utils/performance.ts`)
   - Response caching with TTL
   - Rate limiting for API calls
   - Request deduplication
   - Memory monitoring

6. **Image Processing** (`src/utils/image-processing.ts`)
   - Base64 encoding/decoding
   - Image optimization for Claude API
   - Image caching

## Configuration

Configuration is managed through VSCode settings:

```json
{
  "stagewise": {
    "server": {
      "port": 5746,
      "host": "localhost",
      "autoStart": true
    },
    "mcp": {
      "enabled": true,
      "maxConcurrentTools": 5,
      "timeout": 30000
    },
    "performance": {
      "cacheEnabled": true,
      "cacheTTL": 300000,
      "rateLimitPerMinute": 30
    },
    "images": {
      "maxSizeMB": 5,
      "maxDimension": 2048,
      "compressionQuality": 0.9
    },
    "logging": {
      "level": "info",
      "maxLogSize": 1000
    }
  }
}
```

## Usage

### Tool: capture-screenshot

Captures a screenshot from the browser.

**Request:**
```json
{
  "target": "full", // "editor", "webview", or "full"
  "format": "base64" // "base64" or "datauri"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "base64_encoded_image_data"
  }]
}
```

### Tool: get-dom-metadata

Retrieves metadata about DOM elements selected in the browser.

**Request:**
```json
{
  "elementId": "optional-element-id",
  "selector": "optional-css-selector",
  "includeStyles": true,
  "includeAttributes": true
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"element\":\"...\",\"attributes\":{...},\"styles\":{...}}"
  }]
}
```

### Tool: read-workspace-file

Reads a file from the current workspace.

**Request:**
```json
{
  "path": "relative/path/to/file.txt",
  "encoding": "utf8" // "utf8" or "base64"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "file contents"
  }]
}
```

## Error Handling

All tools implement comprehensive error handling:

1. **Retryable Errors**: Network failures, temporary unavailability
2. **Non-retryable Errors**: Invalid configuration, file not found
3. **User-friendly Messages**: Errors are translated to helpful messages

Example error response:
```json
{
  "content": [{
    "type": "text",
    "text": "{\"error\":\"Failed to capture screenshot\",\"code\":\"IMAGE_PROCESSING_FAILED\"}"
  }]
}
```

## Performance Considerations

1. **Caching**: Responses are cached to reduce redundant operations
2. **Rate Limiting**: Prevents overwhelming the system with requests
3. **Image Optimization**: Large images are automatically optimized for Claude
4. **Memory Management**: Automatic cleanup of old cached data

## Development

### Adding New Tools

1. Define the tool in `src/mcp/tools.ts`:
```typescript
export async function registerMyTool(server: McpServer) {
  return server.tool(
    'my-tool-name',
    'Tool description',
    {
      request: z.object({
        param: z.string(),
      }),
    },
    async ({ request }) => {
      // Tool implementation
      return {
        content: [{ type: 'text', text: 'result' }],
      };
    },
  );
}
```

2. Register in `registerAllTools()` function
3. Add error handling and caching as needed

### Testing

Run tests with:
```bash
npm test
```

Key test files:
- `src/test/mcp-integration.test.ts`: Integration tests
- `src/test/extension.test.ts`: General extension tests

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   - The extension will automatically find an available port
   - Check logs for the actual port being used

2. **MCP Tools Not Available**
   - Ensure MCP is enabled in configuration
   - Check that the MCP server started successfully
   - Verify Claude or Cursor integration is active

3. **Screenshot Capture Fails**
   - Ensure browser toolbar is connected
   - Check browser permissions
   - Verify image size limits

### Debug Mode

Enable debug logging:
```json
{
  "stagewise.logging.level": "debug"
}
```

View logs in:
- VSCode Output panel → "Stagewise"
- Browser Developer Console
- Extension Host logs

## Security Considerations

1. **File Access**: Only workspace files can be read
2. **Image Handling**: Images are validated and sanitized
3. **Rate Limiting**: Prevents abuse of resources
4. **Configuration Validation**: All settings are validated

## Future Enhancements

1. **Dynamic Tool Registration**: Allow plugins to register custom tools
2. **Streaming Responses**: Support for large file/image transfers
3. **Multi-workspace Support**: Handle multiple workspace folders
4. **Browser Extension**: Direct integration with browser APIs