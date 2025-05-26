import * as vscode from 'vscode';
import { GitInfo } from './workspace-types';

/**
 * Collects Git repository information
 */
export class GitInfoCollector {
  private gitExtension: any;
  private gitApi: any;
  
  constructor() {
    this.initializeGitExtension();
  }
  
  /**
   * Gets comprehensive git information
   */
  async getGitInfo(): Promise<GitInfo | undefined> {
    const repo = this.getRepository();
    if (!repo) {
      return undefined;
    }
    
    try {
      const branch = repo.state.HEAD?.name || 'detached';
      const hasUncommittedChanges = repo.state.workingTreeChanges.length > 0 || 
                                   repo.state.indexChanges.length > 0;
      
      // Get ahead/behind info
      const ahead = repo.state.HEAD?.ahead || 0;
      const behind = repo.state.HEAD?.behind || 0;
      
      // Get last commit info
      let lastCommitHash: string | undefined;
      let lastCommitMessage: string | undefined;
      
      if (repo.state.HEAD?.commit) {
        lastCommitHash = repo.state.HEAD.commit.substring(0, 7);
        // Note: Getting commit message requires additional API calls
        // For now, we'll leave it undefined
      }
      
      // Get remote URL
      let remoteUrl: string | undefined;
      if (repo.state.remotes.length > 0) {
        remoteUrl = repo.state.remotes[0].fetchUrl;
      }
      
      return {
        branch,
        remoteUrl,
        hasUncommittedChanges,
        ahead,
        behind,
        lastCommitHash,
        lastCommitMessage
      };
    } catch (error) {
      console.error('Error getting git info:', error);
      return undefined;
    }
  }
  
  /**
   * Gets the current branch name
   */
  async getCurrentBranch(): Promise<string | undefined> {
    const repo = this.getRepository();
    if (!repo) {
      return undefined;
    }
    
    return repo.state.HEAD?.name;
  }
  
  /**
   * Gets modified files in the working tree
   */
  async getModifiedFiles(): Promise<string[]> {
    const repo = this.getRepository();
    if (!repo) {
      return [];
    }
    
    const changes = [
      ...repo.state.workingTreeChanges,
      ...repo.state.indexChanges
    ];
    
    // Extract unique file paths
    const files = new Set<string>();
    changes.forEach(change => {
      if (change.uri) {
        const relativePath = this.getRelativePath(change.uri, repo.rootUri);
        files.add(relativePath);
      }
    });
    
    return Array.from(files);
  }
  
  /**
   * Initializes the git extension
   */
  private initializeGitExtension(): void {
    try {
      this.gitExtension = vscode.extensions.getExtension('vscode.git');
      if (this.gitExtension) {
        this.gitApi = this.gitExtension.exports.getAPI(1);
      }
    } catch (error) {
      console.error('Failed to initialize git extension:', error);
    }
  }
  
  /**
   * Gets the active repository
   */
  private getRepository(): any {
    if (!this.gitApi) {
      return undefined;
    }
    
    // Get the first repository (most common case)
    // In multi-root workspaces, you might want to be smarter about this
    const repos = this.gitApi.repositories;
    if (repos && repos.length > 0) {
      return repos[0];
    }
    
    return undefined;
  }
  
  /**
   * Gets relative path from repository root
   */
  private getRelativePath(fileUri: vscode.Uri, repoUri: vscode.Uri): string {
    const filePath = fileUri.fsPath;
    const repoPath = repoUri.fsPath;
    
    if (filePath.startsWith(repoPath)) {
      return filePath.substring(repoPath.length + 1).replace(/\\/g, '/');
    }
    
    return filePath;
  }
}