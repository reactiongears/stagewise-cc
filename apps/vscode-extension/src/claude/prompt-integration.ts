import * as vscode from 'vscode';
import type {
  ClaudePromptContext,
  ImageContext,
  ContextMetadata,
  ExtractedContext,
  ContextExtractionOptions,
} from './prompt-context';
import { EnhancedPromptTransformer } from './prompt-transformer-enhanced';
import { DOMSerializer } from './dom-serializer';
import { WorkspaceCollector } from './workspace-collector';
import { Logger } from './logger';

/**
 * Main integration point for prompt formatting and context enhancement
 */
export class PromptIntegration {
  private readonly logger = new Logger('PromptIntegration');
  private readonly transformer = new EnhancedPromptTransformer();
  private readonly domSerializer = new DOMSerializer();
  private readonly workspaceCollector = WorkspaceCollector.getInstance();

  /**
   * Process a raw prompt request from the toolbar
   */
  async processPromptRequest(request: PromptRequest): Promise<ProcessedPrompt> {
    const startTime = Date.now();

    try {
      this.logger.info('Processing prompt request', {
        hasDOM: !!request.domElements,
        hasImages: !!request.images,
        source: request.source,
      });

      // Extract and build context
      const context = await this.buildContext(request);

      // Transform to Claude-optimized prompt
      const transformed = await this.transformer.transformContext(context, {
        maxTokens: request.maxTokens,
        includeFileContent: request.includeFileContent !== false,
        includeGitInfo: request.includeGitInfo !== false,
        includeDiagnostics: true,
      });

      const processingTime = Date.now() - startTime;

      this.logger.info('Prompt processing complete', {
        tokens: transformed.metadata.totalTokens,
        sections: transformed.metadata.sectionCount,
        processingTime,
      });

      return {
        prompt: transformed.prompt,
        images: transformed.imageData,
        context,
        metadata: {
          ...transformed.metadata,
          processingTime,
        },
      };
    } catch (error) {
      this.logger.error('Failed to process prompt request', error);
      throw new Error(`Prompt processing failed: ${error}`);
    }
  }

  /**
   * Build complete context from request
   */
  private async buildContext(
    request: PromptRequest,
  ): Promise<ClaudePromptContext> {
    // Serialize DOM elements if provided
    const domElements = request.domElements
      ? this.domSerializer.serializeDOMElements(request.domElements)
      : undefined;

    // Process images if provided
    const images = request.images
      ? this.processImages(request.images)
      : undefined;

    // Get workspace context
    const workspaceData = await this.workspaceCollector.gatherWorkspaceInfo();
    const workspaceInfo = await this.convertWorkspaceInfo(workspaceData);

    // Build metadata
    const metadata: ContextMetadata = {
      timestamp: Date.now(),
      source: request.source || 'toolbar',
      action: request.action,
      sessionId: request.sessionId || this.generateSessionId(),
      priority: request.priority || 'medium',
      custom: request.customMetadata,
    };

    return {
      userMessage: request.message,
      selectedElements: domElements,
      currentUrl: request.url,
      pageTitle: request.pageTitle,
      workspaceInfo,
      images,
      metadata,
    };
  }

  /**
   * Convert workspace data to our format
   */
  private async convertWorkspaceInfo(workspaceData: any): Promise<any> {
    const rootPath = workspaceData.rootPath;

    // Convert active file
    const activeFile = workspaceData.activeFile
      ? await this.convertFileInfo(workspaceData.activeFile)
      : undefined;

    // Convert open files
    const openFiles = await Promise.all(
      (workspaceData.openFiles || []).map((file: any) =>
        this.convertFileInfo(file),
      ),
    );

    // Build project structure
    const projectStructure = {
      name: workspaceData.name,
      tree: { name: workspaceData.name, path: '.', type: 'directory' as const },
      keyFiles: await this.getKeyFiles(),
      projectType: workspaceData.projectStructure?.projectType,
      dependencies: this.extractDependencies(workspaceData.projectStructure),
    };

    // Get git info
    const gitInfo = workspaceData.projectStructure?.gitInfo
      ? {
          branch: workspaceData.projectStructure.gitInfo.branch,
          modifiedFiles: workspaceData.projectStructure.gitInfo
            .hasUncommittedChanges
            ? ['<uncommitted changes>']
            : [],
          recentCommits: [],
          status: workspaceData.projectStructure.gitInfo.hasUncommittedChanges
            ? 'modified'
            : 'clean',
        }
      : undefined;

    // Get settings
    const settings = {
      tabSize: vscode.workspace
        .getConfiguration('editor')
        .get<number>('tabSize'),
      insertSpaces: vscode.workspace
        .getConfiguration('editor')
        .get<boolean>('insertSpaces'),
      formatOnSave: vscode.workspace
        .getConfiguration('editor')
        .get<boolean>('formatOnSave'),
    };

    return {
      rootPath,
      activeFile,
      openFiles,
      projectStructure,
      gitInfo,
      settings,
    };
  }

