# Product Requirements Document: VSCode + Claude Code SDK Integration for Stagewise

## Executive Summary

This PRD outlines the requirements for adding native VSCode support to Stagewise using the Claude Code SDK, enabling users to leverage Claude's AI capabilities directly within VSCode without requiring Cursor or Windsurf.

## Background

Currently, Stagewise supports AI-powered code editing through:
- **Cursor**: Uses `composer.fixerrormessage` command
- **Windsurf**: Uses `windsurf.prioritized.explainProblem` command

Both integrations rely on injecting prompts as fake diagnostics to trigger the respective AI agents. This approach is IDE-specific and limits Stagewise to these two environments.

## Objectives

1. Enable Stagewise to work with standard VSCode installations
2. Integrate Claude Code SDK for AI-powered code assistance
3. Maintain feature parity with existing Cursor/Windsurf integrations
4. Provide a seamless user experience for VSCode users

## Proposed Solution

### Architecture Overview

```
Browser Toolbar → WebSocket → VSCode Extension → Claude Code SDK → Code Modifications
                                                ↓
                                          MCP Servers (optional)
```

### Key Components

#### 1. Claude Code SDK Integration

**Approach A: Subprocess Management (Recommended)**
- Spawn Claude Code CLI as a subprocess from the extension
- Manage conversation sessions programmatically
- Stream responses back to the user

**Approach B: Future SDK Integration**
- Wait for TypeScript SDK release
- Direct API integration without subprocess overhead

#### 2. Extension Modifications

```typescript
// New file: src/utils/call-claude-agent.ts
export async function callClaudeAgent(prompt: string, context: AgentContext) {
  // 1. Initialize Claude Code subprocess
  // 2. Format prompt with context
  // 3. Execute command and stream response
  // 4. Apply code changes to workspace
}

// Update: src/utils/dispatch-agent-call.ts
const agentDispatchers = {
  cursor: callCursorAgent,
  windsurf: callWindsurfAgent,
  vscode: callClaudeAgent, // New addition
};
```

#### 3. IDE Detection Enhancement

```typescript
// Update: src/utils/get-current-ide.ts
export function getCurrentIDE(): IDE {
  const appName = vscode.env.appName;
  if (appName.includes("Cursor")) return "cursor";
  if (appName.includes("Windsurf")) return "windsurf";
  return "vscode"; // Default to VSCode
}
```

## Technical Requirements

### 1. Claude Code SDK Setup

- **Installation**: Bundle Claude Code CLI with extension or guide users to install
- **Authentication**: Handle API key management securely
- **Session Management**: Maintain conversation context across prompts

### 2. Prompt Engineering

Transform Stagewise prompts into Claude-optimized format:

```typescript
interface ClaudePromptContext {
  userMessage: string;
  selectedElements: DOMElement[];
  currentUrl: string;
  pluginContext: string[];
  workspaceInfo: {
    rootPath: string;
    activeFile?: string;
    openFiles: string[];
  };
}
```

### 3. Response Handling

- **Streaming**: Support real-time response streaming
- **Code Application**: Parse Claude's code suggestions and apply to files
- **Error Handling**: Graceful degradation for API failures

### 4. Feature Parity Checklist

- [x] Receive prompts from browser toolbar
- [ ] Process DOM element context
- [ ] Generate code modifications
- [ ] Apply changes to workspace files
- [ ] Support multi-turn conversations
- [ ] Handle images/screenshots
- [ ] Integrate with MCP servers

## Implementation Plan

### Phase 1: Core Integration (Week 1-2)
1. Add Claude Code CLI subprocess management
2. Implement basic prompt → response flow
3. Add VSCode IDE detection

### Phase 2: Context Enhancement (Week 3)
1. Enhance prompt formatting with workspace context
2. Implement code application logic
3. Add streaming response support

### Phase 3: Advanced Features (Week 4)
1. Multi-turn conversation support
2. MCP server integration
3. Image/screenshot handling

### Phase 4: Polish & Release (Week 5)
1. Error handling and edge cases
2. Performance optimization
3. Documentation and setup guides

## User Experience

### Setup Flow
1. Install Stagewise VSCode extension
2. Configure Claude API key (via VSCode settings or environment)
3. Open web application with Stagewise toolbar
4. Start using AI assistance

### Usage Flow
1. User selects DOM element(s) in browser
2. Types prompt in Stagewise toolbar
3. VSCode receives prompt and context
4. Claude processes request and generates code
5. Code changes applied to workspace
6. User sees results in real-time

## Configuration

```json
// VSCode settings.json
{
  "stagewise.claude.apiKey": "sk-ant-...",
  "stagewise.claude.model": "claude-3-sonnet",
  "stagewise.claude.temperature": 0.2,
  "stagewise.claude.maxTokens": 4096,
  "stagewise.claude.mcpServers": []
}
```

## Security Considerations

1. **API Key Management**: Store securely using VSCode's secrets API
2. **Code Execution**: Sanitize and validate all code modifications
3. **Network Security**: Use HTTPS for API communications
4. **Permission Model**: Request user confirmation for file modifications

## Success Metrics

1. **Adoption**: 1000+ VSCode users within first month
2. **Performance**: <2s response time for simple prompts
3. **Reliability**: 99%+ success rate for code generation
4. **User Satisfaction**: 4.5+ star rating on VSCode marketplace

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code SDK changes | High | Abstract SDK interface for easy updates |
| API rate limits | Medium | Implement caching and rate limiting |
| Complex workspace handling | Medium | Start with single-file edits, expand gradually |
| Competition from official extensions | High | Focus on browser-IDE integration uniqueness |

## Future Enhancements

1. **Direct TypeScript SDK**: Migrate from CLI when available
2. **Multi-agent Support**: Allow switching between Claude, GPT-4, etc.
3. **Collaborative Features**: Share prompts and solutions
4. **Custom MCP Servers**: Domain-specific tools integration
5. **Workspace Analysis**: Pre-index codebase for better context

## Appendix

### Alternative Approaches Considered

1. **Web-based Claude API**: Requires proxy server, adds latency
2. **Browser Extension**: Would duplicate VSCode extension functionality
3. **Custom Language Server**: Overly complex for current needs

### Dependencies

- Claude Code CLI or future TypeScript SDK
- VSCode Extension API 1.75+
- Node.js 18+
- Existing Stagewise packages

### References

- [Claude Code SDK Documentation](https://docs.anthropic.com/en/docs/claude-code/sdk)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Stagewise Architecture](./CONTRIBUTING.md)