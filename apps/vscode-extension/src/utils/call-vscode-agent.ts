import * as vscode from 'vscode';
import type { PromptRequest } from '@stagewise/extension-toolbar-srpc-contract';

export async function callVSCodeAgent(request: PromptRequest): Promise<void> {
  // Build the full prompt from the request
  const parts = [request.prompt];
  
  if (request.files && request.files.length > 0) {
    parts.push('\nFiles to consider:');
    parts.push(...request.files.map((f: string) => `- ${f}`));
  }
  
  if (request.images && request.images.length > 0) {
    parts.push('\nImages:');
    parts.push(...request.images.map((img: string) => `- ${img}`));
  }
  
  const prompt = parts.join('\n');

  try {
    // Execute the send prompt command with the prompt directly
    await vscode.commands.executeCommand('stagewise.claude.sendPrompt', prompt);
  } catch (error) {
    // If Claude is not configured or there's an error, prompt the user
    const choice = await vscode.window.showErrorMessage(
      'Claude Code integration is not configured or encountered an error. Would you like to set it up?',
      'Set up Claude',
      'Cancel'
    );
    
    if (choice === 'Set up Claude') {
      await vscode.commands.executeCommand('stagewise.claude.setApiKey');
    }
  }
}