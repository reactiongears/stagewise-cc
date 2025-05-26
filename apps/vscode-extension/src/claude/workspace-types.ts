/**
 * Workspace-related type definitions for Claude prompt context
 */

/**
 * Complete workspace information including files, folders, and project metadata
 */
export interface WorkspaceInfo {
  /**
   * Absolute path to workspace root directory
   */
  rootPath: string;
  
  /**
   * Human-readable workspace name
   */
  name: string;
  
  /**
   * All workspace folders (for multi-root workspaces)
   */
  folders: WorkspaceFolder[];
  
  /**
   * Currently active file being edited
   */
  activeFile?: FileInfo;
  
  /**
   * All currently open files in the editor
   */
  openFiles: FileInfo[];
  
  /**
   * Recently modified files (optional)
   */
  recentFiles?: FileInfo[];
  
  /**
   * High-level project structure information
   */
  projectStructure?: ProjectStructure;
}

/**
 * Individual workspace folder information
 */
export interface WorkspaceFolder {
  /**
   * Folder name
   */
  name: string;
  
  /**
   * Absolute path to folder
   */
  path: string;
  
  /**
   * Folder index in multi-root workspace
   */
  index: number;
}

/**
 * Detailed file information
 */
export interface FileInfo {
  /**
   * File path relative to workspace root
   */
  path: string;
  
  /**
   * Absolute file path
   */
  absolutePath?: string;
  
  /**
   * Programming language or file type
   */
  language: string;
  
  /**
   * Whether the file has unsaved changes
   */
  isModified: boolean;
  
  /**
   * Full file content (if included)
   */
  content?: string;
  
  /**
   * Excerpt or snippet if full content is too large
   */
  excerpt?: string;
  
  /**
   * Total number of lines in the file
   */
  lineCount: number;
  
  /**
   * File size in bytes
   */
  size?: number;
  
  /**
   * Last modification timestamp
   */
  lastModified: Date;
  
  /**
   * Current cursor position or selection
   */
  selection?: FileSelection;
}

/**
 * File selection or cursor position
 */
export interface FileSelection {
  /**
   * Start position
   */
  start: Position;
  
  /**
   * End position (same as start for cursor)
   */
  end: Position;
  
  /**
   * Selected text content
   */
  text?: string;
}

/**
 * Position in a text document
 */
export interface Position {
  /**
   * Zero-based line number
   */
  line: number;
  
  /**
   * Zero-based character position
   */
  character: number;
}

/**
 * High-level project structure and metadata
 */
export interface ProjectStructure {
  /**
   * Package.json information for Node.js projects
   */
  packageJson?: PackageInfo;
  
  /**
   * Git repository information
   */
  gitInfo?: GitInfo;
  
  /**
   * Detected frameworks and libraries
   */
  frameworks: string[];
  
  /**
   * Key project dependencies
   */
  dependencies?: string[];
  
  /**
   * Project type (e.g., 'node', 'python', 'java')
   */
  projectType?: string;
  
  /**
   * Build system (e.g., 'npm', 'gradle', 'maven')
   */
  buildSystem?: string;
}

/**
 * Node.js package.json information
 */
export interface PackageInfo {
  /**
   * Package name
   */
  name: string;
  
  /**
   * Package version
   */
  version: string;
  
  /**
   * Package description
   */
  description?: string;
  
  /**
   * Main entry point
   */
  main?: string;
  
  /**
   * Available scripts
   */
  scripts?: Record<string, string>;
  
  /**
   * Production dependencies (names only)
   */
  dependencies?: string[];
  
  /**
   * Development dependencies (names only)
   */
  devDependencies?: string[];
}

/**
 * Git repository information
 */
export interface GitInfo {
  /**
   * Current branch name
   */
  branch: string;
  
  /**
   * Remote repository URL
   */
  remoteUrl?: string;
  
  /**
   * Whether there are uncommitted changes
   */
  hasUncommittedChanges: boolean;
  
  /**
   * Number of commits ahead of remote
   */
  ahead?: number;
  
  /**
   * Number of commits behind remote
   */
  behind?: number;
  
  /**
   * Last commit hash
   */
  lastCommitHash?: string;
  
  /**
   * Last commit message
   */
  lastCommitMessage?: string;
}

/**
 * Validates if an object conforms to the WorkspaceInfo interface
 */
export function validateWorkspaceInfo(info: any): info is WorkspaceInfo {
  return (
    info &&
    typeof info === 'object' &&
    typeof info.rootPath === 'string' &&
    typeof info.name === 'string' &&
    Array.isArray(info.folders) &&
    Array.isArray(info.openFiles)
  );
}

/**
 * Validates if an object conforms to the FileInfo interface
 */
export function validateFileInfo(file: any): file is FileInfo {
  return (
    file &&
    typeof file === 'object' &&
    typeof file.path === 'string' &&
    typeof file.language === 'string' &&
    typeof file.isModified === 'boolean' &&
    typeof file.lineCount === 'number' &&
    file.lastModified instanceof Date
  );
}

/**
 * Creates a minimal FileInfo object
 */
export function createFileInfo(path: string, language: string = 'plaintext'): FileInfo {
  return {
    path,
    language,
    isModified: false,
    lineCount: 0,
    lastModified: new Date()
  };
}

/**
 * Checks if a file path matches common configuration patterns
 */
export function isConfigurationFile(path: string): boolean {
  const configPatterns = [
    /package\.json$/,
    /tsconfig.*\.json$/,
    /\.eslintrc/,
    /\.prettierrc/,
    /\.gitignore$/,
    /\.env/,
    /webpack\.config/,
    /vite\.config/,
    /rollup\.config/
  ];
  
  return configPatterns.some(pattern => pattern.test(path));
}

/**
 * Estimates the importance of a file based on various heuristics
 */
export function estimateFileImportance(file: FileInfo): number {
  let score = 0;
  
  // Active file is most important
  if (file.path.includes('active')) {
    score += 100;
  }
  
  // Modified files are important
  if (file.isModified) {
    score += 50;
  }
  
  // Configuration files are important
  if (isConfigurationFile(file.path)) {
    score += 30;
  }
  
  // Entry points are important
  if (file.path.match(/\/(index|main|app)\.(ts|js|tsx|jsx)$/)) {
    score += 25;
  }
  
  // Test files are less important for context
  if (file.path.includes('.test.') || file.path.includes('.spec.')) {
    score -= 20;
  }
  
  return score;
}