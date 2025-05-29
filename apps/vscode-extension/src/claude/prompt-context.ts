import type * as vscode from 'vscode';

/**
 * Main interface for Claude prompt context
 * Contains all necessary information for creating optimized prompts
 */
export interface ClaudePromptContext {
  // User's original message/prompt
  userMessage: string;

  // DOM elements selected in the browser
  selectedElements?: DOMElementContext[];

  // Current URL and page context
  currentUrl?: string;
  pageTitle?: string;

  // Plugin-specific context
  pluginContext?: PluginContext;

  // Workspace information
  workspaceInfo: WorkspaceInfo;

  // Image/screenshot data
  images?: ImageContext[];

  // Additional metadata
  metadata: ContextMetadata;
}

/**
 * DOM element context from browser
 */
export interface DOMElementContext {
  // Element identification
  tagName: string;
  id?: string;
  className?: string;
  xpath?: string;
  selector?: string;

  // Element content and attributes
  textContent?: string;
  innerHTML?: string;
  attributes: Record<string, string>;

  // Element position and visibility
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;

  // Parent/child relationships
  parentElement?: DOMElementContext;
  childElements?: DOMElementContext[];

  // Computed styles (relevant ones)
  computedStyles?: Record<string, string>;

  // Event listeners if detectable
  eventListeners?: string[];
}

/**
 * Workspace context information
 */
export interface WorkspaceInfo {
  // Root workspace path
  rootPath: string;

  // Currently active file
  activeFile?: FileContext;

  // Open files in editor
  openFiles: FileContext[];

  // Project structure (simplified tree)
  projectStructure?: ProjectStructure;

  // Workspace settings relevant to Claude
  settings?: WorkspaceSettings;

  // Git information if available
  gitInfo?: GitContext;
}

/**
 * File context information
 */
export interface FileContext {
  // File path (relative to workspace)
  path: string;

  // File content (or relevant portion)
  content?: string;

  // Language identifier
  language: string;

  // Current selection if any
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    text: string;
  };

  // File diagnostics (errors, warnings)
  diagnostics?: vscode.Diagnostic[];

  // File symbols (functions, classes, etc.)
  symbols?: vscode.DocumentSymbol[];
}

/**
 * Project structure representation
 */
export interface ProjectStructure {
  // Root directory name
  name: string;

  // Simplified file tree (limited depth)
  tree: FileTreeNode;

  // Key files (package.json, config files, etc.)
  keyFiles: string[];

  // Detected project type/framework
  projectType?: string;

  // Dependencies if detectable
  dependencies?: Record<string, string>;
}

/**
 * File tree node
 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  modified?: Date;
}

/**
 * Git context information
 */
export interface GitContext {
  // Current branch
  branch?: string;

  // Modified files
  modifiedFiles?: string[];

  // Recent commits (limited)
  recentCommits?: GitCommit[];

  // Current status
  status?: string;
}

/**
 * Git commit information
 */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

/**
 * Plugin-specific context
 */
export interface PluginContext {
  // Plugin identifier
  pluginId: string;

  // Plugin-specific data
  data: Record<string, any>;

  // Plugin version
  version?: string;
}

/**
 * Image context for screenshots
 */
export interface ImageContext {
  // Image data (base64 or URL)
  data: string;

  // Image type
  type: 'screenshot' | 'element' | 'diagram' | 'other';

  // Image metadata
  metadata: {
    width?: number;
    height?: number;
    format?: string;
    timestamp?: number;
  };

  // Associated DOM element if applicable
  associatedElement?: DOMElementContext;

  // Description or alt text
  description?: string;
}

/**
 * Context metadata
 */
export interface ContextMetadata {
  // When the context was captured
  timestamp: number;

  // Source of the context request
  source: 'toolbar' | 'command' | 'menu' | 'api';

  // User action that triggered the request
  action?: string;

  // Session ID for tracking
  sessionId?: string;

  // Priority level
  priority?: 'low' | 'medium' | 'high';

  // Any additional custom metadata
  custom?: Record<string, any>;
}

/**
 * Workspace settings relevant to Claude
 */
export interface WorkspaceSettings {
  // Editor settings
  tabSize?: number;
  insertSpaces?: boolean;

  // Language-specific settings
  languageSettings?: Record<string, any>;

  // Extension settings
  extensionSettings?: Record<string, any>;

  // Format on save
  formatOnSave?: boolean;
}

/**
 * Options for context extraction
 */
export interface ContextExtractionOptions {
  // Include file content
  includeFileContent?: boolean;

  // Maximum file size to include
  maxFileSize?: number;

  // Maximum depth for project structure
  maxTreeDepth?: number;

  // Include git information
  includeGitInfo?: boolean;

  // Include diagnostics
  includeDiagnostics?: boolean;

  // File patterns to exclude
  excludePatterns?: string[];
}

/**
 * Result of context extraction
 */
export interface ExtractedContext {
  // The complete context
  context: ClaudePromptContext;

  // Extraction warnings
  warnings?: string[];

  // Token count estimate
  estimatedTokens?: number;

  // Extraction time
  extractionTime?: number;
}
