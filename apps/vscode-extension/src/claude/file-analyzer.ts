import * as vscode from 'vscode';
import * as path from 'node:path';
import type { FileInfo } from './workspace-types';

/**
 * Analyzes individual files for relevant metadata and content
 */
export class FileAnalyzer {
  private readonly MAX_FILE_SIZE = 1024 * 1024; // 1MB
  private readonly EXCERPT_LINES = 50;
  private fileCache: Map<string, { info: FileInfo; timestamp: number }> =
    new Map();
  private readonly CACHE_DURATION = 60 * 1000; // 1 minute

  /**
   * Analyzes a file and returns structured information
   */
  async analyzeFile(uri: vscode.Uri): Promise<FileInfo> {
    const cacheKey = uri.toString();
    const cached = this.fileCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.info;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const workspaceRoot = workspaceFolders[0]?.uri.fsPath || '';
    const relativePath = path.relative(workspaceRoot, uri.fsPath);

    const stat = await vscode.workspace.fs.stat(uri);
    const document = await this.tryOpenDocument(uri);

    const fileInfo: FileInfo = {
      path: relativePath,
      absolutePath: uri.fsPath,
      language: this.detectFileLanguage(uri),
      isModified: document?.isDirty || false,
      lineCount: document?.lineCount || 0,
      size: stat.size,
      lastModified: new Date(stat.mtime),
    };

    // Add content or excerpt based on file size
    if (document && stat.size <= this.MAX_FILE_SIZE) {
      const content = document.getText();
      if (document.lineCount <= this.EXCERPT_LINES * 2) {
        fileInfo.content = content;
      } else {
        fileInfo.excerpt = await this.getFileExcerpt(uri, this.EXCERPT_LINES);
      }
    } else if (document) {
      fileInfo.excerpt = await this.getFileExcerpt(uri, this.EXCERPT_LINES);
    }

    // Cache the result
    this.fileCache.set(cacheKey, {
      info: fileInfo,
      timestamp: Date.now(),
    });

    // Clean up old cache entries
    this.cleanupCache();

    return fileInfo;
  }

  /**
   * Gets an excerpt from a file
   */
  async getFileExcerpt(uri: vscode.Uri, maxLines: number): Promise<string> {
    const document = await this.tryOpenDocument(uri);
    if (!document) {
      return '';
    }

    const lines: string[] = [];
    const halfLines = Math.floor(maxLines / 2);

    // Get first part of file
    for (let i = 0; i < Math.min(halfLines, document.lineCount); i++) {
      lines.push(document.lineAt(i).text);
    }

    if (document.lineCount > maxLines) {
      lines.push('\n... (content omitted) ...\n');

      // Get last part of file
      const startLine = Math.max(halfLines, document.lineCount - halfLines);
      for (let i = startLine; i < document.lineCount; i++) {
        lines.push(document.lineAt(i).text);
      }
    } else {
      // Include entire file if it's small enough
      for (let i = halfLines; i < document.lineCount; i++) {
        lines.push(document.lineAt(i).text);
      }
    }

    return lines.join('\n');
  }

  /**
   * Detects the language of a file
   */
  detectFileLanguage(uri: vscode.Uri): string {
    const ext = path.extname(uri.fsPath).toLowerCase();

    // Common language mappings
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.m': 'objective-c',
      '.dart': 'dart',
      '.vue': 'vue',
      '.json': 'json',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.md': 'markdown',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.toml': 'toml',
      '.sql': 'sql',
      '.sh': 'shellscript',
      '.bash': 'shellscript',
      '.ps1': 'powershell',
      '.dockerfile': 'dockerfile',
      '.gitignore': 'ignore',
      '.env': 'dotenv',
    };