  /**
   * Convert file info
   */
  private async convertFileInfo(fileData: any): Promise<any> {
    return {
      path: fileData.path,
      content: fileData.content || fileData.excerpt,
      language: fileData.language,
      selection: fileData.selection
        ? {
            startLine: fileData.selection.start.line,
            startColumn: fileData.selection.start.character,
            endLine: fileData.selection.end.line,
            endColumn: fileData.selection.end.character,
            text: fileData.selection.text,
          }
        : undefined,
      diagnostics: fileData.path
        ? vscode.languages.getDiagnostics(
            vscode.Uri.file(
              vscode.workspace.rootPath
                ? `${vscode.workspace.rootPath}/${fileData.path}`
                : fileData.path,
            ),
          )
        : undefined,
    };
  }

  /**
   * Get key project files
   */
  private async getKeyFiles(): Promise<string[]> {
    const patterns = [
      'package.json',
      'tsconfig.json',
      'README.md',
      '.gitignore',
      'vite.config.*',
      'webpack.config.*',
    ];

    const keyFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        5,
      );
      keyFiles.push(...files.map((f) => vscode.workspace.asRelativePath(f)));
    }

    return keyFiles;
  }

  /**
   * Extract dependencies from project structure
   */
  private extractDependencies(
    projectStructure: any,
  ): Record<string, string> | undefined {
    if (!projectStructure?.packageJson) return undefined;

    const deps: Record<string, string> = {};

    if (projectStructure.packageJson.dependencies) {
      projectStructure.packageJson.dependencies.forEach((dep: string) => {
        deps[dep] = 'latest';
      });
    }

    if (projectStructure.packageJson.devDependencies) {
      projectStructure.packageJson.devDependencies.forEach((dep: string) => {
        deps[dep] = 'latest';
      });
    }

    return Object.keys(deps).length > 0 ? deps : undefined;
  }

  /**
   * Process and validate images
   */
  private processImages(imageData: any[]): ImageContext[] {
    return imageData.map((img, index) => ({
      data: img.data || img.url || '',
      type: img.type || 'screenshot',
      metadata: {
        width: img.width,
        height: img.height,
        format: img.format || 'png',
        timestamp: img.timestamp || Date.now(),
      },
      description: img.description || `Image ${index + 1}`,
    }));
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Extract context with options
   */
  async extractContext(
    message: string,
    options?: ContextExtractionOptions,
  ): Promise<ExtractedContext> {
    const startTime = Date.now();

    try {
      const context = await this.buildContext({
        message,
        source: 'api',
        includeFileContent: options?.includeFileContent,
        includeGitInfo: options?.includeGitInfo,
      });

      const estimatedTokens = this.estimateContextTokens(context);
      const extractionTime = Date.now() - startTime;

      return {
        context,
        warnings: [],
        estimatedTokens,
        extractionTime,
      };
    } catch (error) {
      throw new Error(`Context extraction failed: ${error}`);
    }
  }

  /**
   * Estimate tokens for context
   */
  private estimateContextTokens(context: ClaudePromptContext): number {
    const text = JSON.stringify(context);
    return Math.ceil(text.length / 4); // Rough estimate
  }
}

/**
 * Raw prompt request from toolbar
 */
export interface PromptRequest {
  message: string;
  domElements?: any[];
  images?: any[];
  url?: string;
  pageTitle?: string;
  source?: 'toolbar' | 'command' | 'menu' | 'api';
  action?: string;
  sessionId?: string;
  priority?: 'low' | 'medium' | 'high';
  customMetadata?: Record<string, any>;
  maxTokens?: number;
  includeFileContent?: boolean;
  includeGitInfo?: boolean;
}

/**
 * Processed prompt ready for Claude
 */
export interface ProcessedPrompt {
  prompt: string;
  images?: any[];
  context: ClaudePromptContext;
  metadata: {
    totalTokens: number;
    sectionCount: number;
    transformTime: number;
    truncated: boolean;
    processingTime: number;
  };
}
