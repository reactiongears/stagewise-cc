import { getCurrentIDE } from './get-current-ide';
import { callCursorAgent } from './call-cursor-agent';
import { callWindsurfAgent } from './call-windsurf-agent';
import { callClaudeAgent } from './call-claude-agent';
import * as vscode from 'vscode';
import type { PromptRequest } from '@stagewise/extension-toolbar-srpc-contract';

export async function dispatchAgentCall(request: PromptRequest) {
  const ide = getCurrentIDE();
  switch (ide) {
    case 'CURSOR':
      return await callCursorAgent(request);
    case 'WINDSURF':
      return await callWindsurfAgent(request);
    case 'VSCODE':
      // Route VSCode requests to Claude agent as per task requirement
      return await callClaudeAgent(request);
    case 'UNKNOWN':
      // This case should never be reached now since we default to VSCODE
      vscode.window.showErrorMessage(
        'Failed to call agent: IDE is not supported',
      );
  }
}