    return languageMap[ext] || 'plaintext';
  }

  /**
   * Determines if a file is relevant to given context keywords
   */
  isFileRelevant(uri: vscode.Uri, contextKeywords: string[]): boolean {
    const filePath = uri.fsPath.toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();

    // Check if file path or name contains any context keywords
    return contextKeywords.some((keyword) => {
      const lowerKeyword = keyword.toLowerCase();
      return filePath.includes(lowerKeyword) || fileName.includes(lowerKeyword);
    });
  }

  /**
   * Extracts important content from specific file types
   */
  async extractImportantContent(uri: vscode.Uri): Promise<string[]> {
    const document = await this.tryOpenDocument(uri);
    if (!document) {
      return [];
    }

    const language = this.detectFileLanguage(uri);
    const content = document.getText();
    const important: string[] = [];

    switch (language) {
      case 'typescript':
      case 'typescriptreact':
      case 'javascript':
      case 'javascriptreact':
        important.push(...this.extractJavaScriptImportant(content));
        break;

      case 'python':
        important.push(...this.extractPythonImportant(content));
        break;

      case 'json':
        if (path.basename(uri.fsPath) === 'package.json') {
          important.push(...this.extractPackageJsonImportant(content));
        }
        break;
    }

    return important;
  }

  /**
   * Extracts important elements from JavaScript/TypeScript
   */
  private extractJavaScriptImportant(content: string): string[] {
    const important: string[] = [];

    // Extract imports
    const importRegex = /^import\s+.*$/gm;
    const imports = content.match(importRegex);
    if (imports) {
      important.push('// Imports:', ...imports.slice(0, 10));
    }

    // Extract exports
    const exportRegex =
      /^export\s+(const|let|var|function|class|interface|type|enum)\s+(\w+)/gm;
    const exports = Array.from(content.matchAll(exportRegex));
    if (exports.length > 0) {
      important.push('// Exports:', ...exports.slice(0, 10).map((m) => m[0]));
    }

    // Extract function signatures
    const functionRegex =
      /^(export\s+)?(async\s+)?function\s+(\w+)\s*\([^)]*\)/gm;
    const functions = content.match(functionRegex);
    if (functions) {
      important.push('// Functions:', ...functions.slice(0, 10));
    }

    return important;
  }

  /**
   * Extracts important elements from Python
   */
  private extractPythonImportant(content: string): string[] {
    const important: string[] = [];

    // Extract imports
    const importRegex = /^(import|from)\s+.*$/gm;
    const imports = content.match(importRegex);
    if (imports) {
      important.push('# Imports:', ...imports.slice(0, 10));
    }

    // Extract class definitions
    const classRegex = /^class\s+(\w+).*:/gm;
    const classes = content.match(classRegex);
    if (classes) {
      important.push('# Classes:', ...classes.slice(0, 10));
    }

    // Extract function definitions
    const functionRegex = /^def\s+(\w+)\s*\([^)]*\).*:/gm;
    const functions = content.match(functionRegex);
    if (functions) {
      important.push('# Functions:', ...functions.slice(0, 10));
    }

    return important;
  }

  /**
   * Extracts important elements from package.json
   */
  private extractPackageJsonImportant(content: string): string[] {
    try {
      const pkg = JSON.parse(content);
      const important: string[] = ['// Package.json summary:'];

      if (pkg.name) important.push(`name: "${pkg.name}"`);
      if (pkg.version) important.push(`version: "${pkg.version}"`);
      if (pkg.description) important.push(`description: "${pkg.description}"`);
      if (pkg.scripts) {
        important.push(`scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      }

      return important;
    } catch {
      return [];
    }
  }

  /**
   * Tries to open a document, returns undefined if it fails
   */
  private async tryOpenDocument(
    uri: vscode.Uri,
  ): Promise<vscode.TextDocument | undefined> {
    try {
      // Check if already open
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === uri.toString(),
      );
      if (openDoc) {
        return openDoc;
      }

      // Try to open
      return await vscode.workspace.openTextDocument(uri);
    } catch {
      return undefined;
    }
  }

  /**
   * Cleans up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.fileCache.entries()) {
      if (now - value.timestamp > this.CACHE_DURATION * 2) {
        this.fileCache.delete(key);
      }
    }
  }
}
