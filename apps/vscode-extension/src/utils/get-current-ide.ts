import * as vscode from 'vscode';

export type IDE = 'VSCODE' | 'WINDSURF' | 'CURSOR' | 'UNKNOWN';

export function getCurrentIDE(): IDE {
  // Check vscode.env.appName for specific IDE detection
  const appName = vscode.env.appName.toLowerCase();

  // Check for Windsurf first (most specific)
  if (appName.includes('windsurf')) {
    return 'WINDSURF';
  }

  // Check for Cursor
  if (appName.includes('cursor')) {
    return 'CURSOR';
  }

  // Check for standard VSCode installations
  if (
    appName.includes('visual studio code') ||
    appName.includes('vscode') ||
    appName.includes('code')
  ) {
    return 'VSCODE';
  }

  // Default to VSCODE for unknown environments (as per task requirement)
  return 'VSCODE';
}
