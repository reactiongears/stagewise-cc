import * as vscode from 'vscode';
import { WorkspaceInfo, WorkspaceFolder, FileInfo, ProjectStructure, FileSelection } from './workspace-types';
import { FileAnalyzer } from './file-analyzer';
import { ProjectDetector } from './project-detector';
import { GitInfoCollector } from './git-info-collector';

/**
 * Collects and structures workspace metadata for Claude prompts
 */
export class WorkspaceCollector {
  private static instance: WorkspaceCollector;
  private workspaceCache: { data: WorkspaceInfo; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  
  private fileAnalyzer: FileAnalyzer;
  private projectDetector: ProjectDetector;
  private gitInfoCollector: GitInfoCollector;
  
  private constructor() {
    this.fileAnalyzer = new FileAnalyzer();
    this.projectDetector = new ProjectDetector();
    this.gitInfoCollector = new GitInfoCollector();
    
    // Set up workspace change listeners
    this.setupChangeListeners();
  }
  
  static getInstance(): WorkspaceCollector {
    if (!WorkspaceCollector.instance) {
      WorkspaceCollector.instance = new WorkspaceCollector();
    }
    return WorkspaceCollector.instance;
  }
  
  /**
   * Gathers comprehensive workspace information
   */
  async gatherWorkspaceInfo(): Promise<WorkspaceInfo> {
    // Check cache first
    if (this.workspaceCache && Date.now() - this.workspaceCache.timestamp < this.CACHE_DURATION) {
      return this.workspaceCache.data;
    }
    
    const folders = vscode.workspace.workspaceFolders || [];
    const workspaceFolders: WorkspaceFolder[] = folders.map((folder, index) => ({
      name: folder.name,
      path: folder.uri.fsPath,
      index
    }));
    
    const rootPath = folders[0]?.uri.fsPath || '';
    const name = await this.getWorkspaceName(rootPath);
    
    const [activeFile, openFiles, projectStructure] = await Promise.all([
      this.getActiveFile(),
      this.getOpenFiles(),
      this.getProjectStructure()
    ]);
    
    const recentFiles = await this.getRecentFiles(10);
    
    const workspaceInfo: WorkspaceInfo = {
      rootPath,
      name,
      folders: workspaceFolders,
      activeFile,
      openFiles,
      recentFiles,
      projectStructure
    };
    
    // Cache the result
    this.workspaceCache = {
      data: workspaceInfo,
      timestamp: Date.now()
    };
    
    return workspaceInfo;
  }
  
  /**
   * Gets information about the currently active file
   */
  async getActiveFile(): Promise<FileInfo | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return undefined;
    }
    
    const document = activeEditor.document;
    const selection = activeEditor.selection;
    
    const fileInfo = await this.fileAnalyzer.analyzeFile(document.uri);
    
    // Add selection information
    if (!selection.isEmpty) {
      fileInfo.selection = {
        start: {
          line: selection.start.line,
          character: selection.start.character
        },
        end: {
          line: selection.end.line,
          character: selection.end.character
        },
        text: document.getText(selection)
      };
    }
    
    return fileInfo;
  }
  
  /**
   * Gets information about all open files
   */
  async getOpenFiles(): Promise<FileInfo[]> {
    const openDocuments = vscode.workspace.textDocuments
      .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file');
    
    const fileInfoPromises = openDocuments.map(doc => 
      this.fileAnalyzer.analyzeFile(doc.uri)
    );
    
    return Promise.all(fileInfoPromises);
  }
  
  /**
   * Gets recently modified files
   */
  async getRecentFiles(limit: number): Promise<FileInfo[]> {
    // For now, return open files sorted by modification time
    // In a real implementation, you might track file modifications more comprehensively
    const openFiles = await this.getOpenFiles();
    
    return openFiles
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
      .slice(0, limit);
  }
  
  /**
   * Gets project structure information
   */
  async getProjectStructure(): Promise<ProjectStructure> {
    const [packageInfo, gitInfo, frameworks, dependencies] = await Promise.all([
      this.projectDetector.getPackageInfo(),
      this.gitInfoCollector.getGitInfo(),
      this.projectDetector.detectFrameworks(),
      this.projectDetector.getDependencies()
    ]);
    
    const projectType = await this.projectDetector.detectProjectType();
    
    return {
      packageJson: packageInfo,
      gitInfo,
      frameworks,
      dependencies,
      projectType: projectType[0], // Primary project type
      buildSystem: this.detectBuildSystem(packageInfo)
    };
  }
  
  /**
   * Gets the workspace name from folder or package.json
   */
  private async getWorkspaceName(rootPath: string): Promise<string> {
    // Try to get name from package.json first
    const packageInfo = await this.projectDetector.getPackageInfo();
    if (packageInfo?.name) {
      return packageInfo.name;
    }
    
    // Fall back to folder name
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].name;
    }
    
    return 'Untitled Workspace';
  }
  
  /**
   * Detects the build system from package.json
   */
  private detectBuildSystem(packageInfo?: any): string | undefined {
    if (!packageInfo) {
      return undefined;
    }
    
    const scripts = packageInfo.scripts || {};
    const devDeps = packageInfo.devDependencies || {};
    
    // Check for common build systems
    if (devDeps.vite || scripts.vite) {
      return 'vite';
    }
    if (devDeps.webpack || scripts.webpack) {
      return 'webpack';
    }
    if (devDeps['@angular/cli']) {
      return 'angular-cli';
    }
    if (devDeps['create-react-app'] || scripts['react-scripts']) {
      return 'create-react-app';
    }
    if (devDeps.next || scripts.next) {
      return 'next';
    }
    if (devDeps.parcel || scripts.parcel) {
      return 'parcel';
    }
    if (devDeps.rollup || scripts.rollup) {
      return 'rollup';
    }
    
    // Default to npm if package.json exists
    return 'npm';
  }
  
  /**
   * Sets up listeners for workspace changes
   */
  private setupChangeListeners(): void {
    // Invalidate cache on workspace changes
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.invalidateCache();
    });
    
    // Invalidate cache on file saves (with debouncing)
    let saveTimeout: NodeJS.Timeout;
    vscode.workspace.onDidSaveTextDocument(() => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        this.invalidateCache();
      }, 1000);
    });
    
    // Update active file info on editor change
    vscode.window.onDidChangeActiveTextEditor(() => {
      // We don't invalidate the whole cache, just update active file
      if (this.workspaceCache) {
        this.getActiveFile().then(activeFile => {
          if (this.workspaceCache) {
            this.workspaceCache.data.activeFile = activeFile;
          }
        });
      }
    });
  }
  
  /**
   * Invalidates the workspace cache
   */
  private invalidateCache(): void {
    this.workspaceCache = null;
  }
  
  /**
   * Disposes of resources
   */
  dispose(): void {
    this.invalidateCache();
  }
}